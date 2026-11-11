/**
 * C8 gate. Summary = mean of each metric over the graded cases (nullable metrics: mean over non-null, else null).
 * The run passes only if every GATE threshold holds on the summary AND no case failed to grade (a case the harness
 * could not grade is a failure of the run, never a silent zero or a silent skip).
 */
import { GATE, type SkillEvalMetrics, type SkillEvalResult } from "@/contracts";
import { mean, round } from "./text";

export interface CaseError {
  case_id: string;
  variant: string;
  stage: "recording" | "learn" | "judge" | "grade";
  error: string;
}

export function summarize(results: SkillEvalResult[]): SkillEvalMetrics {
  const m = (k: keyof SkillEvalMetrics) => round(mean(results.map((r) => r.metrics[k] as number)));
  const mn = (k: keyof SkillEvalMetrics) => {
    const xs = results.map((r) => r.metrics[k]).filter((x): x is number => x != null);
    return xs.length ? round(mean(xs)) : null;
  };
  return {
    rule_recall: m("rule_recall"),
    rule_precision: m("rule_precision"),
    citations_valid: m("citations_valid"),
    coverage: m("coverage"),
    replay_agreement: m("replay_agreement"),
    consistency: mn("consistency"),
    wer: mn("wer"),
    keyterm_accuracy: mn("keyterm_accuracy"),
  };
}

export function evaluateGate(
  summary: SkillEvalMetrics,
  results: SkillEvalResult[],
  errors: CaseError[],
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (results.length === 0) failures.push("No case was graded.");
  for (const [k, threshold] of Object.entries(GATE) as [keyof typeof GATE, number][]) {
    const v = summary[k];
    if (v < threshold) {
      const below = results.filter((r) => r.metrics[k] < threshold).map((r) => r.case_id);
      failures.push(`${k} ${v.toFixed(2)} < ${threshold.toFixed(2)}${below.length ? ` (cases: ${below.join(", ")})` : ""}`);
    }
  }
  for (const e of errors) failures.push(`case ${e.case_id} not graded (${e.stage}): ${e.error}`);
  return { passed: failures.length === 0, failures };
}
