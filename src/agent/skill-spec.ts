/**
 * Active skill → the browser task prompt (item 9). When the router picks a skill version, the engine
 * builds the browser agent's instructions from that skill's rules + portal map instead of
 * rules/workflow_spec.json. The skill is also mapped to a WorkflowSpec so the rest of the engine
 * (evidence plan, synthesis prompt, mock receipt) keeps its frozen inputs.
 */
import type { SkillVersion, WorkflowSpec } from "@/contracts";

export function specFromSkill(s: SkillVersion): WorkflowSpec {
  return {
    vendor: s.vendor,
    proof_sources: s.portal_map.map((p) => ({
      app: "Vendor portal",
      location: p.page,
      fields: p.fields.map((f) => f.name),
    })),
    rules: s.rules.map((r) => r.text),
    open_questions: [...s.open_questions],
  };
}

/** Prompt lines describing the skill: its rules (with how each was learned) and where the proof lives. */
export function skillPromptLines(s: SkillVersion): string[] {
  const lines = [`Skill: ${s.title} (${s.skill_id} v${s.version}), learned from the recorded reviewer session(s).`, "", "Rules:"];
  for (const r of s.rules) lines.push(`- [${r.id}] ${r.text}`);
  if (s.portal_map.length > 0) {
    lines.push("", "Portal map (pages and the fields to read on them):");
    for (const p of s.portal_map) {
      const fields = p.fields.map((f) => `${f.name} (${f.selector})`).join(", ");
      lines.push(`- ${p.page}${fields ? `: ${fields}` : ""}`);
    }
  }
  if (s.open_questions.length > 0) {
    lines.push("", "Open questions (do not try to answer them; just gather the facts):");
    for (const q of s.open_questions) lines.push(`- ${q}`);
  }
  return lines;
}
