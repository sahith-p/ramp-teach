/**
 * Stage 3, synthesize (Claude, structured output): claims + episodes + steps -> rules (kind, source, citations),
 * portal map, vendor, open questions. The output is re-checked in code: every citation must quote words from the
 * transcript (or name a recorded dom step), and a rule's `source` is made consistent with its citations.
 */
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Citation, PortalPage, SkillRule } from "@/contracts";
import { engineConfig } from "@/config/engine";
import { verifyCitation } from "./citations";
import { baseParams, modelCall, SkillModelError, type SkillClient } from "./client";
import { evidencePages } from "./segment";
import type { CallMeta, Claim, Segmented, SkillDraft } from "./types";

/** API-facing schema (no length limits; nullable instead of optional for structured outputs). */
export const ApiCitationSchema = z.object({
  utterance_id: z.string().nullable().describe("Utterance id (u1, u2, ...) the quote comes from; null for a step-only citation"),
  quote: z.string().describe("Exact words copied from that utterance; for a step-only citation, the step's visible text"),
  step_index: z.number().int().nullable().describe("Index of the recorded dom step this is about (#n in the step list), or null"),
});

export const ApiRuleSchema = z.object({
  text: z.string().describe("One self-contained, checkable sentence with the concrete values stated"),
  kind: z.enum(["check", "decision", "procedure"]),
  source: z.enum(["said", "shown", "both"]).describe("said = spoken; shown = a field the reviewer opened or inspected but never talked about; both"),
  citations: z.array(ApiCitationSchema),
});

export const SynthesisApiSchema = z.object({
  title: z.string().describe("Short title of the skill"),
  vendor: z.string().describe('Vendor name as stated or shown in the recording, or "Not stated in recording"'),
  rules: z.array(ApiRuleSchema),
  portal_map: z.array(
    z.object({
      page: z.string().describe("Page path template from the step list, e.g. /portal/employees/<employee_id>?week=<YYYY-MM-DD>"),
      fields: z.array(z.object({ name: z.string(), selector: z.string().describe("CSS selector as recorded (generalize ids into a prefix match)") })),
    }),
  ),
  open_questions: z.array(z.string()),
});
export type SynthesisApi = z.infer<typeof SynthesisApiSchema>;

export const SYNTH_SYSTEM = `You turn a recorded demonstration into a reusable skill for an agent that will repeat the review on new items.
You get: the reviewer's claims with the exact words they cite, the utterances (id, text, linked steps), and the recorded steps
grouped by page.

Return rules, a portal map, the vendor and open questions.
- rules: kind "check" (something to verify), "decision" (what to recommend when checks pass or fail), or "procedure"
  (how to gather evidence). source "said" if the reviewer said it, "shown" if it comes only from a field they opened or
  inspected without talking about it, "both" if both. Every rule MUST carry at least one citation: copy the exact words
  from the utterance (with its id and the step it links to), or for a shown rule the step index and the element's text.
- portal_map: each page the workflow goes through, in order: the sign-in page with its input field names (never values), then each page where evidence is read, with the fields read there and their selectors
  from the recorded steps.
- Only use what the recording supports. Never invent values, pages, fields or rules. Rules must be general, not facts
  about the specific item reviewed.`;

export function synthPrompt(seg: Segmented, claims: Claim[], hints: string): string {
  const episodes = seg.episodes.map((e) => ({
    page: e.page,
    title: e.title,
    sign_in: e.auth || undefined,
    steps: e.dom_step_indices.map((i) => {
      const s = seg.steps[i];
      return { "#": i, event: s.event, selector: s.selector ?? undefined, text: s.text ?? undefined };
    }),
    utterances: e.utterance_ids,
  }));
  return [
    "Domain hints:",
    hints.trim(),
    "",
    "Claims (with the citations the API attached):",
    JSON.stringify(claims.map((c) => ({ id: c.id, text: c.text, citations: c.citations.map((x) => ({ utterance_id: x.utterance_id, quote: x.quote, step_index: x.step_index })) })), null, 1),
    "",
    "Utterances:",
    JSON.stringify(seg.utterances.map((u) => ({ id: u.id, text: u.text, step_refs: u.step_refs })), null, 1),
    "",
    "Recorded steps by page:",
    JSON.stringify(episodes, null, 1),
    "",
    "Write the skill.",
  ].join("\n");
}

/** Make `source` agree with the verified citations. */
export function reconcileSource(source: SkillRule["source"], citations: Citation[]): SkillRule["source"] {
  const said = citations.some((c) => c.utterance_id !== null);
  const shown = citations.some((c) => c.utterance_id === null);
  if (said && shown) return "both";
  if (said) return source === "shown" ? "both" : source === "both" ? "both" : "said";
  if (shown) return "shown";
  return source;
}

const dedupeCitations = (cs: Citation[]) =>
  cs.filter((c, i) => cs.findIndex((x) => x.utterance_id === c.utterance_id && x.quote === c.quote && x.step_index === c.step_index) === i);

/** Verify every citation; rules keep their order and get ids r1..; uncited rules are kept (critique drops them). */
export function normalizeDraft(api: SynthesisApi, seg: Segmented): { draft: SkillDraft; rejected_citations: number } {
  let rejected = 0;
  const rules: SkillRule[] = api.rules.map((r, i) => {
    const cites: Citation[] = [];
    for (const c of r.citations) {
      const v = verifyCitation(c, seg);
      if (v) cites.push(v);
      else rejected++;
    }
    const citations = dedupeCitations(cites);
    return { id: `r${i + 1}`, text: r.text.trim(), kind: r.kind, source: reconcileSource(r.source, citations), citations };
  });
  const pages = new Set(evidencePages(seg));
  const portal_map: PortalPage[] = [];
  for (const p of api.portal_map) {
    if (!pages.has(p.page) && !/^data\//.test(p.page)) continue; // never a page the reviewer did not visit
    const existing = portal_map.find((x) => x.page === p.page);
    const fields = p.fields.filter((f) => f.name.trim() && f.selector.trim());
    if (existing) {
      for (const f of fields) if (!existing.fields.some((x) => x.name === f.name)) existing.fields.push(f);
    } else portal_map.push({ page: p.page, fields });
  }
  return {
    draft: {
      title: api.title.trim(),
      vendor: api.vendor.trim() || "Not stated in recording",
      rules,
      portal_map,
      open_questions: [...new Set(api.open_questions.map((q) => q.trim()).filter(Boolean))],
    },
    rejected_citations: rejected,
  };
}

export async function runSynthesize(
  client: SkillClient,
  seg: Segmented,
  claims: Claim[],
  hints: string,
  opts: { noCache?: boolean } = {},
): Promise<{ api: SynthesisApi; draft: SkillDraft; rejected_citations: number; meta: CallMeta }> {
  const prompt = synthPrompt(seg, claims, hints);
  const { value, meta } = await modelCall(
    () =>
      client.beta.messages.parse({
        ...baseParams(16000),
        output_config: { effort: engineConfig.effort, format: betaZodOutputFormat(SynthesisApiSchema) },
        system: SYNTH_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }),
    (msg) => {
      if (msg.parsed_output == null) throw new SkillModelError("Structured output failed to parse");
      return SynthesisApiSchema.parse(msg.parsed_output);
    },
    { purpose: "skill-synthesize", cache: { namespace: "skill-synthesize", parts: { system: SYNTH_SYSTEM, prompt } }, noCache: opts.noCache },
  );
  const { draft, rejected_citations } = normalizeDraft(value, seg);
  return { api: value, draft, rejected_citations, meta };
}
