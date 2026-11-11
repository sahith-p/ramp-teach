/**
 * C2 rule recall / precision, computed by code from the judge's per-rule verdicts (./judge.ts).
 *   gold items = case.gold.rules + case.gold.decision_rule
 *   recall     = gold items covered by at least one learned rule with verdict "match" / gold items
 *   precision  = learned rules that are "match" or "supported_extra" / learned rules   (0 with no rules)
 * Also returns the CHECK_NAMES the learned rules enforce (feeds C5 replay).
 */
import { CHECK_NAMES, type CheckName, type SkillEvalCase, type SkillVersion } from "@/contracts";
import { short } from "./citations";
import type { MatchJudgeOutput } from "./judge";

export interface RuleGrade {
  recall: number;
  precision: number;
  recallNotes: string[];
  precisionNotes: string[];
  checks: CheckName[];
}

export const goldItems = (c: Pick<SkillEvalCase, "gold">): string[] => [...c.gold.rules, c.gold.decision_rule];

export function scoreRules(
  c: Pick<SkillEvalCase, "gold">,
  skill: Pick<SkillVersion, "rules" | "checks">,
  judged: MatchJudgeOutput,
): RuleGrade {
  const gold = goldItems(c);
  const byId = new Map(skill.rules.map((r) => [r.id, r]));
  const covered = new Map<number, string[]>();
  const recallNotes: string[] = [];
  const precisionNotes: string[] = [];
  let grounded = 0;
  const checks = new Set<CheckName>();

  for (const v of judged.learned) {
    const rule = byId.get(v.rule_id);
    if (!rule) continue; // judge named a rule that does not exist: ignored (never credited)
    if (v.verdict === "match") {
      const valid = v.gold_indices.filter((i) => i >= 0 && i < gold.length);
      if (valid.length === 0) {
        precisionNotes.push(`INVENTED ${rule.id} ("${short(rule.text)}"): judged a match but named no gold item`);
        continue;
      }
      grounded++;
      for (const i of valid) covered.set(i, [...(covered.get(i) ?? []), rule.id]);
    } else if (v.verdict === "supported_extra") {
      grounded++;
      precisionNotes.push(`EXTRA ${rule.id} ("${short(rule.text)}"): supported by the recording, not a gold rule. ${v.reason}`);
    } else {
      precisionNotes.push(`INVENTED ${rule.id} ("${short(rule.text)}"): ${v.reason}`);
    }
    for (const ch of v.checks) checks.add(ch);
  }
  for (const ch of skill.checks) if ((CHECK_NAMES as readonly string[]).includes(ch.name)) checks.add(ch.name as CheckName);

  const goldReason = new Map(judged.gold.map((g) => [g.gold_index, g.reason]));
  gold.forEach((g, i) => {
    const by = covered.get(i);
    if (by) recallNotes.push(`FOUND gold ${i + 1} ("${short(g)}") in ${by.join(", ")}`);
    else recallNotes.push(`MISSED gold ${i + 1} ("${short(g)}"): ${goldReason.get(i) ?? "no learned rule states it"}`);
  });
  const recall = gold.length ? covered.size / gold.length : 1;
  const precision = skill.rules.length ? grounded / skill.rules.length : 0;
  if (skill.rules.length === 0) precisionNotes.push("The skill has no rules.");
  return {
    recall,
    precision,
    recallNotes: recallNotes.sort((a, b) => Number(a.startsWith("FOUND")) - Number(b.startsWith("FOUND"))),
    precisionNotes,
    checks: CHECK_NAMES.filter((n) => checks.has(n)),
  };
}
