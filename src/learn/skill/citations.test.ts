import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RecordingSchema } from "@/contracts";
import { buildStepsDoc, buildTranscriptDoc, mapCitation, quoteIn, STEPS_DOC_INDEX, TRANSCRIPT_DOC_INDEX, verifyCitation } from "./citations";
import { segment } from "./segment";

const portal = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../extension/recordings/portal-HSG-1010.json"), "utf8")));
const seg = segment(portal);
const tdoc = buildTranscriptDoc(seg);
const sdoc = buildStepsDoc(seg);

const at = (doc: string, phrase: string) => {
  const s = doc.indexOf(phrase);
  if (s < 0) throw new Error(`not in doc: ${phrase}`);
  return { start_char_index: s, end_char_index: s + phrase.length };
};

describe("transcript and steps documents", () => {
  it("keeps exact utterance text at the recorded offsets", () => {
    for (const { utterance_id, span } of tdoc.spans) {
      expect(tdoc.text.slice(span.start, span.end)).toBe(seg.utterances.find((u) => u.id === utterance_id)!.text);
    }
    expect(tdoc.text.split("\n")).toHaveLength(seg.utterances.length);
  });

  it("lists only dom steps, each line naming its step index", () => {
    expect(sdoc.spans.every(({ step_index }) => portal.steps[step_index].kind === "dom")).toBe(true);
    const line13 = sdoc.text.slice(sdoc.spans.find((s) => s.step_index === 13)!.span.start, sdoc.spans.find((s) => s.step_index === 13)!.span.end);
    expect(line13).toContain("#13 click");
    expect(line13).toContain('[data-field="approved_hours"]');
  });
});

describe("mapCitation", () => {
  it("maps a transcript char range to the utterance id, exact quote and linked step", () => {
    const phrase = "Billed hours must not exceed approved hours.";
    const maya = seg.utterances.find((u) => u.text.startsWith("Maya Chen"))!;
    const span = tdoc.spans.find((s) => s.utterance_id === maya.id)!.span;
    const start = tdoc.text.indexOf(phrase, span.start);
    const out = mapCitation({ type: "char_location", document_index: TRANSCRIPT_DOC_INDEX, start_char_index: start, end_char_index: start + phrase.length, cited_text: phrase }, seg, tdoc, sdoc);
    expect(out).toEqual([{ utterance_id: maya.id, quote: phrase, step_index: maya.step_refs[0], selector: portal.steps[maya.step_refs[0]].detail.selector ?? null, url: portal.steps[maya.step_refs[0]].detail.url ?? null }]);
  });

  it("splits a citation that spans two utterances into one exact quote per utterance", () => {
    const u7 = seg.utterances[7].text;
    const u8 = seg.utterances[8].text;
    const range = { start_char_index: tdoc.text.indexOf(u7) + u7.length - 20, end_char_index: tdoc.text.indexOf(u8) + 14 };
    const out = mapCitation({ type: "char_location", document_index: TRANSCRIPT_DOC_INDEX, ...range }, seg, tdoc, sdoc);
    expect(out.map((c) => c.utterance_id)).toEqual(["u8", "u9"]);
    expect(u7.endsWith(out[0].quote)).toBe(true);
    expect(u8.startsWith(out[1].quote)).toBe(true);
  });

  it("maps a steps-document citation to a step citation (no utterance)", () => {
    const span = sdoc.spans.find((s) => s.step_index === 13)!.span;
    const out = mapCitation({ type: "char_location", document_index: STEPS_DOC_INDEX, start_char_index: span.start, end_char_index: span.end }, seg, tdoc, sdoc);
    expect(out).toEqual([{ utterance_id: null, quote: "40", step_index: 13, selector: '[data-field="approved_hours"]', url: portal.steps[13].detail.url }]);
  });

  it("ignores other citation types and unknown documents", () => {
    expect(mapCitation({ type: "page_location" }, seg, tdoc, sdoc)).toEqual([]);
    expect(mapCitation({ type: "char_location", document_index: 5, ...at(tdoc.text, "First I sign in.") }, seg, tdoc, sdoc)).toEqual([]);
  });
});

describe("verifyCitation", () => {
  it("accepts a quote from its utterance and restores the spoken casing", () => {
    const c = verifyCitation({ utterance_id: "u2", quote: "EVERY labor rate must equal the contract rate card", step_index: null }, seg)!;
    expect(c.utterance_id).toBe("u2");
    expect(c.quote).toBe("every labor rate must equal the contract rate card");
  });

  it("fixes a wrong utterance id when the quote is found elsewhere", () => {
    const c = verifyCitation({ utterance_id: "u1", quote: "otherwise approve", step_index: null }, seg)!;
    expect(c.utterance_id).toBe("u8");
  });

  it("rejects invented quotes and keeps step-only citations on dom steps", () => {
    expect(verifyCitation({ utterance_id: "u2", quote: "overtime is always billable", step_index: null }, seg)).toBeNull();
    expect(verifyCitation({ utterance_id: null, quote: "", step_index: 1 }, seg)).toBeNull(); // step 1 is narration
    const s = verifyCitation({ utterance_id: null, quote: "40", step_index: 13 }, seg)!;
    expect(s).toMatchObject({ utterance_id: null, quote: "40", step_index: 13, selector: '[data-field="approved_hours"]' });
  });

  it("quoteIn ignores case and spacing only", () => {
    expect(quoteIn("Line  amounts and", "line amounts and the total")).toBe(true);
    expect(quoteIn("line amount and", "line amounts and the total")).toBe(false);
  });
});
