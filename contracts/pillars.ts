/**
 * Contracts for the three pillars + observability (approved by the project owner in chat, 2026-11-11):
 *   VOICE      speech-to-text with word timing, linked to the recorded clicks
 *   SKILL      versioned skills learned from recordings, every rule cited; skill evals + promotion gate
 *   EXECUTION  spans for every model turn / tool call, live frames, evidence re-checked against the page
 *
 * Additive only. Nothing in core.ts / supporting.ts / evidence.ts / engine.ts changes meaning; the Recording
 * gains two optional fields (`audio`, `speech`) defined here.
 *
 * Modes (same rule as everywhere): "real" = a model produced it (Claude, or the ElevenLabs speech model),
 * "scripted" = fixed steps or simulated input (e.g. the demo's simulated voice), "mock" = no model, made up
 * for offline runs, "deterministic" = plain code.
 */
import { z } from "zod";

export const PillarModeSchema = z.enum(["real", "scripted", "mock", "deterministic"]);
export type PillarMode = z.infer<typeof PillarModeSchema>;

/* =================================== VOICE =================================== */

/** One word with timing in seconds from the recording's start (`Recording.started_at`). */
export const SpeechWordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  /** 0..1 when the provider gives it. */
  confidence: z.number().min(0).max(1).optional(),
});
export type SpeechWord = z.infer<typeof SpeechWordSchema>;

/** A sentence-level unit of speech, linked to the recorded DOM steps it is about. */
export const UtteranceSchema = z.object({
  id: z.string(), // "u1", "u2", ...
  text: z.string(),
  start: z.number(),
  end: z.number(),
  words: z.array(SpeechWordSchema),
  /** Indices into Recording.steps of the dom steps this utterance is about (speech ↔ click alignment). */
  step_refs: z.array(z.number().int().nonnegative()),
  /** Words below the confidence threshold, for the correction UI. */
  low_confidence: z.array(z.string()).default([]),
});
export type Utterance = z.infer<typeof UtteranceSchema>;

export const SpeechProviderSchema = z.enum(["elevenlabs", "browser", "simulated"]);

export const SpeechTranscriptSchema = z.object({
  provider: SpeechProviderSchema,
  /** e.g. "scribe_v2" for ElevenLabs batch; null for browser / simulated. */
  model: z.string().nullable(),
  /** real = ElevenLabs transcribed real audio; scripted = simulated voice (demo); mock = offline stand-in. */
  mode: PillarModeSchema,
  language: z.string().nullable(),
  /** Key terms sent to the speech model (names, IDs, labels visible on the recorded pages). */
  keyterms: z.array(z.string()),
  utterances: z.array(UtteranceSchema),
  /** Provider request id when there was one (never secrets). */
  request_id: z.string().nullable().optional(),
});
export type SpeechTranscript = z.infer<typeof SpeechTranscriptSchema>;

export const RecordingAudioSchema = z.object({
  /** Repo-relative path, e.g. "runtime/recordings/<session_id>.webm". */
  path: z.string(),
  mime: z.string(),
  duration_s: z.number().nonnegative(),
});
export type RecordingAudio = z.infer<typeof RecordingAudioSchema>;

/** Optional fields a Recording may carry (merged into RecordingSchema via `.passthrough()`-free extension in core.ts). */
export const RecordingVoiceFieldsSchema = z.object({
  audio: RecordingAudioSchema.optional(),
  speech: SpeechTranscriptSchema.optional(),
});

/* =================================== SKILL =================================== */

