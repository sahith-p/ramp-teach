/**
 * The GENERIC engine runner: RECORD → LEARN → BROWSER ACTIONS → EVIDENCE → APPROVAL.
 * Workflow-agnostic — must not import workflows/ or calc/ (the CLI and workflows/registry.ts wire
 * workflows in). It never attaches, approves, pays, or decides: it writes a receipt for a human.
 *
 * Stages (each traced to agent/trace.jsonl with an honest mode):
 *  (a) calc        def.deterministicChecks(subject, null)             → runs/<id>/calc.json   [deterministic]
 *  (b) learn       spec from def.learn.specPath, else deterministicDistill(recording),
 *                  else a minimal spec (noted)                         [file mode from learn_meta | deterministic]
 *  (c) evidence    provider ? ONE model-driven browser run covering every EvidenceTask   [real]
 *                  → def.collectAgentEvidence; tasks the real run did not satisfy (or all of them,
 *                  offline / on failure) → def.scriptedEvidence                          [scripted]
 *                  → runs/<id>/evidence.json (every item labeled with its actual mode)
 *  (d) calc        def.deterministicChecks(subject, evidence)          → runs/<id>/calc.json   [deterministic]
 *  (e) synthesis   provider ? ONE generateStructured call (cached via lib/cache)  [real]
 *                  : def.mockReceipt                                               [mock]
 *  (f) post-pass   agent/enforce.ts: calc-authoritative results, evidence pointers must resolve,
 *                  human fields null → receipts/<id>.json
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  CHECK_NAMES,
  LearnMetaSchema,
  RecordingSchema,
  WorkflowSpecSchema,
  type AgentEvidenceFact,
  type AIProvider,
  type BrowserDriver,
  type CalcReport,
  type EvidenceBundle,
  type EvidenceTask,
  type Receipt,
  type RunContext,
  type SubjectSummary,
  type TraceMode,
  type TraceEvent,
  type WorkflowDefinition,
  type WorkflowSpec,
} from "@/contracts";
import { engineConfig } from "@/config/engine";
import { cacheKey, cached } from "@/lib/cache";
import { P, ROOT } from "@/lib/paths";
import { trace as writeTrace } from "@/lib/trace";
import { writeReceipt } from "@/lib/store/receipts";
import { PlaywrightDriver } from "./browser/playwright-driver";
import { checkUrl, fixturePointerFor, normalizeOrigin } from "./browser/url-policy";
import { enforceReceipt } from "./enforce";

/* --------------------------------- options --------------------------------- */

export interface RunOptions {
  /** Local fixture app, e.g. http://localhost:3000. Anything non-localhost is refused. */
  baseUrl: string;
  /** null ⇒ offline: scripted evidence + mock receipt (labeled). */
  provider: AIProvider | null;
  /** Browser driver factory (default: PlaywrightDriver, screenshots under runs/<id>/screenshots). */
  driverFactory?: (o: { allowedOrigins: string[]; screenshotDir: string }) => BrowserDriver;
  maxTurns?: number;
  /** Defaults: lib/paths. Overridable for tests. */
  repoRoot?: string;
  runsRoot?: string;
  traceFile?: string;
  persistReceipt?: (r: Receipt) => string;
  /** Use lib/cache for the synthesis call (default true). */
  cacheSynthesis?: boolean;
  /** Progress lines (CLI prints them). */
  log?: (line: string) => void;
}

export type EvidenceRunMode = "real" | "scripted" | "mixed" | "none";

export interface TokenUsageSummary {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  subject: SubjectSummary;
  modes: {
    calc: "deterministic";
    spec: string;
    evidence: EvidenceRunMode;
    synthesis: "real" | "mock";
  };
  receipt: Receipt;
  receiptPath: string;
  calcPath: string;
  evidencePath: string | null;
  failingChecks: string[];
  unverifiedChecks: string[];
  browser: {
    turns: number;
    stopReason: string;
    facts: number;
    model: string;
    usage: TokenUsageSummary | null;
    fallbackTasks: string[];
  } | null;
  synthesisUsage: Record<string, unknown> | null;
  synthesisCacheHit: boolean | null;
  notes: string[];
}

/* ------------------------------ prompt pieces ------------------------------ */

