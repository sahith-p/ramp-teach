/**
 * Workflow router: when an invoice arrives, pick the workflow (skill) that should review it, or none.
 *
 *   routeInvoice(invoiceId) → RouteDecision, saved to runs/<id>/route.json (contracts/pillars.ts)
 *
 * Catalog = every skill with an active version (lib/pillars: title, vendor, rules, description from the
 * package's SKILL.md frontmatter). With no active skill yet, the catalog is the existing invoice-review
 * workflow driven by rules/workflow_spec.json (its vendor is the contract vendor in data/vendor.json).
 *
 * Modes (labeled honestly in `mode`; the reason text stays plain product language):
 *  - real          one structured-output call (claude-opus-5-5 by default, RAMP_TEACH_ROUTER_MODEL overrides),
 *                  effort low, refusal fallback opt-in. Its choice must name a catalog entry.
 *  - deterministic vendor-name match + document shape (labor lines by employee and week). Used offline,
 *                  when RAMP_TEACH_ROUTER=deterministic, or if the real call fails (the trace says why).
 * No candidate fits ⇒ workflow_id null ⇒ the invoice goes to manual review; the engine does not run.
 * Never reads data/answer_key.json.
 */
import fs from "node:fs";
import { callJev, decisionFromJev, jevKey, jevModel, jevRequest } from "./jev";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  LABOR_LINE_REGEX,
  RouteDecisionSchema,
  WorkflowSpecSchema,
  type Invoice,
  type PillarMode,
  type RouteDecision,
  type SkillVersion,
} from "@/contracts";
import { anthropicBaseUrl, engineConfig, providerCredentialsPresent, resolveAnthropicKey } from "@/config/engine";
import { loadInvoice, loadVendor } from "@/lib/data";
import { P, ROOT } from "@/lib/paths";
import { getActiveSkill, listSkillIds, routePath } from "@/lib/pillars";
import { recordUsage } from "@/lib/usage";
import { modelAttrs, type SpanRecorder } from "./spans";

export const DEFAULT_ROUTER_MODEL = "claude-opus-5-5";
/** Routing model: RAMP_TEACH_ROUTER_MODEL, else claude-opus-5-5 (read per call). */
export const routerModel = () => process.env.RAMP_TEACH_ROUTER_MODEL?.trim() || DEFAULT_ROUTER_MODEL;
/** Lowest score that may be routed; below it the invoice goes to manual review. */
export const ROUTE_THRESHOLD = 0.6;
/** The engine workflow behind every skill today (workflows/registry.ts DEFAULT_WORKFLOW; not imported: agent/ stays generic). */
export const DEFAULT_ENGINE_WORKFLOW = "invoice-review";

export interface CatalogEntry {
  workflow_id: string;
  /** Active skill version, or null for the built-in workflow driven by rules/workflow_spec.json. */
  version: number | null;
  title: string;
  vendor: string;
  description: string;
  rules: string[];
  /** Where its rules come from (repo-relative). */
  source: string;
}

export interface InvoiceSummaryForRouting {
  invoice_id: string;
  vendor: string;
  currency: string;
  total: number;
  line_count: number;
  labor_lines: number;
  lines: Array<{ description: string; quantity: number; unit_rate: number; amount: number }>;
}

/** Minimal client slice for the routing call (fakeable in tests). */
export interface RouterClient {
  beta: { messages: { parse(params: Record<string, unknown>): Promise<unknown> } };
}

export interface RouteOptions {
  /** Force the plain-code path (offline runs). */
  offline?: boolean;
  /** Use this client for the real call (tests). Default: a client from config/engine credentials. */
  client?: RouterClient | null;
  model?: string;
  /** Override the catalog (tests). */
  catalog?: CatalogEntry[];
  /** Override the invoice (tests). Default: lib/data loadInvoice. */
  invoice?: Invoice;
  /** Where to save route.json; false = do not save. Default: lib/pillars routePath(invoiceId). */
  outFile?: string | false;
  /** Spans: a "route" span (and a "route.model" child for a real call) under parentId. */
  spans?: { recorder: SpanRecorder; parentId: string | null };
  /** fetch used for the Jev call (tests). */
  jevFetch?: Parameters<typeof callJev>[2];
  /** Trace hook (the CLI writes agent/trace.jsonl). */
  trace?: (step: string, mode: PillarMode, detail: Record<string, unknown>) => void;
}

