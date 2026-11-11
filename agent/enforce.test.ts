import { describe, expect, it } from "vitest";
import type { CalcReport, Receipt } from "@/contracts";
import { enforceAmounts, enforceReceipt, evidenceProblem, numbersIn } from "./enforce";

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

/* ------------------------------ money in reasons ----------------------------- */

const finding = (line_index: number | null, amount: number, evidence = "data/invoices/new/HSG-1011.json#line_items[0]") => ({
  line_index,
  expected: "e",
  actual: "a",
  message: "m",
  evidence,
  amount,
});
/** HSG-1011's shape: rate on line 1 ($400), duplicate line 5 ($2,520), hours line 4 ($528), total $3,448. */
const moneyCalc: CalcReport = {
  invoice_id: "HSG-1011",
  computed_at: "2026-11-11T00:00:00.000Z",
  checks: [
    { check: "line_amounts_correct", result: "pass", findings: [], summary: "ok" },
    { check: "rate_matches_contract", result: "fail", findings: [finding(0, 400)], summary: "1 bad rate" },
    { check: "no_duplicate_lines", result: "fail", findings: [finding(4, 2520)], summary: "1 dup" },
    { check: "hours_match_timecards", result: "fail", findings: [finding(3, 528)], summary: "1 over" },
  ],
  credit_total: 3448,
};
const subjectNumbers = [40, 105, 4200, 44, 88, 3872, 36, 70, 2520, 85, 15677];

describe("enforceAmounts — dollar figures come from calc", () => {
  const good = [
    "Line 1 bills Maya Chen at $105.00/h against the contract's $95.00/h: overbilled $400.00.",
    "Line 5 duplicates line 3 (Priya Natarajan, same week): credit $2,520.00.",
    "Line 4 bills 44 h for Sam Okafor; the approved timecard shows 38 h: impact $528.00.",
    "Dispute and request a credit memo for $3,448.00.",
  ];
  const quoted = "Line 4 is billed at $3,872.00 on an invoice totaling $15,677.00.";

  it("leaves correct amounts, rates and quoted invoice figures untouched", () => {
    const r = enforceAmounts([...good, quoted], moneyCalc, subjectNumbers);
    expect(r.issues).toEqual([]);
    expect(r.notes).toEqual([]);
    expect(r.reasons).toEqual([...good, quoted]);
  });

  it("replaces a wrong per-line amount with that line's calc amount", () => {
    const reasons = [...good];
    reasons[2] = "Line 4 bills 44 h for Sam Okafor vs 38 approved: impact $600.00.";
    const r = enforceAmounts(reasons, moneyCalc, subjectNumbers);
    expect(r.reasons[2]).toBe("Line 4 bills 44 h for Sam Okafor vs 38 approved: impact $528.00.");
    expect(r.issues).toEqual(["$600.00"]);
    expect(r.notes[0]).toMatch(/reason 3 stated 600\.00.*replaced with \$528\.00 \(calc finding amount\)/);
  });

  it("a quoted invoice figure used as a credit claim is still replaced (claims must be calc amounts)", () => {
    const r = enforceAmounts(["Line 4: overbilled $3,872.00.", good[3]], moneyCalc, subjectNumbers);
    expect(r.reasons[0]).toBe("Line 4: overbilled $528.00.");
  });

  it("fixes a wrong total in the credit-memo sentence", () => {
    const r = enforceAmounts([...good.slice(0, 3), "Dispute and request a credit memo for $3,500."], moneyCalc, subjectNumbers);
    expect(r.reasons[3]).toBe("Dispute and request a credit memo for $3,448.00.");
    expect(r.notes.join(" ")).toMatch(/calc credit_total/);
  });

  it("a total that equals another calc amount is corrected to credit_total", () => {
    const r = enforceAmounts([...good.slice(0, 3), "Request a credit memo for $2,520.00."], moneyCalc, subjectNumbers);
    expect(r.reasons[3]).toBe("Request a credit memo for $3,448.00.");
    expect(r.issues).toEqual(["$2,520.00"]);
  });

  it("appends the total credit line when no reason states credit_total", () => {
    const r = enforceAmounts(good.slice(0, 3), moneyCalc, subjectNumbers);
    expect(r.reasons).toHaveLength(4);
    expect(r.reasons[3]).toBe("Total credit to request (computed by calc): $3,448.00.");
  });

  it("flags an unsupported figure it cannot attribute, idempotently", () => {
    const r = enforceAmounts([...good, "The vendor also owes a late fee of $75.00."], moneyCalc, subjectNumbers);
    expect(r.reasons[4]).toBe("The vendor also owes a late fee of $75.00 [not a calc amount].");
    expect(r.notes[0]).toMatch(/flagged for the approver/);
    const again = enforceAmounts(r.reasons, moneyCalc, subjectNumbers);
    expect(again.reasons).toEqual(r.reasons);
    expect(again.issues).toEqual([]);
  });

  it("clean invoice (credit_total 0): claimed credits are flagged, no total line is added", () => {
    const clean: CalcReport = { ...moneyCalc, checks: [moneyCalc.checks[0]], credit_total: 0 };
    expect(enforceAmounts(["All checks pass."], clean, subjectNumbers).reasons).toEqual(["All checks pass."]);
    const r = enforceAmounts(["Request a credit memo for $100.00."], clean, subjectNumbers);
    expect(r.reasons[0]).toBe("Request a credit memo for $100.00 [not a calc amount].");
  });

  it("is skipped for a calc report without credit_total (older reports)", () => {
    const old: CalcReport = { ...moneyCalc };
    delete old.credit_total;
    expect(enforceAmounts(["Credit $1.00."], old).reasons).toEqual(["Credit $1.00."]);
  });

  it("enforceReceipt applies it to receipt reasons and reports amountIssues", () => {
    const rec: Receipt = {
      ...base(),
      invoice_id: "HSG-1011",
      checks: moneyCalc.checks.map((c) => ({ name: c.check, expected: "", actual: "", result: c.result, evidence: `calc:${c.check}` })),
      reasons: [good[0], good[1], "Line 4: impact $600.00.", "Dispute and request a credit memo for $3,520.00."],
    };
    const r = enforceReceipt(rec, { ...ctx(), calc: moneyCalc, referenceAmounts: subjectNumbers });
    expect(r.amountIssues).toEqual(["$600.00", "$3,520.00"]);
    expect(r.receipt.reasons.slice(0, 4)).toEqual([good[0], good[1], "Line 4: impact $528.00.", "Dispute and request a credit memo for $3,448.00."]);
    expect(r.receipt.reasons.filter((x) => x.startsWith("Amount check:"))).toHaveLength(2);
  });

  it("numbersIn collects every number in a record", () => {
    expect(numbersIn({ a: 1, b: [2, { c: 3.5 }], d: "4", e: null })).toEqual([1, 2, 3.5]);
  });
});