export function browserSystemPrompt(allowedOrigins: string[]): string {
  return [
    "You are a careful accounts-payable verification agent operating a real browser on a LOCAL fixture web app.",
    "All data is synthetic (a demo). You read pages and record facts; a human makes every decision.",
    "",
    "Rules:",
    `- Only visit pages on ${allowedOrigins.join(", ")}. Any other URL is refused.`,
    "- Read only. Never approve, pay, dispute, attach, upload, or change anything. The only form you may submit is a sign-in form.",
    "- If a page asks you to sign in, use the demo credentials displayed on that sign-in page.",
    "- Prefer read_page (filter \"interactive\" to find links/inputs), find, and get_page_text over screenshots; they are cheaper and exact.",
    "  Take a screenshot only if the text tools are not enough.",
    "- Be efficient: you have a limited number of turns. Batch independent actions in one turn when the order is safe",
    "  (e.g. record_evidence calls for the page you are on, then navigate to the next page, then get_page_text).",
    "- You may navigate directly to a URL you have seen in a link's href.",
    "- Record every requested fact with record_evidence WHILE the page that shows it is open (the source is the current page).",
    "  Values must be exactly what the page shows. If a page says no record exists, record nothing for it and say so.",
    "- When every sub-task is done, reply with a short plain-text summary of what you recorded and anything missing.",
  ].join("\n");
}

export function composeBrowserTask(summary: SubjectSummary, tasks: EvidenceTask[], spec: WorkflowSpec): string {
  const lines = [
    `Gather browser evidence for: ${summary.label}.`,
    "Complete ALL of the sub-tasks below in this one browser session.",
    "",
  ];
  if (spec.proof_sources.length > 0) {
    lines.push("Learned from the recorded reviewer session (where the proof lives):");
    for (const s of spec.proof_sources) lines.push(`- ${s.app}: ${s.location} (fields: ${s.fields.join(", ") || "n/a"})`);
    lines.push("");
  }
  lines.push("Sub-tasks:");
  tasks.forEach((t, i) => {
    lines.push(`${i + 1}. [${t.task_id}] ${t.instruction}`);
    lines.push(
      `   Record with record_evidence: key(s) ${t.expected_keys.map((k) => `"${k}"`).join(", ")}; subject_ref ${JSON.stringify(t.subject_ref)}`,
    );
  });
  return lines.join("\n");
}