/* --------------------------------- catalog --------------------------------- */

/** `description:` from a SKILL.md YAML frontmatter block (single line or folded), or null. */
export function skillDescription(skillMd: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description\s*:/.test(l));
  if (i < 0) return null;
  let v = lines[i].replace(/^description\s*:\s*/, "").trim();
  if (v === ">" || v === "|" || v === ">-" || v === "|-" || v === "") {
    const more: string[] = [];
    for (const l of lines.slice(i + 1)) {
      if (!/^\s+/.test(l)) break;
      more.push(l.trim());
    }
    v = more.join(" ");
  }
  return v.replace(/^["']|["']$/g, "").trim() || null;
}

export function catalogEntryForSkill(s: SkillVersion, root = ROOT): CatalogEntry {
  let description: string | null = null;
  try {
    const md = path.join(root, s.package_dir, "SKILL.md");
    if (fs.existsSync(md)) description = skillDescription(fs.readFileSync(md, "utf8"));
  } catch {
    description = null;
  }
  return {
    workflow_id: s.skill_id,
    version: s.version,
    title: s.title,
    vendor: s.vendor,
    description: description ?? `${s.title} (learned from ${s.recordings.length} recording(s))`,
    rules: s.rules.map((r) => r.text),
    source: `${s.package_dir}/skill.json`,
  };
}

/** The built-in invoice-review workflow driven by rules/workflow_spec.json (used until a skill is active). */
export function builtinCatalogEntry(): CatalogEntry {
  let rules: string[] = [];
  try {
    rules = WorkflowSpecSchema.parse(JSON.parse(fs.readFileSync(P.workflowSpec, "utf8"))).rules;
  } catch {
    rules = [];
  }
  const vendor = loadVendor();
  return {
    workflow_id: DEFAULT_ENGINE_WORKFLOW,
    version: null,
    title: "Service invoice review",
    vendor: vendor.vendor,
    description:
      `Reviews ${vendor.vendor}'s weekly staffing service invoices: labor lines by employee and week checked against the ` +
      "contract rate card, allowed non-labor charges, and approved timecards in the vendor portal.",
    rules,
    source: "rules/workflow_spec.json",
  };
}

/** Active skills, or the built-in workflow when no skill is active yet. */
export function buildCatalog(): CatalogEntry[] {
  const skills = listSkillIds()
    .map((id) => {
      try {
        return getActiveSkill(id);
      } catch {
        return null;
      }
    })
    .filter((s): s is SkillVersion => s !== null && s.status !== "blocked")
    .map((s) => catalogEntryForSkill(s));
  return skills.length > 0 ? skills : [builtinCatalogEntry()];
}

export function summarizeInvoice(inv: Invoice): InvoiceSummaryForRouting {
  return {
    invoice_id: inv.invoice_id,
    vendor: inv.vendor,
    currency: inv.currency,
    total: inv.total,
    line_count: inv.line_items.length,
    labor_lines: inv.line_items.filter((l) => LABOR_LINE_REGEX.test(l.description)).length,
    lines: inv.line_items.map((l) => ({ description: l.description, quantity: l.quantity, unit_rate: l.unit_rate, amount: l.amount })),
  };
}

/* ------------------------------ plain-code path ----------------------------- */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|group|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 1 = same vendor, 0..1 = share of name tokens in common. */
export function vendorSimilarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = new Set(x.split(" "));
  const ty = new Set(y.split(" "));
  const common = [...tx].filter((t) => ty.has(t)).length;
  return common / Math.max(tx.size, ty.size);
}

const shortVendor = (v: string) => v.replace(/\s+(Group|Inc\.?|LLC|Ltd\.?|Co\.?|Corporation)$/i, "");
/** "Halcyon Staffing service invoice review", or the skill title as is when it already names the vendor. */
const titleWithVendor = (c: CatalogEntry) => {
  const first = norm(c.vendor).split(" ")[0] ?? "";
  return first && norm(c.title).includes(first) ? c.title : `${shortVendor(c.vendor)} ${c.title.charAt(0).toLowerCase()}${c.title.slice(1)}`;
};

