/**
 * Citations: the claims stage sends the transcript and the step list as two plain-text documents with
 * `citations: { enabled: true }`. The API answers with `char_location` citations (document_index,
 * start_char_index, end_char_index, cited_text). This module builds those documents with an offset table and
 * maps each citation back onto utterance ids and recorded steps.
 *
 *   document 0 "Transcript"      one utterance per line, exact words
 *   document 1 "Recorded steps"  one dom step per line ("#13 click ... ")
 */
import type { Citation } from "@/contracts";
import type { Segmented, StepView } from "./types";

export interface Span {
  start: number; // inclusive char offset
  end: number; // exclusive
}

export interface TranscriptDoc {
  text: string;
  spans: { utterance_id: string; span: Span }[];
}

export interface StepsDoc {
  text: string;
  spans: { step_index: number; span: Span }[];
}

export const TRANSCRIPT_DOC_INDEX = 0;
export const STEPS_DOC_INDEX = 1;

export function buildTranscriptDoc(seg: Segmented): TranscriptDoc {
  let text = "";
  const spans: TranscriptDoc["spans"] = [];
  seg.utterances.forEach((u, i) => {
    if (i > 0) text += "\n";
    const start = text.length;
    text += u.text;
    spans.push({ utterance_id: u.id, span: { start, end: text.length } });
  });
  return { text, spans };
}

export function stepLine(s: StepView): string {
  const parts = [`#${s.index}`, s.event ?? s.kind];
  if (s.page) parts.push(`on ${s.page}`);
  if (s.selector) parts.push(`at ${s.selector}`);
  if (s.text) parts.push(`text "${s.text}"`);
  if (s.value) parts.push(`value "${s.value}"`);
  return parts.join(" ");
}

export function buildStepsDoc(seg: Segmented): StepsDoc {
  let text = "";
  const spans: StepsDoc["spans"] = [];
  for (const s of seg.steps.filter((x) => x.kind === "dom")) {
    if (text) text += "\n";
    const start = text.length;
    text += stepLine(s);
    spans.push({ step_index: s.index, span: { start, end: text.length } });
  }
  return { text, spans };
}

/** The subset of the API's char_location citation this module reads. */
export interface CharCitation {
  type: string;
  cited_text?: string;
  document_index?: number;
  start_char_index?: number;
  end_char_index?: number;
}

const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** Words a step shows (for a citation that points at a step rather than at speech). */
export function stepQuote(s: StepView): string {
  return s.text ?? s.selector ?? s.event ?? `step ${s.index}`;
}

function stepRef(seg: Segmented, index: number | null): Pick<Citation, "step_index" | "selector" | "url"> {
  const s = index == null ? null : seg.steps[index];
  return { step_index: s ? s.index : null, selector: s?.selector ?? null, url: s?.url ?? null };
}

/**
 * Map one API citation to contract Citations. A transcript citation that spans several utterances becomes one
 * Citation per utterance, each quoting exactly the overlapping words of that utterance. The linked step is the
 * first of the utterance's step_refs. A steps-document citation becomes a step citation (utterance_id null).
 * Unknown documents or offsets map to nothing.
 */
export function mapCitation(c: CharCitation, seg: Segmented, tdoc: TranscriptDoc, sdoc: StepsDoc): Citation[] {
  if (c.type !== "char_location" || typeof c.start_char_index !== "number" || typeof c.end_char_index !== "number") return [];
  const range: Span = { start: c.start_char_index, end: c.end_char_index };
  if (c.document_index === TRANSCRIPT_DOC_INDEX) {
    const out: Citation[] = [];
    for (const { utterance_id, span } of tdoc.spans) {
      if (overlap(range, span) === 0) continue;
      const quote = tdoc.text.slice(Math.max(range.start, span.start), Math.min(range.end, span.end)).trim();
      if (!quote) continue;
      const u = seg.utterances.find((x) => x.id === utterance_id)!;
      out.push({ utterance_id, quote, ...stepRef(seg, u.step_refs[0] ?? null) });
    }
    return out;
  }
  if (c.document_index === STEPS_DOC_INDEX) {
    const out: Citation[] = [];
    for (const { step_index, span } of sdoc.spans) {
      if (overlap(range, span) === 0) continue;
      out.push({ utterance_id: null, quote: stepQuote(seg.steps[step_index]), ...stepRef(seg, step_index) });
    }
    return out;
  }
  return [];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** True when `quote` appears word for word (whitespace and case aside) in `text`. */
export const quoteIn = (quote: string, text: string) => norm(quote).length > 0 && norm(text).includes(norm(quote));

/**
 * Check and complete a citation the model wrote by hand (structured stages): a speech citation must quote words
 * that appear in its utterance (or, when the id is wrong or missing, in exactly one utterance, which then becomes
 * its id); a step citation must name a recorded dom step. Returns null when it cannot be verified.
 */
export function verifyCitation(
  c: { utterance_id?: string | null; quote: string; step_index?: number | null },
  seg: Segmented,
): Citation | null {
  const quote = c.quote.trim();
  const stepOk = (i: number | null | undefined) => i != null && seg.steps[i]?.kind === "dom";
  // An explicit step-only citation (utterance_id null) stays a step citation.
  const stepOnly = c.utterance_id === null && stepOk(c.step_index);
  if (quote && !stepOnly) {
    let u = c.utterance_id ? seg.utterances.find((x) => x.id === c.utterance_id) : undefined;
    if (!u || !quoteIn(quote, u.text)) {
      const hits = seg.utterances.filter((x) => quoteIn(quote, x.text));
      u = hits.length >= 1 ? hits[0] : undefined;
    }
    if (u) {
      const step = stepOk(c.step_index) ? c.step_index! : (u.step_refs[0] ?? null);
      // Keep the exact words as spoken (the model may change case or spacing).
      const at = norm(u.text).indexOf(norm(quote));
      const exact = exactSlice(u.text, at, norm(quote).length) ?? quote;
      return { utterance_id: u.id, quote: exact, ...stepRef(seg, step) };
    }
  }
  if (stepOk(c.step_index)) {
    const s = seg.steps[c.step_index!];
    return { utterance_id: null, quote: quote && quoteIn(quote, stepLine(s)) ? quote : stepQuote(s), ...stepRef(seg, s.index) };
  }
  return null;
}

/** Slice of `text` covering normalized offsets [at, at+len) of norm(text). */
function exactSlice(text: string, at: number, len: number): string | null {
  if (at < 0) return null;
  // Walk the original string while counting normalized characters.
  const lead = text.length - text.trimStart().length;
  let n = 0;
  let i = lead;
  let start = -1;
  let prevSpace = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    const space = /\s/.test(ch);
    if (space && prevSpace) continue;
    if (n === at && start < 0) start = i;
    n++;
    prevSpace = space;
    if (start >= 0 && n === at + len) return text.slice(start, i + 1);
  }
  return null;
}
