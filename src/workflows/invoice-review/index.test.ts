/**
 * Invoice-review workflow tests. NOTE: only THIS TEST builds evidence from data/timecards.json (as a
 * stand-in for what the portal shows); the workflow/agent code itself never reads it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReceiptSchema, type AgentEvidenceFact, type EvidenceBundle, type Receipt, type RunContext, type WorkflowSpec } from "@/contracts";
import { loadTimecards } from "@/lib/data";
import { ROOT } from "@/lib/paths";
import { invoiceReviewWorkflow as wf } from "./index";
import { getWorkflow } from "@/workflows/registry";
import { runWorkflow, synthesisPrompt } from "@/agent/engine";
import { enforceAmounts, numbersIn } from "@/agent/enforce";
import { runCalc } from "@/calc";
import { startPortalStub } from "@/agent/test-fixtures/portal-stub";

const spec: WorkflowSpec = { vendor: "Halcyon Staffing Group", proof_sources: [], rules: [], open_questions: ["Is overtime above 40 h billable at 1.5×?"] };
const ctx: RunContext = { baseUrl: "http://localhost:3000", runId: "test", runDir: "/tmp/none", trace: () => {} };
const subject = () => wf.loadSubject("HSG-1011");

/** A scripted-style bundle built from the portal's backend data (test-only). */
function portalBundle(): EvidenceBundle {
  const tcs = loadTimecards().filter((t) => t.week_ending === "2026-10-18");
  return {
    invoice_id: "HSG-1011",
    mode: "scripted",
    items: tcs.map((t) => ({
      source: `fixture:/portal/employees/${t.employee_id}?week=${t.week_ending}`,
      kind: "timecard_hours",
      employee_id: t.employee_id,
      week_ending: t.week_ending,
      value: t.approved_hours,
      screenshot: null,
      captured_at: "2026-11-09T00:00:00.000Z",
      mode: "scripted",
    })),
    timecards: tcs,
  };
}

