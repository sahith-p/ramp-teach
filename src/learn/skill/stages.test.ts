import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RecordingSchema } from "@/contracts";
import { fakeClient, message } from "./__fixtures__/fake-client";
import { buildStepsDoc, buildTranscriptDoc, TRANSCRIPT_DOC_INDEX } from "./citations";
import { claimsFromContent, runClaims } from "./claims";
import { applyCritique, runCritique } from "./critique";
import { deterministicClaims, deterministicDraft, generalizeSelector } from "./deterministic";
import { segment } from "./segment";
import { normalizeDraft, reconcileSource, runSynthesize, type SynthesisApi } from "./synthesize";

const portal = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../extension/recordings/portal-HSG-1010.json"), "utf8")));
const sample = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../data/recording.sample.json"), "utf8")));
const seg = segment(portal);
const tdoc = buildTranscriptDoc(seg);
const sdoc = buildStepsDoc(seg);

const cite = (doc: 0 | 1, phrase: string) => {
  const text = doc === TRANSCRIPT_DOC_INDEX ? tdoc.text : sdoc.text;
  const s = text.indexOf(phrase);
  if (s < 0) throw new Error(`missing ${phrase}`);
  return { type: "char_location", cited_text: phrase, document_index: doc, document_title: null, start_char_index: s, end_char_index: s + phrase.length, file_id: null };
};

/** What a citations response looks like: text split into blocks, cited spans carrying citations. */
const claimsContent = [
  { type: "text", text: "- Every labor rate must equal the contract rate card. ", citations: null },
  { type: "text", text: "every labor rate must equal the contract rate card", citations: [cite(0, "every labor rate must equal the contract rate card")] },
  { type: "text", text: "\n- Billed hours must not exceed approved hours.", citations: [cite(0, "Billed hours must not exceed approved hours.")] },
  { type: "text", text: "\n- The reviewer reads the approved hours field on each timecard.", citations: [cite(1, '#13 click on /portal/employees/<employee_id>?week=<YYYY-MM-DD> at [data-field="approved_hours"] text "40"')] },
  { type: "text", text: "\n- A claim with no support.\n", citations: null },
];

describe("claims stage", () => {
  it("turns cited text blocks into claims with mapped citations", () => {
    const { claims, raw } = claimsFromContent(claimsContent, seg, tdoc, sdoc);
    expect(raw).toHaveLength(3);
    expect(claims.map((c) => c.text)).toEqual([
      "Every labor rate must equal the contract rate card. every labor rate must equal the contract rate card",
      "Billed hours must not exceed approved hours.",
      "The reviewer reads the approved hours field on each timecard.",
      "A claim with no support.",
    ]);
    expect(claims[0].citations).toEqual([expect.objectContaining({ utterance_id: "u2", quote: "every labor rate must equal the contract rate card" })]);
    expect(claims[1].citations[0].utterance_id).toBe("u4"); // first occurrence (Maya's utterance)
    expect(claims[2].citations).toEqual([expect.objectContaining({ utterance_id: null, step_index: 13 })]);
    expect(claims[3].citations).toEqual([]);
  });

  it("sends transcript + steps as documents with citations enabled and no structured output", async () => {
    const client = fakeClient({ create: () => message({ content: claimsContent }) });
    const r = await runClaims(client, seg, { noCache: true });
    expect(r.claims).toHaveLength(4);
    expect(r.meta.request_id).toMatch(/^req_fake_/);
    const req = client.calls[0].params as Record<string, any>;
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.fallbacks).toBe("default");
    expect(req.output_config.format).toBeUndefined(); // citations + structured outputs is a 400
    const docs = req.messages[0].content.filter((b: any) => b.type === "document");
    expect(docs).toHaveLength(2);
    expect(docs.every((d: any) => d.citations.enabled === true && d.source.type === "text")).toBe(true);
    expect(docs[0].source.data).toBe(tdoc.text);
  });

  it("throws on a refusal (the pipeline then falls back and labels it)", async () => {
    const client = fakeClient({ create: () => message({ stop_reason: "refusal", stop_details: { category: "cyber" } }) });
    await expect(runClaims(client, seg, { noCache: true })).rejects.toThrow(/declined/);
  });
});

