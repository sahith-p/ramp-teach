/**
 * C6 consistency: are the skills learned from two wordings of the same review equivalent?
 * Only substantive rules (kind "check" or "decision") are compared; procedure wording may differ freely.
 *   score = 2 x equivalent pairs / (substantive rules in A + substantive rules in B)   (0 when both have none)
 * The pairing comes from the judge (./judge.ts); the score is computed here.
 */
import type { SkillVersion } from "@/contracts";
import type { ConsistencyJudgeOutput, LearnedRuleView } from "./judge";

export const substantiveRules = (s: Pick<SkillVersion, "rules">): LearnedRuleView[] =>
  s.rules.filter((r) => r.kind === "check" || r.kind === "decision").map(({ id, kind, source, text }) => ({ id, kind, source, text }));

export function scoreConsistency(
  a: LearnedRuleView[],
  b: LearnedRuleView[],
  judged: ConsistencyJudgeOutput,
): { score: number; notes: string[] } {
  const aIds = new Set(a.map((r) => r.id));
  const bIds = new Set(b.map((r) => r.id));
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const notes: string[] = [];
  for (const p of judged.pairs) {
    if (!p.equivalent || !aIds.has(p.a_rule_id) || !bIds.has(p.b_rule_id)) {
      if (!p.equivalent) notes.push(`DIFFERENT A.${p.a_rule_id} vs B.${p.b_rule_id}: ${p.reason}`);
      continue;
    }
    if (usedA.has(p.a_rule_id) || usedB.has(p.b_rule_id)) continue; // each rule pairs once
    usedA.add(p.a_rule_id);
    usedB.add(p.b_rule_id);
  }
  for (const u of judged.unmatched_a) notes.push(`ONLY IN A ${u.rule_id}: ${u.reason}`);
  for (const u of judged.unmatched_b) notes.push(`ONLY IN B ${u.rule_id}: ${u.reason}`);
  const denom = a.length + b.length;
  const score = denom ? (2 * usedA.size) / denom : 0;
  notes.unshift(`${usedA.size} equivalent pairs over ${a.length} + ${b.length} substantive rules. ${judged.summary}`);
  return { score, notes };
}
