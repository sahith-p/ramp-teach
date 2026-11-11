/**
 * Internal shapes of the skill learner (learn/skill/). The persisted, shared shapes live in
 * contracts/pillars.ts (SkillVersion, SkillRule, Citation, LearnStage, Utterance).
 */
import type { Citation, PillarMode, PortalPage, SkillRule, Utterance } from "@/contracts";

/** One recorded step, reduced to what the learner reads. `index` is the index into Recording.steps. */
export interface StepView {
  index: number;
  kind: "dom" | "narration";
  event: string | null;
  url: string | null;
  /** URL template, e.g. "/portal/employees/<employee_id>?week=<YYYY-MM-DD>" (null for no url). */
  page: string | null;
  title: string | null;
  selector: string | null;
  text: string | null;
  value: string | null;
}

/** Consecutive steps on one page. */
export interface Episode {
  id: string; // "e1", ...
  url: string | null;
  page: string | null;
  title: string | null;
  step_indices: number[];
  dom_step_indices: number[];
  utterance_ids: string[];
  /** A password was typed here (sign-in page): not a place evidence is read. */
  auth: boolean;
}

export interface Segmented {
  session_id: string;
  /** Where the utterances came from. */
  utterance_source: "speech" | "narration" | "transcript";
  utterances: Utterance[];
  /** For utterances made from narration steps: utterance id -> index of that narration step. */
  narration_step: Record<string, number>;
  episodes: Episode[];
  steps: StepView[];
}

/** A claim the reviewer made or demonstrated, with its citations mapped onto the recording. */
export interface Claim {
  id: string; // "c1", ...
  text: string;
  citations: Citation[];
}

export interface ClaimsOutput {
  mode: PillarMode;
  claims: Claim[];
  /** Raw citations as the API returned them (real mode), for audit. */
  raw_citations?: unknown[];
  fallback_reason?: string | null;
}

/** Draft skill content before packaging. */
export interface SkillDraft {
  title: string;
  vendor: string;
  rules: SkillRule[];
  portal_map: PortalPage[];
  open_questions: string[];
}

/** What a model-backed stage returns besides its payload. */
export interface CallMeta {
  model: string | null;
  request_id: string | null;
  message_id?: string | null;
  usage: Record<string, unknown> | null;
  cache_hit?: boolean;
}

/** Live progress of one stage (runtime/learn-job.json). */
export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";