const synthApi: SynthesisApi = {
  title: "Halcyon invoice review",
  vendor: "Not stated in recording",
  rules: [
    { text: "Every labor rate must equal the contract rate card.", kind: "check", source: "said", citations: [{ utterance_id: "u2", quote: "every labor rate must equal the contract rate card", step_index: null }] },
    { text: "Read approved hours on each timecard page.", kind: "procedure", source: "said", citations: [{ utterance_id: null, quote: "40", step_index: 13 }] },
    { text: "Overtime is billable at 2x.", kind: "check", source: "said", citations: [{ utterance_id: "u9", quote: "overtime is billable at 2x", step_index: null }] },
    { text: "Billed hours must not exceed approved hours.", kind: "check", source: "shown", citations: [{ utterance_id: "u4", quote: "Billed hours must not exceed approved hours", step_index: 13 }] },
  ],
  portal_map: [
    { page: "/portal/employees/<employee_id>?week=<YYYY-MM-DD>", fields: [{ name: "approved_hours", selector: '[data-field="approved_hours"]' }] },
    { page: "/portal/payroll", fields: [{ name: "x", selector: "#x" }] },
    { page: "data/vendor.json#contract", fields: [{ name: "rate_card", selector: "contract.rate_card" }] },
  ],
  open_questions: ["Is overtime above 40 hours billable at 1.5x?", "Is overtime above 40 hours billable at 1.5x?"],
};

describe("synthesize stage", () => {
  it("verifies citations, reconciles source, and drops pages never visited", () => {
    const { draft, rejected_citations } = normalizeDraft(synthApi, seg);
    expect(draft.rules.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(rejected_citations).toBe(1);
    expect(draft.rules[1].source).toBe("shown"); // only a step citation
    expect(draft.rules[2].citations).toEqual([]); // invented quote rejected; critique will drop the rule
    expect(draft.rules[3].source).toBe("both"); // said in u4 but labeled shown
    expect(draft.rules[3].citations[0]).toMatchObject({ utterance_id: "u4", step_index: 13, selector: '[data-field="approved_hours"]' });
    expect(draft.portal_map.map((p) => p.page)).toEqual(["/portal/employees/<employee_id>?week=<YYYY-MM-DD>", "data/vendor.json#contract"]);
    expect(draft.open_questions).toHaveLength(1);
  });

  it("reconcileSource follows the citations", () => {
    expect(reconcileSource("said", [{ utterance_id: null, quote: "40", step_index: 13, selector: null, url: null }])).toBe("shown");
    expect(reconcileSource("shown", [])).toBe("shown");
  });

  it("calls messages.parse with a structured output format and re-validates", async () => {
    const client = fakeClient({ parse: () => message({ parsed_output: synthApi }) });
    const r = await runSynthesize(client, seg, [], "HINTS", { noCache: true });
    expect(r.draft.rules).toHaveLength(4);
    const req = client.calls[0].params as Record<string, any>;
    expect(client.calls[0].method).toBe("beta.messages.parse");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.output_config.effort).toBe("medium");
    expect(req.messages[0].content).toContain("HINTS");
  });

  it("rejects an unparsed structured output", async () => {
    const client = fakeClient({ parse: () => message({ parsed_output: null }) });
    await expect(runSynthesize(client, seg, [], "", { noCache: true })).rejects.toThrow(/parse/);
  });
});

