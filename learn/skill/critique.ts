/**
 * Stage 4, critique (Claude, structured output): a second reader checks the draft against the transcript and the
 * steps, flags rules that are unsupported or invented, and lists gaps. Then plain code applies it: flagged rules
 * and every rule without a verified citation are dropped, gaps become open questions. Offline, only the code part
 * runs (mode deterministic).
 */
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SkillRule } from "@/contracts";
import { engineConfig } from "@/config/engine";
import { baseParams, modelCall, SkillModelError, type SkillClient } from "./client";
import type { CallMeta, Segmented, SkillDraft } from "./types";

export const CritiqueApiSchema = z.object({
  verdicts: z.array(
    z.object({
      rule_id: z.string(),
      verdict: z.enum(["supported", "unsupported", "invented"]),
      reason: z.string(),
    }),
  ),
  gaps: z.array(z.string()).describe("Things the reviewer did or said that no rule covers, or that stay unclear, phrased as questions"),
});
export type CritiqueApi = z.infer<typeof CritiqueApiSchema>;

export const CRITIQUE_SYSTEM = `You audit a skill that was distilled from a recorded demonstration. For each rule decide:
"supported" if the cited words or steps really say or show it, "unsupported" if its citations do not back it,
"invented" if it adds values, pages or behavior that appear nowhere in the recording. Be strict: a rule is only
supported if the recording backs every concrete value in it. Then list gaps: things the reviewer did or said that no
rule covers, or that remain unclear, phrased as open questions. Do not repeat open questions the skill already has.`;

export function critiquePrompt(seg: Segmented, draft: SkillDraft): string {
  return [
    "Transcript (utterance id: words):",
    seg.utterances.map((u) => `${u.id}: ${u.text}`).join("\n"),
    "",
    "Recorded dom steps:",
    seg.steps
      .filter((s) => s.kind === "dom")
      .map((s) => `#${s.index} ${s.event ?? ""} ${s.page ?? ""} ${s.selector ?? ""} ${s.text ? `"${s.text}"` : ""}`.replace(/\s+/g, " ").trim())
      .join("\n"),
    "",
    "Skill draft:",
    JSON.stringify({ vendor: draft.vendor, rules: draft.rules, portal_map: draft.portal_map, open_questions: draft.open_questions }, null, 1),
  ].join("\n");
}

export interface CritiqueResult {
  draft: SkillDraft;
  dropped: { rule: SkillRule; reason: string }[];
  added_questions: string[];
  verdicts: CritiqueApi["verdicts"];
}

/** Apply a critique (or none, offline): drop flagged and uncited rules, renumber, add gaps as open questions. */
export function applyCritique(draft: SkillDraft, critique: CritiqueApi | null): CritiqueResult {
  const dropped: CritiqueResult["dropped"] = [];
  const kept: SkillRule[] = [];
  for (const r of draft.rules) {
    const v = critique?.verdicts.find((x) => x.rule_id === r.id);
    if (r.citations.length === 0) dropped.push({ rule: r, reason: "no verified citation" });
    else if (v && v.verdict !== "supported") dropped.push({ rule: r, reason: `${v.verdict}: ${v.reason}` });
    else kept.push(r);
  }
  const rules = kept.map((r, i) => ({ ...r, id: `r${i + 1}` }));
  const have = new Set(draft.open_questions.map((q) => q.toLowerCase()));
  const added_questions: string[] = [];
  for (const g of critique?.gaps ?? []) {
    const q = g.trim();
    if (q && !have.has(q.toLowerCase())) {
      have.add(q.toLowerCase());
      added_questions.push(q);
    }
  }
  return {
    draft: { ...draft, rules, open_questions: [...draft.open_questions, ...added_questions] },
    dropped,
    added_questions,
    verdicts: critique?.verdicts ?? [],
  };
}

export async function runCritique(
  client: SkillClient,
  seg: Segmented,
  draft: SkillDraft,
  opts: { noCache?: boolean } = {},
): Promise<{ api: CritiqueApi; meta: CallMeta }> {
  const prompt = critiquePrompt(seg, draft);
  const { value, meta } = await modelCall(
    () =>
      client.beta.messages.parse({
        ...baseParams(16000),
        output_config: { effort: engineConfig.effort, format: betaZodOutputFormat(CritiqueApiSchema) },
        system: CRITIQUE_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }),
    (msg) => {
      if (msg.parsed_output == null) throw new SkillModelError("Structured output failed to parse");
      return CritiqueApiSchema.parse(msg.parsed_output);
    },
    { purpose: "skill-critique", cache: { namespace: "skill-critique", parts: { system: CRITIQUE_SYSTEM, prompt } }, noCache: opts.noCache },
  );
  return { api: value, meta };
}
