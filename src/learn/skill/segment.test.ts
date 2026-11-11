import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RecordingSchema, type Recording } from "@/contracts";
import { evidencePages, segment } from "./segment";

const load = (rel: string) => RecordingSchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8")));
export const portal = load("extension/recordings/portal-HSG-1010.json");

describe("segment", () => {
  const seg = segment(portal);

  it("makes one utterance per narration step, with its exact words", () => {
    expect(seg.utterance_source).toBe("narration");
    const narr = portal.steps.filter((s) => s.kind === "narration");
    expect(seg.utterances).toHaveLength(narr.length);
    seg.utterances.forEach((u, i) => expect(u.text).toBe(String(narr[i].detail.text).trim()));
    expect(seg.utterances[0].id).toBe("u1");
  });

  it("links an utterance to the dom steps around it on the same page", () => {
    // "Maya Chen's approved timecard ... shows 40 hours" is said on the E-101 timecard page after clicking approved_hours (step 13).
    const maya = seg.utterances.find((u) => u.text.startsWith("Maya Chen"))!;
    expect(maya.step_refs).toContain(13);
    for (const i of maya.step_refs) expect(portal.steps[i].kind).toBe("dom");
    expect(seg.narration_step[maya.id]).toBe(14);
  });

  it("groups steps into episodes by page and marks the sign-in page", () => {
    expect(seg.episodes[0].page).toBe("/portal/login");
    expect(seg.episodes[0].auth).toBe(true);
    const pages = seg.episodes.map((e) => e.page);
    expect(pages).toContain("/portal/employees/<employee_id>?week=<YYYY-MM-DD>");
    // Every step is in exactly one episode.
    const all = seg.episodes.flatMap((e) => e.step_indices).sort((a, b) => a - b);
    expect(all).toEqual(portal.steps.map((_, i) => i));
    expect(evidencePages(seg)).toEqual(["/portal/invoices", "/portal/invoices/<invoice_id>", "/portal/employees/<employee_id>?week=<YYYY-MM-DD>"]);
  });

  it("uses speech utterances when the recording carries them", () => {
    const withSpeech: Recording = {
      ...portal,
      speech: {
        provider: "simulated",
        model: null,
        mode: "scripted",
        language: "en",
        keyterms: [],
        utterances: [
          { id: "u1", text: "Approved hours must cover billed hours.", start: 1, end: 3, words: [], step_refs: [13], low_confidence: [] },
        ],
      },
    };
    const s = segment(withSpeech);
    expect(s.utterance_source).toBe("speech");
    expect(s.utterances).toHaveLength(1);
    expect(s.episodes.find((e) => e.step_indices.includes(13))!.utterance_ids).toEqual(["u1"]);
  });

  it("falls back to transcript lines when there is no narration", () => {
    const bare: Recording = { ...portal, steps: portal.steps.filter((s) => s.kind === "dom"), transcript: ["Rates must match.", ""] };
    const s = segment(bare);
    expect(s.utterance_source).toBe("transcript");
    expect(s.utterances.map((u) => u.text)).toEqual(["Rates must match."]);
  });
});
