/**
 * Stage 2, claims (Claude, real): the transcript and the step list go to Claude as two plain-text documents
 * with citations enabled. Claude lists the claims the reviewer made or demonstrated, one per line; the API
 * attaches char_location citations that point at the exact words (or recorded steps) behind each claim.
 *
 * Citations cannot be combined with structured outputs (400), so this stage is a plain create call and the
 * structured stages (synthesize, critique) come after it.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Citation } from "@/contracts";
import { buildStepsDoc, buildTranscriptDoc, mapCitation, type CharCitation, type StepsDoc, type TranscriptDoc } from "./citations";
import { baseParams, modelCall, type MessageLike, type SkillClient } from "./client";
import type { CallMeta, Claim, Segmented } from "./types";
import { engineConfig } from "@/config/engine";

export const CLAIMS_SYSTEM = `You read a recorded demonstration of a back-office review. Document 1 is what the reviewer said, one
utterance per line. Document 2 lists what the reviewer did on screen (navigations, clicks, inputs), one step per line.

List every claim the reviewer made or demonstrated about how to do this review on future items: checks they apply,
values they compare, how they decide, the steps they follow, and where they look. Also list questions they left open.
Write one claim per line, each line starting with "- ". Keep each claim to one plain sentence.
Cite the exact spoken words behind each claim. When a claim comes only from what the reviewer did (a field they
opened or inspected but never talked about), cite the recorded step instead. Do not state anything the documents do
not support, and do not describe the specific item reviewed (e.g. "Maya billed 40 hours") as a rule.`;

export function claimsRequest(seg: Segmented, tdoc: TranscriptDoc, sdoc: StepsDoc): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    ...baseParams(16000),
    output_config: { effort: engineConfig.effort },
    system: CLAIMS_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "text", media_type: "text/plain", data: tdoc.text || "(no speech)" }, title: "Transcript", citations: { enabled: true } },
          { type: "document", source: { type: "text", media_type: "text/plain", data: sdoc.text || "(no steps)" }, title: "Recorded steps", citations: { enabled: true } },
          { type: "text", text: `Recording ${seg.session_id}. List the claims, one per line, starting with "- ".` },
        ],
      },
    ],
  };
}

interface TextBlockLike {
  type: string;
  text?: string;
  citations?: CharCitation[] | null;
}

/**
 * Turn the response's text blocks into claims. The API splits the answer into blocks; cited spans carry a
 * `citations` array. Lines (split on newlines across blocks) are claims; a block's citations belong to the line
 * the block is on.
 */
export function claimsFromContent(content: unknown[], seg: Segmented, tdoc: TranscriptDoc, sdoc: StepsDoc): { claims: Claim[]; raw: CharCitation[] } {
  const lines: { text: string; cites: CharCitation[] }[] = [{ text: "", cites: [] }];
  const raw: CharCitation[] = [];
  for (const b of content as TextBlockLike[]) {
    if (b.type !== "text" || typeof b.text !== "string") continue;
    const parts = b.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push({ text: "", cites: [] });
      lines[lines.length - 1].text += part;
    });
    for (const c of b.citations ?? []) {
      raw.push(c);
      // A cited block normally has no newline; attach to the line it ends on, or the last non-empty line.
      let target = lines[lines.length - 1];
      if (!target.text.trim()) target = [...lines].reverse().find((l) => l.text.trim()) ?? target;
      target.cites.push(c);
    }
  }
  const claims: Claim[] = [];
  for (const l of lines) {
    const text = l.text.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!text) continue;
    const cites: Citation[] = [];
    for (const c of l.cites) {
      for (const m of mapCitation(c, seg, tdoc, sdoc)) {
        if (!cites.some((x) => x.utterance_id === m.utterance_id && x.quote === m.quote && x.step_index === m.step_index)) cites.push(m);
      }
    }
    claims.push({ id: `c${claims.length + 1}`, text, citations: cites });
  }
  return { claims, raw };
}

export async function runClaims(
  client: SkillClient,
  seg: Segmented,
  opts: { noCache?: boolean } = {},
): Promise<{ claims: Claim[]; raw: CharCitation[]; meta: CallMeta }> {
  const tdoc = buildTranscriptDoc(seg);
  const sdoc = buildStepsDoc(seg);
  const req = claimsRequest(seg, tdoc, sdoc);
  const { value, meta } = await modelCall(
    () => client.beta.messages.create(req),
    (msg: MessageLike) => ({ content: msg.content ?? [] }),
    { purpose: "skill-claims", cache: { namespace: "skill-claims", parts: { system: req.system, messages: req.messages } }, noCache: opts.noCache },
  );
  const { claims, raw } = claimsFromContent(value.content, seg, tdoc, sdoc);
  return { claims, raw, meta };
}