describe("invoice-review workflow definition", () => {
  it("is registered and targets bill_<id>", () => {
    expect(getWorkflow("invoice-review")).toBe(wf);
    expect(wf.approvalTargetId("HSG-1011")).toBe("bill_HSG-1011");
  });

  it("plans one evidence task per unique billed employee-week (the duplicate Priya line is looked up once)", () => {
    const tasks = wf.evidencePlan(subject(), spec);
    expect(tasks.map((t) => t.subject_ref.employee_id)).toEqual(["E-101", "E-102", "E-103", "E-104"]);
    for (const t of tasks) {
      expect(t.start_path).toBe("/portal/login");
      expect(t.expected_keys).toEqual(["approved_hours", "status"]);
      expect(t.subject_ref.week_ending).toBe("2026-10-18");
    }
  });

  it("calc without evidence: rate + duplicate fail, hours unverified; partial coverage stays unverified", () => {
    const s = subject();
    const c0 = wf.deterministicChecks(s, null);
    expect(Object.fromEntries(c0.checks.map((c) => [c.check, c.result]))).toMatchObject({
      rate_matches_contract: "fail",
      no_duplicate_lines: "fail",
      hours_match_timecards: "unverified",
    });
    const partial = portalBundle();
    partial.items = partial.items.filter((i) => i.employee_id !== "E-104");
    expect(wf.deterministicChecks(s, partial).checks.find((c) => c.check === "hours_match_timecards")?.result).toBe("unverified");
  });

  it("mockReceipt for HSG-1011 with portal evidence: rate/duplicate/hours fail → dispute with a $3,448 credit memo", () => {
    const s = subject();
    const ev = portalBundle();
    const calc = wf.deterministicChecks(s, ev);
    const r: Receipt = ReceiptSchema.parse(wf.mockReceipt(s, calc, ev, spec));
    const results = Object.fromEntries(r.checks.map((c) => [c.name, c.result]));
    expect(results).toEqual({
      line_amounts_correct: "pass",
      total_matches_line_items: "pass",
      rate_matches_contract: "fail",
      no_duplicate_lines: "fail",
      no_unknown_charges: "pass",
      hours_match_timecards: "fail",
    });
    expect(r.recommendation).toBe("dispute");
    expect(r.mode).toBe("mock");
    expect(r.human_decision).toBeNull();
    const byName = Object.fromEntries(r.checks.map((c) => [c.name, c]));
    expect(byName.rate_matches_contract.evidence).toBe("data/vendor.json#contract.rate_card.Senior Recruiter");
    expect(byName.hours_match_timecards.evidence).toBe("fixture:/portal/employees/E-104?week=2026-10-18");
    expect(byName.line_amounts_correct.evidence).toBe("calc:line_amounts_correct");
    expect(r.reasons.join(" ")).toContain("$3,448.00");
    expect(r.reasons.join(" ")).toContain("overtime");
    for (const amt of ["$400.00", "$2,520.00", "$528.00"]) expect(r.reasons.join(" ")).toContain(`Impact: ${amt}`);
    expect(calc.credit_total).toBe(3448);
  });

  it("mock receipts copy calc's amounts: the amount post-pass changes nothing on any invoice", () => {
    const ids = ["HSG-1001", "HSG-1002", "HSG-1003", "HSG-1004", "HSG-1005", "HSG-1006", "HSG-1007", "HSG-1009", "HSG-1011", "HSG-1012", "OFS-2201"];
    const tcs = loadTimecards();
    for (const id of ids) {
      const s = wf.loadSubject(id);
      const ev: EvidenceBundle = { ...portalBundle(), invoice_id: id, items: [], timecards: tcs };
      const calc = runCalc({ invoice: s.invoice, vendor: s.vendor, timecards: tcs, invoicePath: s.invoicePath });
      const r = wf.mockReceipt(s, calc, ev, spec);
      const out = enforceAmounts(r.reasons, calc, numbersIn(s));
      expect(out.issues, id).toEqual([]);
      expect(out.reasons, id).toEqual(r.reasons);
    }
  });

  it("synthesis instructions + prompt hand Claude the code-computed amounts to copy", () => {
    const s = subject();
    const calc = wf.deterministicChecks(s, portalBundle());
    const prompt = synthesisPrompt({ summary: wf.summarize(s), subject: s, calc, evidence: portalBundle(), spec, instructions: wf.synthesisInstructions, pointers: [] });
    expect(prompt).toContain("Credit total computed by code (credit_total, copy exactly): 3448.00");
    for (const a of ['"amount": 400', '"amount": 2520', '"amount": 528']) expect(prompt).toContain(a);
    expect(wf.synthesisInstructions).toMatch(/COPY them; never compute/);
  });

  it("collectAgentEvidence keeps facts read on the right timecard page and rejects others", () => {
    const rejected: unknown[] = [];
    const c: RunContext = { ...ctx, trace: (step, _m, _s, d) => step === "agent.fact.rejected" && rejected.push(d) };
    const f = (emp: string, key: string, value: string | number, source = `fixture:/portal/employees/${emp}?week=2026-10-18`): AgentEvidenceFact => ({
      source,
      key,
      value,
      subject_ref: { employee_id: emp, week_ending: "2026-10-18" },
      note: "",
    });
    const bundle = wf.collectAgentEvidence(
      subject(),
      [
        f("E-104", "approved_hours", 38),
        f("E-104", "status", "Approved"),
        f("E-104", "approved_by", "Dana Whitfield"),
        f("E-101", "approved_hours", "40"), // no status recorded → item kept, no timecard (engine falls back)
        f("E-102", "approved_hours", 40, "fixture:/portal/invoices/HSG-1011"), // wrong page → rejected
      ],
      c,
    );
    expect(bundle.mode).toBe("real");
    expect(bundle.items.map((i) => [i.employee_id, i.value, i.mode])).toEqual([["E-101", 40, "real"], ["E-104", 38, "real"]]);
    expect(bundle.timecards).toEqual([
      { employee_id: "E-104", week_ending: "2026-10-18", approved_hours: 38, approved_by: "Dana Whitfield", status: "approved" },
    ]);
    expect(rejected).toHaveLength(1);
  });
});

describe("offline engine run for HSG-1011 against the TEST STUB portal (scripted Playwright + mock receipt)", () => {
  let stub: Awaited<ReturnType<typeof startPortalStub>>;
  let tmp: string;
  beforeAll(async () => {
    stub = await startPortalStub(0);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "invoice-e2e-"));
  });
  afterAll(async () => {
    await stub?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes calc/evidence, recommends dispute with rate/duplicate/hours failing", async () => {
    const persisted: Receipt[] = [];
    const s = await runWorkflow(wf, "HSG-1011", {
      baseUrl: stub.url,
      provider: null,
      repoRoot: ROOT,
      runsRoot: path.join(tmp, "runs"),
      traceFile: path.join(tmp, "trace.jsonl"),
      persistReceipt: (r) => {
        persisted.push(ReceiptSchema.parse(r));
        return path.join(tmp, "HSG-1011.json");
      },
    });
    expect(s.modes).toMatchObject({ calc: "deterministic", evidence: "scripted", synthesis: "mock" });
    expect(s.receipt.recommendation).toBe("dispute");
    expect(s.failingChecks).toEqual(["rate_matches_contract", "no_duplicate_lines", "hours_match_timecards"]);
    expect(s.notes.filter((n) => /no valid evidence/.test(n))).toEqual([]);
    const ev = JSON.parse(fs.readFileSync(s.evidencePath!, "utf8")) as EvidenceBundle;
    expect(ev.mode).toBe("scripted");
    expect(ev.items.every((i) => i.mode === "scripted")).toBe(true);
    expect(ev.timecards.find((t) => t.employee_id === "E-104")?.approved_hours).toBe(38);
    expect(ev.items.filter((i) => i.screenshot).length).toBeGreaterThanOrEqual(5);
    expect(persisted).toHaveLength(1);
  }, 60_000);
});