describe("critique stage", () => {
  const { draft } = normalizeDraft(synthApi, seg);

  it("drops uncited and flagged rules, renumbers, and adds gaps as open questions", () => {
    const out = applyCritique(draft, {
      verdicts: [
        { rule_id: "r1", verdict: "supported", reason: "u2" },
        { rule_id: "r2", verdict: "invented", reason: "no such field" },
      ],
      gaps: ["What happens when a timecard is missing?", "Is overtime above 40 hours billable at 1.5x?"],
    });
    expect(out.draft.rules.map((r) => [r.id, r.text])).toEqual([
      ["r1", "Every labor rate must equal the contract rate card."],
      ["r2", "Billed hours must not exceed approved hours."],
    ]);
    expect(out.dropped.map((d) => d.reason)).toEqual(["invented: no such field", "no verified citation"]);
    expect(out.added_questions).toEqual(["What happens when a timecard is missing?"]);
  });

  it("without a model critique only uncited rules go", () => {
    expect(applyCritique(draft, null).draft.rules).toHaveLength(3);
  });

  it("calls messages.parse and returns the verdicts", async () => {
    const client = fakeClient({ parse: () => message({ parsed_output: { verdicts: [{ rule_id: "r1", verdict: "supported", reason: "ok" }], gaps: [] } }) });
    const r = await runCritique(client, seg, draft, { noCache: true });
    expect(r.api.verdicts).toHaveLength(1);
    expect((client.calls[0].params as any).messages[0].content).toContain("u2: Rules I apply");
  });
});

describe("deterministic distiller (offline)", () => {
  it("quotes narration exactly for every citation", () => {
    for (const rec of [portal, sample]) {
      const s = segment(rec);
      const d = deterministicDraft(s, { title: "T", vendorNotStated: "Not stated in recording", vendorPattern: /\bverifying\s+(?!invoice\b)(.+?)\s+invoice\b/i });
      expect(d.rules.length).toBeGreaterThan(3);
      for (const r of d.rules) {
        expect(r.citations.length).toBeGreaterThan(0);
        for (const c of r.citations) {
          if (c.utterance_id) expect(s.utterances.find((u) => u.id === c.utterance_id)!.text).toContain(c.quote);
        }
      }
      for (const c of deterministicClaims(s)) expect(s.utterances.find((u) => u.id === c.citations[0].utterance_id)!.text).toContain(c.citations[0].quote);
    }
  });

  it("finds rules, the decision, questions, the vendor when said, and the portal map", () => {
    const s = segment(sample);
    const d = deterministicDraft(s, { title: "T", vendorNotStated: "Not stated in recording", vendorPattern: /\bverifying\s+(?!invoice\b)(.+?)\s+invoice\b/i });
    expect(d.vendor).toBe("Halcyon Staffing Group");
    expect(d.rules.some((r) => r.kind === "decision" && /dispute/.test(r.text))).toBe(true);
    expect(d.rules.some((r) => /Senior Recruiter 95/.test(r.text))).toBe(true); // reference values kept with their rule
    expect(d.rules.some((r) => /HSG-1010/.test(r.text))).toBe(false); // facts about the reviewed invoice are not rules
    expect(d.rules.some((r) => r.text.startsWith("Until resolved:"))).toBe(true);
    expect(d.open_questions.some((q) => /pre-approval/.test(q))).toBe(true);
    expect(d.portal_map.find((p) => p.page.startsWith("/portal/employees"))!.fields).toContainEqual({ name: "approved_hours", selector: '[data-field="approved_hours"]' });
    expect(segment(portal) && deterministicDraft(segment(portal), { title: "T", vendorNotStated: "Not stated in recording" }).vendor).toBe("Not stated in recording");
  });

  it("adds a shown rule for a field inspected but never talked about", () => {
    const silent = { ...portal, steps: portal.steps.map((s) => (s.kind === "narration" ? { ...s, detail: { ...s.detail, text: String(s.detail.text).replace(/approved/gi, "signed-off") } } : s)) };
    const d = deterministicDraft(segment(silent), { title: "T", vendorNotStated: "-" });
    const shown = d.rules.find((r) => r.source === "shown")!;
    expect(shown.text).toContain("approved hours");
    expect(shown.citations[0]).toMatchObject({ utterance_id: null, step_index: 13, selector: '[data-field="approved_hours"]' });
  });

  it("generalizes link selectors", () => {
    expect(generalizeSelector('a[href="/portal/employees/E-101?week=2026-10-11"]')).toBe('a[href^="/portal/employees/"]');
    expect(generalizeSelector('[data-field="x"]')).toBe('[data-field="x"]');
  });
});

