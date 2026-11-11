import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LearnMetaSchema, RecordingSchema, WorkflowSpecSchema } from "@/contracts";
import { VENDOR_NOT_STATED, deterministicDistill, distillHints, invoiceReviewLearn, invoiceReviewRecordings } from "./learn";

const recording = RecordingSchema.parse(
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../data/recording.sample.json"), "utf8")),
);

describe("invoice-review deterministicDistill (no LLM)", () => {
  const spec = deterministicDistill(recording);
  const rules = spec.rules.join("\n");

  it("produces a valid WorkflowSpec for the sample recording", () => {
    expect(() => WorkflowSpecSchema.parse(spec)).not.toThrow();
    expect(spec.vendor).toBe("Halcyon Staffing Group");
  });

  it("has rules covering rate card, duplicates, allowed charges, hours vs timecards, arithmetic/total", () => {
    expect(rules).toMatch(/rate card/i);
    expect(rules).toMatch(/Senior Recruiter 95/);
    expect(rules).toMatch(/duplicate|billed twice/i);
    expect(rules).toMatch(/allowed list/i);
    expect(rules).toMatch(/Background check fee up to 120/i);
    expect(rules).toMatch(/approved hours.*timecard/i);
    expect(rules).toMatch(/hours times rate must equal each line amount/i);
    expect(rules).toMatch(/invoice total/i);
    expect(rules).toMatch(/dispute/i);
  });

  it("does not turn per-invoice observations into rules", () => {
    expect(rules).not.toMatch(/12,449\.00/);
    expect(rules).not.toMatch(/Maya Chen: 40/);
    expect(rules).not.toMatch(/is an approve/);
  });

  it("captures the overtime open question (and its interim policy as a rule)", () => {
    expect(spec.open_questions.some((q) => /overtime/i.test(q) && /1\.5/.test(q))).toBe(true);
    expect(spec.open_questions.some((q) => /pre-approval/i.test(q))).toBe(true);
    expect(spec.rules.some((r) => /^Until resolved:.*straight time/i.test(r))).toBe(true);
  });

  it("extracts proof sources from DOM steps, skipping the login page", () => {
    const locs = spec.proof_sources.map((p) => p.location);
    expect(locs).toContain("/portal/invoices/<invoice_id>");
    expect(locs).toContain("/portal/employees/<employee_id>?week=<YYYY-MM-DD>");
    expect(locs).toContain("data/vendor.json#contract");
    expect(locs).not.toContain("/portal/login");
    const timecard = spec.proof_sources.find((p) => p.location.startsWith("/portal/employees/"))!;
    expect(timecard.app).toBe("Fixture vendor portal");
    expect(timecard.fields[0]).toBe("approved_hours"); // observed in the recording, listed first
  });

  it("exports the WorkflowDefinition.learn shape", () => {
    expect(invoiceReviewLearn.recordingPath).toBe("extension/recordings/portal-HSG-1010.json");
    expect(invoiceReviewLearn.specPath).toBe("rules/workflow_spec.json");
    expect(invoiceReviewLearn.deterministicDistill).toBe(deterministicDistill);
    expect(distillHints).toMatch(/timecard/);
    expect(distillHints).not.toMatch(/answer_key|HSG-1011/);
  });
});

describe("RECORD → LEARN wiring: the extension capture is the primary LEARN input", () => {
  const capturePath = "extension/recordings/portal-HSG-1010.json";
  const capture = RecordingSchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../..", capturePath), "utf8")));

  it("lists the capture first (primary, scripted operator) and the seeded sample as a labeled fallback fixture", () => {
    expect(invoiceReviewRecordings.map((r) => r.path)).toEqual([capturePath, "data/recording.sample.json"]);
    expect(invoiceReviewRecordings[0].provenance).toMatchObject({ capture: "mv3_extension", operator: "scripted_playwright", role: "primary" });
    expect(invoiceReviewRecordings[0].provenance.note).toMatch(/not a human/i);
    expect(invoiceReviewRecordings[1].provenance).toMatchObject({ capture: "hand_authored_fixture", role: "fallback_fixture" });
  });

  it("the capture is a schema-valid extension recording of the real fixture portal (localhost only, password redacted)", () => {
    expect(capture.transcript).toEqual(capture.steps.filter((s) => s.kind === "narration").map((s) => s.detail.text));
    const urls = capture.steps.map((s) => s.detail.url).filter(Boolean) as string[];
    expect(urls.every((u) => u.startsWith("http://localhost:"))).toBe(true);
    const pw = capture.steps.find((s) => s.detail.selector?.includes('name="password"'));
    expect(pw?.detail.value).toBe("[redacted]");
  });

  it("deterministic distill of the capture yields all six check rules, the timecard proof source, and the overtime question", () => {
    const spec = deterministicDistill(capture);
    expect(() => WorkflowSpecSchema.parse(spec)).not.toThrow();
    const rules = spec.rules.join("\n").toLowerCase();
    for (const k of ["rate card", "twice", "allowed list", "approved hours", "dispute"]) expect(rules).toContain(k);
    expect(spec.proof_sources.map((p) => p.location)).toContain("/portal/employees/<employee_id>?week=<YYYY-MM-DD>");
    expect(spec.open_questions.join(" ")).toMatch(/overtime/i);
    // The capture never names the vendor; the distiller must not invent one.
    expect(spec.vendor).toBe(VENDOR_NOT_STATED);
  });

  it("LearnMeta accepts the provenance block", () => {
    expect(() =>
      LearnMetaSchema.parse({
        mode: "real",
        model: "claude-opus-5-5",
        recording_path: capturePath,
        generated_at: "2026-11-09T00:00:00Z",
        provenance: { session_id: capture.session_id, ...invoiceReviewRecordings[0].provenance },
      }),
    ).not.toThrow();
  });
});