/** Score one candidate: vendor match dominates; the document shape (labor lines) adds the rest. */
export function scoreCandidate(inv: InvoiceSummaryForRouting, c: CatalogEntry): { score: number; why: string } {
  const sim = vendorSimilarity(inv.vendor, c.vendor);
  const laborShare = inv.line_count ? inv.labor_lines / inv.line_count : 0;
  const expectsLabor = /labor|timecard|employee|hours/i.test(`${c.description} ${c.rules.join(" ")}`);
  const shapeFits = expectsLabor ? laborShare > 0 : true;
  let score: number;
  if (sim === 1) score = shapeFits ? 0.96 : 0.7;
  else if (sim >= 0.5) score = shapeFits ? 0.72 : 0.45;
  else score = shapeFits ? 0.2 : 0.04;
  const sameVendor = sim === 1 ? `same vendor (${inv.vendor})` : sim >= 0.5 ? `similar vendor name (${inv.vendor} vs ${c.vendor})` : `different vendor (${inv.vendor}; this workflow covers ${c.vendor})`;
  const shape = expectsLabor
    ? laborShare > 0
      ? `${inv.labor_lines} of ${inv.line_count} lines are labor by employee and week`
      : "no labor lines by employee and week"
    : `${inv.line_count} line items`;
  return { score, why: `${sameVendor}; ${shape}` };
}

