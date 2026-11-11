/**
 * C3 citations_valid (code, deterministic). A rule is valid when it has at least one citation and every citation:
 *   - quote: non-empty quotes must appear (normalized, whole words) in the recording's transcript or speech;
 *     when utterance_id is set, that utterance must exist and contain the quote;
 *   - step_index: must point at a real recorded DOM step; a selector given with it must equal that step's selector;
 *     a selector given without a step_index must be one some recorded DOM step used;
 *   - at least one of quote / step_index / selector is present (a citation that points at nothing is invalid).
 * Score = valid rules / rules (0 when the skill has no rules).
 */
import type { Recording, SkillVersion } from "@/contracts";
import { containsQuote } from "./text";

export interface CitationGrade {
  score: number;
  notes: string[];
}

const normSel = (s: string) => s.replace(/\s+/g, " ").replace(/'/g, '"').trim();

export function gradeCitations(skill: Pick<SkillVersion, "rules">, rec: Recording): CitationGrade {
  const notes: string[] = [];
  const transcriptText = [...rec.transcript, ...(rec.speech?.utterances.map((u) => u.text) ?? [])].join(" \n ");
  const utterances = new Map((rec.speech?.utterances ?? []).map((u) => [u.id, u]));
  const domSelectors = new Set(
    rec.steps.filter((s) => s.kind === "dom" && s.detail.selector).map((s) => normSel(s.detail.selector!)),
  );
  if (skill.rules.length === 0) return { score: 0, notes: ["No rules to cite."] };

  let valid = 0;
  for (const rule of skill.rules) {
    const problems: string[] = [];
    if (rule.citations.length === 0) problems.push("no citations");
    rule.citations.forEach((c, i) => {
      const tag = `citation ${i + 1}`;
      const quote = c.quote.trim();
      if (!quote && c.step_index == null && !c.selector) problems.push(`${tag} points at nothing`);
      // A "shown" citation (no utterance) quotes the clicked element's text or selector, not spoken words.
      const step = c.step_index != null ? rec.steps[c.step_index] : undefined;
      const shownOk =
        !c.utterance_id &&
        step?.kind === "dom" &&
        !!quote &&
        (containsQuote(step.detail.text ?? "", quote) || normSel(step.detail.selector ?? "") === normSel(quote));
      if (quote && shownOk) {
        /* step citation: checked below against the step */
      } else if (quote) {
        if (!containsQuote(transcriptText, quote)) problems.push(`${tag} quote not in transcript: "${quote}"`);
        if (c.utterance_id) {
          const u = utterances.get(c.utterance_id);
          if (!u) problems.push(`${tag} utterance ${c.utterance_id} does not exist`);
          else if (!containsQuote(u.text, quote)) problems.push(`${tag} quote not in utterance ${c.utterance_id}`);
        }
      } else if (c.utterance_id && !utterances.has(c.utterance_id)) {
        problems.push(`${tag} utterance ${c.utterance_id} does not exist`);
      }
      if (c.step_index != null) {
        const step = rec.steps[c.step_index];
        if (!step) problems.push(`${tag} step_index ${c.step_index} is past the last step (${rec.steps.length - 1})`);
        else if (step.kind !== "dom") problems.push(`${tag} step_index ${c.step_index} is a narration, not a DOM step`);
        else if (c.selector && normSel(c.selector) !== normSel(step.detail.selector ?? "")) {
          problems.push(
            `${tag} selector ${c.selector} does not match step ${c.step_index} (${step.detail.selector ?? step.detail.event ?? "no selector"})`,
          );
        }
      } else if (c.selector && !domSelectors.has(normSel(c.selector))) {
        problems.push(`${tag} selector ${c.selector} was never used in the recording`);
      }
    });
    if (problems.length === 0) valid++;
    else notes.push(`INVALID ${rule.id} ("${short(rule.text)}"): ${problems.join("; ")}`);
  }
  if (valid === skill.rules.length) notes.push(`All ${valid} rules cite real transcript words and recorded steps.`);
  return { score: valid / skill.rules.length, notes };
}

export const short = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