export const CitationSchema = z.object({
  /** Utterance id when the rule came from speech. */
  utterance_id: z.string().nullable(),
  /** Exact quoted words (must appear in the transcript; checked by the citation eval). */
  quote: z.string(),
  /** Index into Recording.steps of the linked dom step (the click), if any. */
  step_index: z.number().int().nonnegative().nullable(),
  selector: z.string().nullable(),
  url: z.string().nullable(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const SkillRuleSchema = z.object({
  id: z.string(), // "r1", ...
  text: z.string(),
  kind: z.enum(["check", "decision", "procedure"]),
  /** Said, shown (clicked but not said), or both. */
  source: z.enum(["said", "shown", "both"]),
  citations: z.array(CitationSchema),
});
export type SkillRule = z.infer<typeof SkillRuleSchema>;

export const PortalPageSchema = z.object({
  /** Path pattern, e.g. "/portal/employees/<employee_id>?week=<YYYY-MM-DD>". */
  page: z.string(),
  fields: z.array(z.object({ name: z.string(), selector: z.string() })),
});
export type PortalPage = z.infer<typeof PortalPageSchema>;

export const LearnStageNameSchema = z.enum(["segment", "claims", "synthesize", "critique", "checks", "package"]);
export const LearnStageSchema = z.object({
  name: LearnStageNameSchema,
  mode: PillarModeSchema,
  started_at: z.string(),
  finished_at: z.string(),
  /** Repo-relative path of the stage's saved output. */
  output_path: z.string(),
  model: z.string().nullable(),
  request_id: z.string().nullable().optional(),
  usage: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type LearnStage = z.infer<typeof LearnStageSchema>;

/** A check script the skill carries (written by Claude, run in a sandbox, cross-checked against calc/). */
export const SkillCheckSchema = z.object({
  name: z.string(), // matches a CHECK_NAMES entry when it mirrors one
  file: z.string(), // repo-relative, e.g. "skills/halcyon-invoice-review/v3/checks/hours.py"
  language: z.literal("python"),
});

export const SkillStatusSchema = z.enum(["draft", "active", "blocked"]);

export const SkillVersionSchema = z.object({
  skill_id: z.string(), // "halcyon-invoice-review"
  version: z.number().int().positive(),
  title: z.string(),
  created_at: z.string(),
  mode: PillarModeSchema,
  /** Recording session ids it was learned from. */
  recordings: z.array(z.string()),
  vendor: z.string(),
  rules: z.array(SkillRuleSchema),
  portal_map: z.array(PortalPageSchema),
  open_questions: z.array(z.string()),
  checks: z.array(SkillCheckSchema),
  stages: z.array(LearnStageSchema),
  /** Repo-relative package folder holding SKILL.md, skill.json, checks/. */
  package_dir: z.string(),
  /** Set when uploaded through Anthropic's Skills API. */
  anthropic_skill: z.object({ id: z.string(), version: z.string() }).nullable(),
  status: SkillStatusSchema,
  /** Latest eval run for this version, if any. */
  eval_run_id: z.string().nullable(),
});
export type SkillVersion = z.infer<typeof SkillVersionSchema>;

/** Signature of the learner (learn/skill/index.ts). Evals call it; tests pass a fake. */
export interface LearnSkillOptions {
  offline?: boolean;
  noCache?: boolean;
  /** Persist as a new version (default true). Evals pass false to learn into a temp dir. */
  persist?: boolean;
  outDir?: string;
}
export type LearnSkillFn = (
  recording: import("./core").Recording,
  opts?: LearnSkillOptions,
) => Promise<SkillVersion>;

/* ================================ SKILL EVALS ================================ */

/** A recording with a hand-written gold answer for what a correct skill must contain. */
export const SkillEvalCaseSchema = z.object({
  id: z.string(),
  /** Short label of how this recording differs, e.g. "reordered", "shown-not-said", "stt-noise". */
  variant: z.string(),
  recording_path: z.string(),
  /** Reference transcript for the voice accuracy eval (optional). */
  reference_transcript: z.string().nullable(),
  gold: z.object({
    rules: z.array(z.string()),
    pages: z.array(z.string()),
    fields: z.array(z.string()),
    decision_rule: z.string(),
  }),
});
export type SkillEvalCase = z.infer<typeof SkillEvalCaseSchema>;

export const SkillEvalMetricsSchema = z.object({
  rule_recall: z.number().min(0).max(1),
  rule_precision: z.number().min(0).max(1),
  citations_valid: z.number().min(0).max(1),
  coverage: z.number().min(0).max(1),
  replay_agreement: z.number().min(0).max(1),
  consistency: z.number().min(0).max(1).nullable(),
  wer: z.number().min(0).nullable(),
  keyterm_accuracy: z.number().min(0).max(1).nullable(),
});
export type SkillEvalMetrics = z.infer<typeof SkillEvalMetricsSchema>;

export const SkillEvalResultSchema = z.object({
  case_id: z.string(),
  variant: z.string(),
  metrics: SkillEvalMetricsSchema,
  /** Grader notes per metric (e.g. which gold rule was missed, which rule was invented). */
  notes: z.record(z.string(), z.array(z.string())),
  mode: PillarModeSchema,
});
export type SkillEvalResult = z.infer<typeof SkillEvalResultSchema>;

export const SkillEvalRunSchema = z.object({
  id: z.string(), // "eval_<skill_id>_v<version>_<UTC stamp>"
  skill_id: z.string(),
  version: z.number().int().positive(),
  created_at: z.string(),
  mode: PillarModeSchema,
  results: z.array(SkillEvalResultSchema),
  summary: SkillEvalMetricsSchema,
  gate: z.object({ passed: z.boolean(), failures: z.array(z.string()) }),
  cost_usd: z.number().nonnegative().nullable(),
});
export type SkillEvalRun = z.infer<typeof SkillEvalRunSchema>;

/** Promotion thresholds (gate). A version becomes active only if every one holds. */
export const GATE = {
  rule_recall: 1.0,
  rule_precision: 1.0,
  citations_valid: 1.0,
  coverage: 0.9,
  replay_agreement: 1.0,
} as const;

/* ========================= EXECUTION + OBSERVABILITY ========================= */

export const SpanKindSchema = z.enum(["run", "model", "tool", "calc", "verify", "synthesis", "learn", "stt", "eval"]);

/** One timed step. Written as JSONL to runs/<invoice_id>/spans.jsonl (and per learn/eval run). */
export const SpanSchema = z.object({
  span_id: z.string(),
  parent_id: z.string().nullable(),
  trace_id: z.string(), // run id
  name: z.string(), // e.g. "turn 3", "left_click ref_4", "calc.with_evidence"
  kind: SpanKindSchema,
  mode: PillarModeSchema,
  start: z.string(), // ISO
  end: z.string(), // ISO
  /** Model spans: model, request_id, message_id, input/output/cache tokens, cost_usd, note (progress update).
   *  Tool spans: tool, input (redacted), result summary, screenshot (repo-relative path), url. */
  attrs: z.record(z.string(), z.unknown()),
});
export type Span = z.infer<typeof SpanSchema>;

/** A recorded fact re-read from its source page by plain code after the run. */
export const EvidenceCheckSchema = z.object({
  key: z.string(),
  subject: z.record(z.string(), z.string()),
  source: z.string(), // "fixture:/portal/..."
  value: z.string(),
  rechecked_value: z.string().nullable(),
  status: z.enum(["match", "mismatch", "unavailable"]),
  screenshot: z.string().nullable(), // crop of the field, repo-relative
});
export type EvidenceCheck = z.infer<typeof EvidenceCheckSchema>;

export const EvidenceCheckReportSchema = z.object({
  invoice_id: z.string(),
  checked_at: z.string(),
  mode: z.literal("deterministic"),
  checks: z.array(EvidenceCheckSchema),
});
export type EvidenceCheckReport = z.infer<typeof EvidenceCheckReportSchema>;
