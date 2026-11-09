import { describe, expect, it } from "vitest";
import type { CalcReport, Receipt } from "@/contracts";
import { enforceReceipt, evidenceProblem } from "./enforce";

const calc: CalcReport = {
  invoice_id: "T-1",
  computed_at: "2026-11-09T00:00:00.000Z",
  checks: [
    { check: "line_amounts_correct", result: "pass", findings: [], summary: "ok" },
    {
      check: "rate_matches_contract",
      result: "fail",
      findings: [{ line_index: 0, expected: "95.00/h", actual: "105.00/h", message: "rate", evidence: "data/vendor.json#contract.rate_card.Senior Recruiter" }],
      summary: "1 bad rate",
    },
    { check: "hours_match_timecards", result: "pass", findings: [], summary: "ok" },
  ],
};

const base = (over: Partial<Receipt> = {}): Receipt => ({
  invoice_id: "T-1",
  vendor: "V",
  checks: [
    { name: "line_amounts_correct", expected: "e", actual: "a", result: "pass", evidence: "calc:line_amounts_correct" },
    { name: "rate_matches_contract", expected: "95", actual: "105", result: "fail", evidence: "data/vendor.json#contract.rate_card.Senior Recruiter" },
    { name: "hours_match_timecards", expected: "38 h", actual: "38 h", result: "pass", evidence: "fixture:/portal/employees/E-104?week=2026-10-18" },
  ],
  recommendation: "dispute",
  reasons: ["rate is wrong"],
  mode: "real",
  human_decision: null,
  decided_by: null,
  decided_at: null,
  ...over,
});

const ctx = (visited: string[] = ["fixture:/portal/employees/E-104?week=2026-10-18"]) => ({
  calc,
  visitedFixtures: visited,
  repoRoot: "/nonexistent",
  fileExists: (p: string) => p === "data/vendor.json" || p === "rules/workflow_spec.json",
});

describe("enforceReceipt — evidence pointers", () => {
  it("keeps a receipt whose pointers all resolve", () => {
    const r = enforceReceipt(base(), ctx());
    expect(r.invalidEvidence).toEqual([]);
    expect(r.receipt.recommendation).toBe("dispute");
    expect(r.notes).toEqual([]);
  });

  it("forces review when a check's evidence is not a valid pointer", () => {
    const rec = base();
    rec.checks[0].evidence = "https://example.com/proof";
    const r = enforceReceipt(rec, ctx());
    expect(r.invalidEvidence).toEqual(["line_amounts_correct"]);
    expect(r.receipt.recommendation).toBe("review");
    expect(r.receipt.reasons.join(" ")).toMatch(/no valid evidence/);
  });

  it("forces review when a pointer is well-formed but does not resolve", () => {
    expect(evidenceProblem("data/missing.json#x", ctx())).toMatch(/does not exist/);
    expect(evidenceProblem("calc:no_unknown_charges", ctx())).toMatch(/no check/);
    expect(evidenceProblem("fixture:/portal/employees/E-999?week=2026-10-18", ctx())).toMatch(/not visited/);
    const rec = base();
    rec.checks[2].evidence = "fixture:/portal/employees/E-104?week=2026-10-18";
    const r = enforceReceipt(rec, ctx([])); // page never visited
    expect(r.receipt.recommendation).toBe("review");
    expect(r.invalidEvidence).toEqual(["hours_match_timecards"]);
  });

  it("forces review for an empty evidence string even when the model said approve", () => {
    const rec = base({ recommendation: "approve" });
    rec.checks[1].evidence = "";
    expect(enforceReceipt(rec, ctx()).receipt.recommendation).toBe("review");
  });
});

describe("enforceReceipt — calc is authoritative", () => {
  it("overrides a synthesized result that contradicts calc and floors approve at dispute", () => {
    const rec = base({ recommendation: "approve" });
    rec.checks[1].result = "pass"; // model claims the bad rate passes
    const r = enforceReceipt(rec, ctx());
    expect(r.overridden).toEqual(["rate_matches_contract"]);
    expect(r.receipt.checks.find((c) => c.name === "rate_matches_contract")?.result).toBe("fail");
    expect(r.receipt.recommendation).toBe("dispute");
    expect(r.receipt.reasons.join(" ")).toMatch(/calc is authoritative/);
  });

  it("adds checks the receipt omitted, in calc order", () => {
    const rec = base();
    rec.checks = rec.checks.filter((c) => c.name !== "line_amounts_correct");
    const r = enforceReceipt(rec, ctx());
    expect(r.receipt.checks.map((c) => c.name)).toEqual(["line_amounts_correct", "rate_matches_contract", "hours_match_timecards"]);
    expect(r.receipt.checks[0]).toMatchObject({ result: "pass", evidence: "calc:line_amounts_correct" });
  });

  it("always nulls the human fields", () => {
    const r = enforceReceipt(base({ human_decision: "approve", decided_by: "model", decided_at: "now" }), ctx());
    expect(r.receipt).toMatchObject({ human_decision: null, decided_by: null, decided_at: null });
  });
});
