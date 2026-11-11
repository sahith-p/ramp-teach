/**
 * Generic LEARN distiller: Recording -> WorkflowSpec (+ LearnMeta).
 *
 *   Mode A ("real"):          provider non-null -> ONE structured Claude call, re-validated with
 *                             WorkflowSpecSchema, cached via lib/cache.ts (recording + prompt + model).
 *   Mode B ("deterministic"): provider null, or Mode A failed (refusal, network, invalid output) ->
 *                             the workflow's deterministicDistill. A fallback is NEVER labeled real.
 *
 * MUST NOT import from workflows/ or calc/ — the workflow is passed in (learn/cli.ts wires it).
 */
import { z } from "zod";
import {
  LearnMetaSchema,
  WorkflowSpecSchema,
  type AIProvider,
  type LearnMeta,
  type Recording,
  type TraceMode,
  type WorkflowDefinition,
  type WorkflowSpec,
} from "@/contracts";
import { cacheKey, readCache, writeCache } from "@/lib/cache";

export type LearnDefinition = WorkflowDefinition["learn"];

/**
 * API-facing schema: same fields as WorkflowSpecSchema without length constraints, so structured-output
 * schema conversion has nothing to reject. The result is always re-validated with WorkflowSpecSchema.
 */
export const WorkflowSpecApiSchema = z.object({
  vendor: z.string().describe("Vendor name exactly as the demonstrator says it"),
  proof_sources: z
    .array(
      z.object({
        app: z.string().describe("Application the evidence is read in"),
        location: z.string().describe("URL path template with <placeholders>, or a data file pointer"),
        fields: z.array(z.string()).describe("Field names read at this location"),
      }),
    )
    .describe("Where evidence is read"),
  rules: z.array(z.string()).describe("Self-contained, checkable rules with concrete values"),
  open_questions: z.array(z.string()).describe("Questions the demonstrator left unresolved"),
});

export const DISTILL_SYSTEM = `You distill a recorded human demonstration of a back-office workflow into a reusable
workflow spec. The recording has DOM steps (navigations, clicks, inputs on pages of a local fixture web app) and the
demonstrator's spoken narration. Passwords were redacted by the recorder.

Return a spec with: vendor, proof_sources (app, location, fields), rules, open_questions.
Only use what the recording supports: do not invent rules, values, pages or fields that are not in it.
Rules must be general (apply to future items of the same kind), not observations about the specific item reviewed.
Keep each rule and question to one or two plain sentences.`;

export interface DistillTraceEvent {
  step: string;
  mode: TraceMode;
  detail: Record<string, unknown>;
}

export interface DistillOptions {
  /** Repo-relative path the recording came from (LearnMeta.recording_path). Default learnDef.recordingPath. */
  recordingPath?: string;
  /** Use lib/cache.ts for the model call. Default true. */
  useCache?: boolean;
  now?: () => Date;
  /** Receives every distiller event (learn/cli.ts writes them to learn/trace.jsonl). */
  onTrace?: (ev: DistillTraceEvent) => void;
}

export interface DistillResult {
  spec: WorkflowSpec;
  meta: LearnMeta;
  /** Real-mode only: whether the model output came from the disk cache. */
  cacheHit: boolean;
  /** Set when Mode A was attempted and failed; the result is then deterministic. */
  fallbackReason: string | null;
  usage?: Record<string, unknown>;
}

/** Recording reduced to what the distiller needs (drops nothing semantic; secrets are already redacted). */
export function compactRecording(recording: Recording) {
  return {
    session_id: recording.session_id,
    started_at: recording.started_at,
    steps: recording.steps.map((s) => {
      const d = s.detail;
      const out: Record<string, unknown> = { kind: s.kind };
      for (const k of ["event", "url", "title", "selector", "text", "value"] as const) {
        if (d[k] !== undefined && d[k] !== "") out[k] = d[k];
      }
      return out;
    }),
  };
}

export function buildDistillPrompt(recording: Recording, learnDef: LearnDefinition): string {
  return [
    "Workflow hints from the workflow definition:",
    learnDef.distillHints.trim(),
    "",
    "Recording (JSON):",
    JSON.stringify(compactRecording(recording), null, 1),
    "",
    "Distill the workflow spec from this recording.",
  ].join("\n");
}

/** Safe, key-free description of an error for traces. */
export function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { name?: string; message?: string; category?: string | null; status?: number };
    const parts = [e.name ?? "Error"];
    if (typeof e.status === "number") parts.push(`status ${e.status}`);
    if (e.category) parts.push(`category ${e.category}`);
    if (e.message) parts.push(e.message.slice(0, 300));
    return parts.join(": ");
  }
  return String(err).slice(0, 300);
}

interface CachedModelOutput {
  output: unknown;
  model: string;
  usage?: Record<string, unknown>;
}

export async function distill(
  recording: Recording,
  learnDef: LearnDefinition,
  provider: AIProvider | null,
  opts: DistillOptions = {},
): Promise<DistillResult> {
  const now = opts.now ?? (() => new Date());
  const emit = opts.onTrace ?? (() => {});
  const recording_path = opts.recordingPath ?? learnDef.recordingPath;
  const useCache = opts.useCache ?? true;

  const deterministic = (fallbackReason: string | null): DistillResult => {
    const spec = WorkflowSpecSchema.parse(learnDef.deterministicDistill(recording));
    emit({
      step: "distill.deterministic",
      mode: "deterministic",
      detail: {
        reason: fallbackReason ? `fallback after real-mode failure: ${fallbackReason}` : "no AI provider (offline or no credentials)",
        rules: spec.rules.length,
        proof_sources: spec.proof_sources.length,
        open_questions: spec.open_questions.length,
      },
    });
    const meta = LearnMetaSchema.parse({ mode: "deterministic", model: null, recording_path, generated_at: now().toISOString() });
    return { spec, meta, cacheHit: false, fallbackReason };
  };

  if (!provider) return deterministic(null);

  const prompt = buildDistillPrompt(recording, learnDef);
  const key = cacheKey("learn-distill", { recording, system: DISTILL_SYSTEM, prompt, model: provider.model });
  try {
    let hit = false;
    let res: CachedModelOutput | null = useCache ? readCache<CachedModelOutput>(key) : null;
    if (res) {
      hit = true;
    } else {
      // No trace event before the call returns: nothing is labeled "real" until the provider produced it.
      const out = await provider.generateStructured({ schema: WorkflowSpecApiSchema, system: DISTILL_SYSTEM, prompt, maxTokens: 16000 });
      res = { output: out.output, model: out.model, usage: out.usage };
    }
    // Re-validate against the frozen contract before trusting (or caching) anything.
    const spec = WorkflowSpecSchema.parse(res.output);
    if (!hit && useCache) writeCache(key, res);
    emit({
      step: "distill.real",
      mode: "real",
      detail: {
        provider: provider.id,
        model: res.model,
        cache_hit: hit,
        cache_key: key,
        usage: res.usage ?? null,
        rules: spec.rules.length,
        proof_sources: spec.proof_sources.length,
        open_questions: spec.open_questions.length,
      },
    });
    const meta = LearnMetaSchema.parse({ mode: "real", model: res.model, recording_path, generated_at: now().toISOString() });
    return { spec, meta, cacheHit: hit, fallbackReason: null, usage: res.usage };
  } catch (err) {
    const reason = describeError(err);
    emit({ step: "distill.real_failed", mode: "deterministic", detail: { provider: provider.id, model: provider.model, error: reason } });
    return deterministic(reason);
  }
}