function plainDecision(invoiceId: string, inv: InvoiceSummaryForRouting, catalog: CatalogEntry[]): Omit<RouteDecision, "decided_at"> {
  const scored = catalog.map((c) => ({ c, ...scoreCandidate(inv, c) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const candidates = scored.map((s) => ({ workflow_id: s.c.workflow_id, score: s.score, why: s.why }));
  if (best && best.score >= ROUTE_THRESHOLD) {
    const fromSpec = best.c.version === null ? ` (rules from ${best.c.source})` : ` v${best.c.version}`;
    const labor = inv.labor_lines > 0 ? "labor lines by employee and week" : "line items it knows how to check";
    const vendorPhrase = vendorSimilarity(inv.vendor, best.c.vendor) === 1 ? "same vendor" : `similar vendor name (${inv.vendor})`;
    return {
      invoice_id: invoiceId,
      workflow_id: best.c.workflow_id,
      version: best.c.version,
      confidence: best.score,
      reason: `Matches ${titleWithVendor(best.c)}${fromSpec}: ${vendorPhrase}, ${labor}.`,
      candidates,
      mode: "deterministic",
      model: null,
      request_id: null,
    };
  }
  const covered = [...new Set(catalog.map((c) => c.vendor))].join(", ");
  const shape = inv.labor_lines === 0 ? "it has no labor lines by employee and week" : "its vendor is not one a workflow covers";
  return {
    invoice_id: invoiceId,
    workflow_id: null,
    version: null,
    confidence: Math.round((1 - (best?.score ?? 0)) * 100) / 100,
    reason: `No workflow fits ${inv.vendor} invoice ${inv.invoice_id}: ${shape}, and the workflows on file review ${covered} invoices. Sent to manual review.`,
    candidates,
    mode: "deterministic",
    model: null,
    request_id: null,
  };
}

/* --------------------------------- real path -------------------------------- */

/** API-facing schema (no nullable / range constraints; "none" = no workflow fits). */
export const RouterOutputSchema = z.object({
  workflow_id: z.string().describe('A workflow_id from the catalog, or "none" when no workflow fits.'),
  confidence: z.number().describe("0 to 1: how sure you are of this choice."),
  reason: z.string().describe("One or two plain sentences for the AP team: why this workflow fits, or why none does."),
  candidates: z
    .array(z.object({ workflow_id: z.string(), score: z.number().describe("0 to 1 fit"), why: z.string() }))
    .describe("One entry per catalog workflow."),
});
export type RouterOutput = z.infer<typeof RouterOutputSchema>;

export const ROUTER_SYSTEM = [
  "You route arriving vendor invoices to the review workflow (a learned skill) built for them, inside an accounts-payable app.",
  "A workflow fits only when it was built for this vendor (or clearly the same vendor under another name) AND this kind of document:",
  "its rules must be checkable on this invoice's lines. Never force a match: if nothing fits, answer workflow_id \"none\" and the",
  "invoice goes to a person for manual review. Score every catalog workflow from 0 to 1. Write the reason as one or two plain",
  "sentences an AP specialist can read (no internal jargon). All data is synthetic (a demo).",
].join("\n");

export function routerPrompt(inv: InvoiceSummaryForRouting, catalog: CatalogEntry[]): string {
  return [
    "Workflow catalog:",
    JSON.stringify(
      catalog.map((c) => ({ workflow_id: c.workflow_id, version: c.version, title: c.title, vendor: c.vendor, description: c.description, rules: c.rules })),
      null,
      1,
    ),
    "",
    "Arriving invoice:",
    JSON.stringify(inv, null, 1),
  ].join("\n");
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function defaultClient(): RouterClient | null {
  if (!providerCredentialsPresent() || engineConfig.provider !== "anthropic") return null;
  const cred = resolveAnthropicKey();
  if (!cred) return null;
  // Key and base URL passed explicitly (config/engine.ts); the key is never logged.
  return new Anthropic({ apiKey: cred.key, baseURL: anthropicBaseUrl }) as unknown as RouterClient;
}

/** Which routing model runs: Jev (TYPESAFE_API_KEY), else Claude, unless RAMP_TEACH_ROUTER forces one. */
export function routerProvider(opts: RouteOptions = {}): "jev" | "claude" | "plain" {
  if (routerForcedPlain(opts)) return "plain";
  if (opts.client !== undefined) return opts.client ? "claude" : "plain"; // tests inject a Claude client
  const forced = process.env.RAMP_TEACH_ROUTER;
  if (forced === "claude") return "claude";
  if (forced === "jev" || jevKey()) return jevKey() ? "jev" : "plain";
  return "claude";
}

/** True when the router should take the plain-code path for this run. */
export function routerForcedPlain(opts: RouteOptions = {}): boolean {
  return Boolean(opts.offline) || process.env.RAMP_TEACH_ROUTER === "deterministic";
}

async function realDecision(
  client: RouterClient,
  model: string,
  invoiceId: string,
  inv: InvoiceSummaryForRouting,
  catalog: CatalogEntry[],
  spans: RouteOptions["spans"],
  parentId: string | null,
): Promise<Omit<RouteDecision, "decided_at">> {
  const span = spans?.recorder.start("route.model", "model", "real", parentId, { model });
  const res = (await client.beta.messages.parse({
    model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: betaZodOutputFormat(RouterOutputSchema) },
    // Refusal fallback opt-in: on a safety decline the API retries on a recommended model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: ROUTER_SYSTEM,
    messages: [{ role: "user", content: routerPrompt(inv, catalog) }],
  })) as {
    stop_reason: string;
    stop_details?: { category?: string | null } | null;
    parsed_output: unknown;
    model?: string;
    id?: string;
    usage?: Record<string, number | null>;
    _request_id?: string | null;
  };
  const ids = { request_id: res._request_id ?? null, message_id: res.id ?? null };
  recordUsage("route", res.model ?? model, res.usage, ids);
  span?.end({ ...modelAttrs(res.model ?? model, res.usage ?? null, ids), stop_reason: res.stop_reason });
  if (res.stop_reason === "refusal") throw new Error(`routing call declined (category: ${res.stop_details?.category ?? "unknown"})`);
  if (res.stop_reason === "max_tokens") throw new Error("routing output truncated (max_tokens)");
  const out = RouterOutputSchema.parse(res.parsed_output);
  const known = new Map(catalog.map((c) => [c.workflow_id, c]));
  const chosen = out.workflow_id !== "none" ? known.get(out.workflow_id) : undefined;
  if (out.workflow_id !== "none" && !chosen) throw new Error(`routing call named an unknown workflow "${out.workflow_id}"`);
  const byId = new Map(out.candidates.map((c) => [c.workflow_id, c]));
  return {
    invoice_id: invoiceId,
    workflow_id: chosen?.workflow_id ?? null,
    version: chosen?.version ?? null,
    confidence: clamp01(out.confidence),
    reason: out.reason.trim(),
    // One entry per catalog workflow (the model's score when it gave one).
    candidates: catalog.map((c) => {
      const m = byId.get(c.workflow_id);
      return { workflow_id: c.workflow_id, score: clamp01(m?.score ?? 0), why: m?.why ?? "not scored" };
    }),
    mode: "real",
    model: res.model ?? model,
    request_id: ids.request_id,
  };
}

/* ---------------------------------- entry ---------------------------------- */

export async function routeInvoice(invoiceId: string, opts: RouteOptions = {}): Promise<RouteDecision> {
  const inv = opts.invoice ?? loadInvoice(invoiceId);
  if (!inv) throw new Error(`Unknown invoice ${invoiceId} (looked in data/invoices/new and data/invoices/past)`);
  const summary = summarizeInvoice(inv);
  const catalog = opts.catalog ?? buildCatalog();
  const trace = opts.trace ?? (() => {});
  const forced = routerForcedPlain(opts);
  const provider = routerProvider(opts);
  const client = provider !== "claude" ? null : opts.client === undefined ? defaultClient() : opts.client;
  const useJev = provider === "jev";
  const model = useJev ? jevModel() : (opts.model ?? routerModel());
  const live = Boolean(client) || useJev;
  const span = opts.spans?.recorder.start("route", "run", live ? "real" : "deterministic", opts.spans.parentId, {
    invoice_id: invoiceId,
    vendor: inv.vendor,
    catalog: catalog.map((c) => `${c.workflow_id}${c.version ? ` v${c.version}` : ""}`),
  });
  trace("route.start", live ? "real" : "deterministic", {
    invoice_id: invoiceId,
    vendor: inv.vendor,
    catalog: catalog.map((c) => ({ workflow_id: c.workflow_id, version: c.version, vendor: c.vendor, source: c.source })),
    model: live ? model : null,
    provider: useJev ? "typesafe-jev" : client ? "anthropic" : "plain",
    plain_reason: live ? null : opts.offline ? "offline" : forced ? "RAMP_TEACH_ROUTER=deterministic" : "no credentials",
  });

  let base: Omit<RouteDecision, "decided_at">;
  if (useJev) {
    try {
      const mspan = opts.spans?.recorder.start("route.model", "model", "real", span?.id ?? null, { model });
      const call = await callJev(jevRequest(summary, catalog, model), jevKey()!, opts.jevFetch);
      mspan?.end({
        model: call.response.model,
        provider: "typesafe",
        request_id: call.request_id,
        input_tokens: call.response.usage.input_tokens,
        output_tokens: call.response.usage.output_tokens,
        probabilities: call.response.answers.workflow.probabilities,
        fit: call.response.answers.fits.noul,
      });
      base = decisionFromJev(invoiceId, catalog, call);
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      trace("route.real_failed", "real", { error, next: "plain-code routing" });
      base = plainDecision(invoiceId, summary, catalog);
    }
  } else if (client) {
    try {
      base = await realDecision(client, model, invoiceId, summary, catalog, opts.spans, span?.id ?? null);
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      trace("route.real_failed", "real", { error, next: "plain-code routing" });
      base = plainDecision(invoiceId, summary, catalog);
    }
  } else {
    base = plainDecision(invoiceId, summary, catalog);
  }

  const decision = RouteDecisionSchema.parse({ ...base, decided_at: new Date().toISOString() });
  if (opts.outFile !== false) {
    const file = opts.outFile ?? routePath(invoiceId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(decision, null, 2) + "\n");
  }
  span?.end(
    { workflow_id: decision.workflow_id, version: decision.version, confidence: decision.confidence, model: decision.model, request_id: decision.request_id },
    decision.mode,
  );
  trace("route.decided", decision.mode, {
    workflow_id: decision.workflow_id,
    version: decision.version,
    confidence: decision.confidence,
    reason: decision.reason,
    model: decision.model,
    request_id: decision.request_id,
  });
  return decision;
}
