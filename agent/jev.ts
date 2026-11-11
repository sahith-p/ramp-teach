/**
 * Routing with TypeSafe's Jev (a System One decision model): one request, two typed questions about the invoice.
 *   workflow  Choice  which active workflow should review it (probability per workflow + confidence)
 *   fits      Noul    does any workflow cover this vendor and kind of invoice at all
 * The companion Noul is TypeSafe's recommended alternative to a "none of the above" option.
 *
 * API (docs.typesafe.ai/api/system-one, docs.typesafe.ai/primitives/choice.md):
 *   POST https://api.typesafe.ai/v1/systemone   Authorization: Bearer $TYPESAFE_API_KEY
 *   body { model, state, questions: { <id>: { type: "choice", instructions, criteria: { option: description } }
 *                                     <id>: { type: "noul", instructions, criteria: { true, false } } } }
 *   200  { model, answers: { <id>: { type: "choice", choice, confidence, probabilities } | { type: "noul", noul } },
 *          usage: { input_tokens, output_tokens } }
 * The key is read from TYPESAFE_API_KEY only and never logged.
 */
import { z } from "zod";
import type { RouteDecision } from "@/contracts";
import type { CatalogEntry, InvoiceSummaryForRouting } from "./router";

export const JEV_URL = process.env.TYPESAFE_BASE_URL?.trim() || "https://api.typesafe.ai";
/** Pin a version with RAMP_TEACH_JEV_MODEL (e.g. "jev-1.13.0"); default is the rolling alias. */
export const jevModel = () => process.env.RAMP_TEACH_JEV_MODEL?.trim() || "jev-latest";
export const jevKey = () => process.env.TYPESAFE_API_KEY?.trim() || null;
/** Fit probability needed to route to a workflow; below it the invoice goes to manual review. */
export const JEV_FIT_THRESHOLD = 0.5;

const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
});
const NoulAnswer = z.object({ type: z.literal("noul"), noul: z.number() });
export const JevResponseSchema = z.object({
  model: z.string(),
  answers: z.object({ workflow: ChoiceAnswer, fits: NoulAnswer }),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});
export type JevResponse = z.infer<typeof JevResponseSchema>;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const NONE = "none";

export function jevRequest(inv: InvoiceSummaryForRouting, catalog: CatalogEntry[], model = jevModel()) {
  const criteria: Record<string, string> = Object.fromEntries(
    catalog.map((c) => [c.workflow_id, `${c.title}. Vendor: ${c.vendor}. ${c.description}`.trim()]),
  );
  // A Choice needs real alternatives; with a single workflow add an explicit "none" (the Noul still decides).
  if (catalog.length < 2) criteria[NONE] = "None of these workflows: a different vendor or a different kind of invoice.";
  return {
    model,
    state: {
      invoice: {
        id: inv.invoice_id,
        vendor: inv.vendor,
        currency: inv.currency,
        total: inv.total,
        lines: inv.lines.map((l) => `${l.description} (${l.quantity} x ${l.unit_rate})`),
      },
      workflows: catalog.map((c) => ({ id: c.workflow_id, title: c.title, vendor: c.vendor, covers: c.description })),
    },
    questions: {
      workflow: { type: "choice", instructions: "Which workflow should review this invoice?", criteria },
      fits: {
        type: "noul",
        instructions: "Does one of the workflows in state.workflows cover this invoice's vendor and kind of invoice?",
        criteria: {
          true: "The invoice comes from a vendor a workflow covers and has the kind of lines that workflow reviews.",
          false: "No workflow covers this vendor or this kind of invoice.",
        },
      },
    },
  };
}

export interface JevCall {
  response: JevResponse;
  request_id: string | null;
}

export async function callJev(body: ReturnType<typeof jevRequest>, key: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<JevCall> {
  const res = await fetchImpl(`${JEV_URL}/v1/systemone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const request_id = res.headers.get("x-request-id") ?? res.headers.get("request-id");
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Jev request failed (HTTP ${res.status})${text ? `: ${text}` : ""}`);
  }
  return { response: JevResponseSchema.parse(await res.json()), request_id };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Turn Jev's typed answers into a RouteDecision (without decided_at). */
export function decisionFromJev(invoiceId: string, catalog: CatalogEntry[], call: JevCall): Omit<RouteDecision, "decided_at"> {
  const { workflow, fits } = call.response.answers;
  const fit = clamp01(fits.noul);
  const chosen = workflow.choice !== NONE ? catalog.find((c) => c.workflow_id === workflow.choice) : undefined;
  if (workflow.choice !== NONE && !chosen) throw new Error(`Jev chose an unknown workflow "${workflow.choice}"`);
  const routed = chosen && fit >= JEV_FIT_THRESHOLD ? chosen : undefined;
  const p = (id: string) => clamp01(workflow.probabilities[id] ?? 0);
  return {
    invoice_id: invoiceId,
    workflow_id: routed?.workflow_id ?? null,
    version: routed?.version ?? null,
    confidence: routed ? clamp01(Math.min(fit, p(routed.workflow_id))) : clamp01(1 - fit),
    reason: routed
      ? `Best fit of ${catalog.length} workflow${catalog.length === 1 ? "" : "s"}: ${pct(p(routed.workflow_id))} on ${routed.title}, ${pct(fit)} that it covers this invoice.`
      : `No workflow covers this invoice (${pct(fit)} fit). Sent to manual review.`,
    candidates: catalog.map((c) => ({
      workflow_id: c.workflow_id,
      score: clamp01(p(c.workflow_id) * fit),
      why: `${pct(p(c.workflow_id))} choice, ${pct(fit)} fit`,
    })),
    mode: "real",
    model: call.response.model,
    request_id: call.request_id,
  };
}