/** API-facing synthesis schema: only what the model decides. Receipt identity/mode/human fields are set by the engine. */
export const SynthesisSchema = z.object({
  checks: z.array(
    z.object({
      name: z.string(),
      expected: z.string(),
      actual: z.string(),
      result: z.enum(["pass", "fail", "unverified"]),
      evidence: z.string(),
    }),
  ),
  recommendation: z.enum(["approve", "dispute", "review"]),
  reasons: z.array(z.string()),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

const SYNTHESIS_SYSTEM = [
  "You write verification receipts for a human approver. You never decide, approve, or pay: you recommend.",
  "The deterministic calc results you are given are authoritative: copy each check's result exactly (pass/fail/unverified).",
  "Every check must cite exactly ONE evidence pointer copied verbatim from the allowed list. Never invent pointers or URLs.",
  "Write expected/actual as short, specific, human-readable strings. Reasons are short sentences a busy approver can act on.",
].join("\n");

/** Strip volatile fields so the synthesis prompt (and its cache key) is stable across runs. */
function stableCalc(calc: CalcReport) {
  return calc.checks.map((c) => ({ check: c.check, result: c.result, summary: c.summary, findings: c.findings }));
}
function stableEvidence(ev: EvidenceBundle | null) {
  if (!ev) return null;
  return {
    mode: ev.mode,
    items: ev.items.map((i) => ({ source: i.source, kind: i.kind, employee_id: i.employee_id, week_ending: i.week_ending, value: i.value, mode: i.mode })),
    timecards: ev.timecards,
  };
}

export function allowedPointers(calc: CalcReport, evidence: EvidenceBundle | null, specPointer: string | null): string[] {
  const set = new Set<string>();
  for (const c of calc.checks) {
    set.add(`calc:${c.check}`);
    for (const f of c.findings) set.add(f.evidence);
  }
  for (const i of evidence?.items ?? []) set.add(i.source);
  if (specPointer) set.add(specPointer);
  return [...set];
}

export function synthesisPrompt(args: {
  summary: SubjectSummary;
  /** The workflow's subject record (e.g. the invoice + vendor contract), serialized as-is. */
  subject?: unknown;
  calc: CalcReport;
  evidence: EvidenceBundle | null;
  spec: WorkflowSpec;
  instructions: string;
  pointers: string[];
}): string {
  return [
    `Subject: ${args.summary.label} (${args.summary.subject_id}, vendor ${args.summary.vendor}, ${args.summary.amount} ${args.summary.currency}).`,
    "",
    "Workflow instructions:",
    args.instructions,
    "",
    ...(args.subject !== undefined
      ? ["Subject record (the document under review and its reference data):", clipJson(args.subject, 16000), ""]
      : []),
    `Checks, in this order: ${args.calc.checks.map((c) => c.check).join(", ")}.`,
    "",
    "Deterministic calc report (authoritative):",
    JSON.stringify(stableCalc(args.calc), null, 1),
    "",
    "Browser evidence gathered (mode per item):",
    JSON.stringify(stableEvidence(args.evidence), null, 1),
    "",
    "Learned workflow spec (rules + open questions from the recorded reviewer session):",
    JSON.stringify(args.spec, null, 1),
    "",
    "Allowed evidence pointers (copy one verbatim per check):",
    ...args.pointers.map((p) => `- ${p}`),
  ].join("\n");
}

/* --------------------------------- helpers --------------------------------- */

function clipJson(v: unknown, max: number): string {
  const s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}… (truncated)` : s;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

const matchesRef = (have: Record<string, string>, want: Record<string, string>) =>
  Object.entries(want).every(([k, v]) => have[k] === v);

/** A task is satisfied when every expected key has a fact for its subject AND the bundle kept an item from that fact's page. */
export function taskSatisfied(task: EvidenceTask, facts: AgentEvidenceFact[], bundle: EvidenceBundle | null): boolean {
  if (!bundle) return false;
  const kept = new Set(bundle.items.map((i) => i.source));
  return task.expected_keys.every((k) => facts.some((f) => f.key === k && matchesRef(f.subject_ref, task.subject_ref) && kept.has(f.source)));
}

/** Merge real + scripted bundles. Scripted timecards win for the employee-weeks they were run for (fallbacks). */
export function mergeBundles(subjectId: string, real: EvidenceBundle | null, scripted: EvidenceBundle | null): EvidenceBundle | null {
  if (!real && !scripted) return null;
  if (!real) return scripted;
  if (!scripted) return real;
  const key = (t: { employee_id: string; week_ending: string }) => `${t.employee_id}|${t.week_ending}`;
  const scriptedKeys = new Set(scripted.timecards.map(key));
  const items = [...real.items, ...scripted.items];
  return {
    invoice_id: subjectId,
    // Bundle-level mode is "real" only when every item is real; per-item modes carry the detail.
    mode: items.every((i) => i.mode === "real") ? "real" : "scripted",
    items,
    timecards: [...real.timecards.filter((t) => !scriptedKeys.has(key(t))), ...scripted.timecards],
  };
}

function evidenceRunMode(bundle: EvidenceBundle | null): EvidenceRunMode {
  if (!bundle || bundle.items.length === 0) return "none";
  const real = bundle.items.some((i) => i.mode === "real");
  const scripted = bundle.items.some((i) => i.mode === "scripted");
  return real && scripted ? "mixed" : real ? "real" : "scripted";
}

/* ---------------------------------- runner --------------------------------- */

export async function runWorkflow<S>(def: WorkflowDefinition<S>, subjectId: string, opts: RunOptions): Promise<RunSummary> {
  const repoRoot = opts.repoRoot ?? ROOT;
  const runsRoot = opts.runsRoot ?? P.runs;
  const traceFile = opts.traceFile ?? P.agentTrace;
  const log = opts.log ?? (() => {});
  const maxTurns = opts.maxTurns ?? engineConfig.browser.maxTurns;
  const notes: string[] = [];

  // Safety: the fixture app must be local.
  const baseUrl = checkUrl(opts.baseUrl).replace(/\/+$/, "");
  const allowedOrigins = [normalizeOrigin(baseUrl)];

  const runId = `${def.id}:${subjectId}:${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
  const runDir = path.join(runsRoot, subjectId);
  const calcPath = path.join(runDir, "calc.json");
  const evidencePath = path.join(runDir, "evidence.json");
  fs.mkdirSync(runDir, { recursive: true });

  const t = (stage: TraceEvent["stage"], mode: TraceMode, step: string, detail: Record<string, unknown> = {}) =>
    writeTrace({ run_id: runId, stage, mode, step, detail }, traceFile);
  const ctx: RunContext = {
    baseUrl,
    runId,
    runDir,
    trace: (step, mode, stage, detail) => void t(stage, mode, step, detail ?? {}),
  };

  const subject = def.loadSubject(subjectId);
  const summary = def.summarize(subject);
  t("calc", "deterministic", "run.start", {
    workflow: def.id,
    subject_id: summary.subject_id,
    base_url: baseUrl,
    provider: opts.provider ? `${opts.provider.id}:${opts.provider.model}` : null,
    offline: !opts.provider,
  });

  /* (a) calc without browser evidence */
  let calc = def.deterministicChecks(subject, null);
  writeJson(calcPath, calc);
  t("calc", "deterministic", "calc.initial", { results: Object.fromEntries(calc.checks.map((c) => [c.check, c.result])) });
  log(`calc (deterministic, no portal evidence yet): ${calc.checks.map((c) => `${c.check}=${c.result}`).join(" ")}`);

  /* (b) learned spec */
  let spec: WorkflowSpec;
  let specMode: string;
  const specAbs = path.join(repoRoot, def.learn.specPath);
  const specPointer = fs.existsSync(specAbs) ? def.learn.specPath : null;
  try {
    if (fs.existsSync(specAbs)) {
      spec = WorkflowSpecSchema.parse(JSON.parse(fs.readFileSync(specAbs, "utf8")));
      const metaAbs = path.join(path.dirname(specAbs), "learn_meta.json");
      let learnMode = "unknown";
      if (fs.existsSync(metaAbs)) {
        const meta = LearnMetaSchema.safeParse(JSON.parse(fs.readFileSync(metaAbs, "utf8")));
        if (meta.success) learnMode = meta.data.mode;
      }
      specMode = `file (learned: ${learnMode})`;
      t("learn", learnMode === "real" ? "real" : "deterministic", "spec.loaded", { path: def.learn.specPath, learn_mode: learnMode, rules: spec.rules.length });
    } else {
      const recording = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.join(repoRoot, def.learn.recordingPath), "utf8")));
      spec = WorkflowSpecSchema.parse(def.learn.deterministicDistill(recording));
      specMode = "deterministic (distilled in-run)";
      t("learn", "deterministic", "spec.distilled", { recording: def.learn.recordingPath, rules: spec.rules.length });
    }
  } catch (e) {
    spec = { vendor: summary.vendor, proof_sources: [], rules: [], open_questions: [] };
    specMode = "minimal (no spec available)";
    notes.push(`No learned spec available (${errText(e)}); ran with a minimal spec.`);
    t("learn", "deterministic", "spec.minimal", { error: errText(e) });
  }
  log(`spec: ${specMode}`);

  /* (c) browser evidence */
  const tasks = def.evidencePlan(subject, spec);
  t("evidence", "deterministic", "evidence.plan", { tasks: tasks.map((x) => x.task_id) });
  let driver: BrowserDriver | null = null;
  const getDriver = () =>
    (driver ??= (opts.driverFactory ?? ((o) => new PlaywrightDriver(o)))({ allowedOrigins, screenshotDir: path.join(runDir, "screenshots") }));

  let evidence: EvidenceBundle | null = null;
  let browserInfo: RunSummary["browser"] = null;
  const visited = new Set<string>();
  try {
    if (tasks.length > 0) {
      let realBundle: EvidenceBundle | null = null;
      let missing = tasks;
      let facts: AgentEvidenceFact[] = [];
      if (opts.provider) {
        const startUrl = `${baseUrl}${tasks[0].start_path}`;
        t("evidence", "real", "browser.start", { model: opts.provider.model, max_turns: maxTurns, start_url: startUrl, tasks: tasks.length });
        log(`evidence: real browser loop (${opts.provider.model}, ≤${maxTurns} turns) for ${tasks.length} task(s)…`);
        try {
          const res = await opts.provider.runBrowserTask({
            system: browserSystemPrompt(allowedOrigins),
            task: composeBrowserTask(summary, tasks, spec),
            startUrl,
            allowedOrigins,
            maxTurns,
            driver: getDriver(),
            onStep: (s) => {
              t("evidence", "real", `browser.${s.kind}`, s.detail);
              if (s.kind === "action") log(`  · ${String(s.detail.tool)} ${JSON.stringify(s.detail.input).slice(0, 120)}`);
              if (s.kind === "evidence") log(`  ✓ ${String(s.detail.key)}=${JSON.stringify(s.detail.value)} ${JSON.stringify(s.detail.subject_ref)}`);
            },
          });
          const extra = res as typeof res & { usage?: TokenUsageSummary; stopReason?: string };
          facts = res.facts;
          for (const f of facts) visited.add(f.source);
          realBundle = def.collectAgentEvidence(subject, facts, ctx);
          missing = tasks.filter((task) => !taskSatisfied(task, facts, realBundle));
          browserInfo = {
            turns: res.turns,
            stopReason: extra.stopReason ?? "unknown",
            facts: facts.length,
            model: res.model,
            usage: extra.usage ?? null,
            fallbackTasks: missing.map((m) => m.task_id),
          };
          t("evidence", "real", "browser.done", {
            turns: res.turns,
            stop_reason: browserInfo.stopReason,
            facts: facts.length,
            usage: browserInfo.usage,
            unsatisfied_tasks: browserInfo.fallbackTasks,
            final_text: res.finalText.slice(0, 600),
          });
        } catch (e) {
          notes.push(`Real browser loop failed (${errText(e)}); scripted evidence used for every task.`);
          t("evidence", "real", "browser.failed", { error: errText(e) });
          browserInfo = { turns: 0, stopReason: "error", facts: 0, model: opts.provider.model, usage: null, fallbackTasks: tasks.map((x) => x.task_id) };
          realBundle = null;
          missing = tasks;
        }
      }

      let scriptedBundle: EvidenceBundle | null = null;
      if (missing.length > 0) {
        const why = opts.provider ? "fallback for tasks the real loop did not satisfy" : "offline (no provider)";
        t("evidence", "scripted", "scripted.start", { reason: why, tasks: missing.map((m) => m.task_id) });
        log(`evidence: scripted Playwright steps (${why}) for ${missing.length} task(s)…`);
        try {
          scriptedBundle = await def.scriptedEvidence(subject, missing, getDriver(), ctx);
          for (const i of scriptedBundle.items) visited.add(i.source);
          t("evidence", "scripted", "scripted.done", { items: scriptedBundle.items.length, timecards: scriptedBundle.timecards.length });
          if (opts.provider) notes.push(`Scripted fallback gathered evidence for: ${missing.map((m) => m.task_id).join(", ")}.`);
        } catch (e) {
          notes.push(`Scripted evidence failed (${errText(e)}).`);
          t("evidence", "scripted", "scripted.failed", { error: errText(e) });
        }
      }
      evidence = mergeBundles(summary.subject_id, realBundle, scriptedBundle);
    }
    // Pages the driver actually loaded also count as visited (if the driver exposes them).
    const d = driver as (BrowserDriver & { visited?: string[] }) | null;
    for (const u of d?.visited ?? []) {
      const p = fixturePointerFor(u);
      if (p) visited.add(p);
    }
  } finally {
    if (driver) await (driver as BrowserDriver).close().catch(() => {});
  }
  for (const i of evidence?.items ?? []) visited.add(i.source);
  const evMode = evidenceRunMode(evidence);
  if (evidence) {
    writeJson(evidencePath, evidence);
    t("evidence", evMode === "real" ? "real" : "scripted", "evidence.written", {
      mode: evMode,
      items: evidence.items.length,
      timecards: evidence.timecards.length,
      path: path.relative(repoRoot, evidencePath),
    });
  } else {
    t("evidence", "deterministic", "evidence.none", { reason: tasks.length === 0 ? "no tasks" : "no evidence gathered" });
  }
  log(`evidence: ${evMode}${evidence ? ` (${evidence.items.length} items, ${evidence.timecards.length} timecards)` : ""}`);

  /* (d) recompute calc with evidence */
  if (evidence) {
    calc = def.deterministicChecks(subject, evidence);
    writeJson(calcPath, calc);
    t("calc", "deterministic", "calc.with_evidence", { results: Object.fromEntries(calc.checks.map((c) => [c.check, c.result])) });
    log(`calc (deterministic, with portal evidence): ${calc.checks.map((c) => `${c.check}=${c.result}`).join(" ")}`);
  }

  /* (e) synthesis */
  let draft: Receipt;
  let synthesisMode: "real" | "mock" = "mock";
  let synthesisUsage: Record<string, unknown> | null = null;
  let synthesisCacheHit: boolean | null = null;
  if (opts.provider) {
    const pointers = allowedPointers(calc, evidence, specPointer);
    const system = `${SYNTHESIS_SYSTEM}\n\n${def.synthesisInstructions}`;
    const prompt = synthesisPrompt({ summary, subject, calc, evidence, spec, instructions: def.synthesisInstructions, pointers });
    const provider = opts.provider;
    try {
      t("synthesis", "real", "synthesis.start", { model: provider.model, pointers: pointers.length });
      log(`synthesis: one structured call (${provider.model})…`);
      const call = () => provider.generateStructured({ schema: SynthesisSchema, system, prompt, maxTokens: 16000 });
      const { value, hit } =
        opts.cacheSynthesis === false
          ? { value: await call(), hit: false }
          : await cached(cacheKey("synthesis", { model: provider.model, system, prompt }), call);
      const out = SynthesisSchema.parse(value.output);
      draft = {
        invoice_id: summary.subject_id,
        vendor: summary.vendor,
        checks: out.checks,
        recommendation: out.recommendation,
        reasons: out.reasons,
        mode: "real",
        human_decision: null,
        decided_by: null,
        decided_at: null,
      };
      synthesisMode = "real";
      synthesisUsage = (value.usage as Record<string, unknown> | undefined) ?? null;
      synthesisCacheHit = hit;
      t("synthesis", "real", "synthesis.done", { model: value.model, cache_hit: hit, usage: synthesisUsage, recommendation: out.recommendation });
    } catch (e) {
      notes.push(`Receipt synthesis call failed (${errText(e)}); deterministic mock receipt used.`);
      t("synthesis", "real", "synthesis.failed", { error: errText(e) });
      draft = def.mockReceipt(subject, calc, evidence, spec);
      t("synthesis", "mock", "synthesis.mock", { reason: "fallback after failed real call" });
    }
  } else {
    draft = def.mockReceipt(subject, calc, evidence, spec);
    t("synthesis", "mock", "synthesis.mock", { reason: "offline (no provider)" });
  }
  draft = { ...draft, mode: synthesisMode };

  /* (f) post-pass */
  const enforced = enforceReceipt(draft, { calc, visitedFixtures: visited, repoRoot });
  for (const n of enforced.notes) t("synthesis", "deterministic", "receipt.enforce", { note: n });
  const receipt = enforced.receipt;
  const receiptPath = (opts.persistReceipt ?? writeReceipt)(receipt);
  t("synthesis", synthesisMode, "receipt.written", {
    path: path.relative(repoRoot, receiptPath),
    recommendation: receipt.recommendation,
    approval_target: def.approvalTargetId(subjectId),
    note: "Receipt written for a human. The engine never attaches, approves, or decides.",
  });

  const order = new Map<string, number>(CHECK_NAMES.map((n, i) => [n, i]));
  const byOrder = (a: string, b: string) => (order.get(a) ?? 99) - (order.get(b) ?? 99);
  return {
    runId,
    workflowId: def.id,
    subject: summary,
    modes: { calc: "deterministic", spec: specMode, evidence: evMode, synthesis: synthesisMode },
    receipt,
    receiptPath,
    calcPath,
    evidencePath: evidence ? evidencePath : null,
    failingChecks: receipt.checks.filter((c) => c.result === "fail").map((c) => c.name).sort(byOrder),
    unverifiedChecks: receipt.checks.filter((c) => c.result === "unverified").map((c) => c.name).sort(byOrder),
    browser: browserInfo,
    synthesisUsage,
    synthesisCacheHit,
    notes: [...notes, ...enforced.notes],
  };
}
