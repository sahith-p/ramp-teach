/**
 * Calc tests. All fixtures are built in-test from the lane-spec world (docs/lane-spec.md §1).
 * Does NOT read data/ files and never the answer key.
 */
import { describe, expect, it } from "vitest";
import {
  CHECK_NAMES,
  CalcReportSchema,
  isValidEvidencePointer,
  type CalcCheckOutput,
  type CalcReport,
  type Invoice,
  type LineItem,
  type Timecard,
  type VendorProfile,
} from "@/contracts";
import {
  findEmployee,
  hoursMatchTimecards,
  lineAmountsCorrect,
  noDuplicateLines,
  noUnknownCharges,
  parseLaborLine,
  rateMatchesContract,
  runCalc,
  totalMatchesLineItems,
  type CalcInput,
} from "./index";

/* ------------------------------ Synthetic world ----------------------------- */

const vendor: VendorProfile = {
  vendor: "Halcyon Staffing Group",
  vendor_id: "V-HSG",
  contract: {
    contract_id: "C-HSG-2026",
    effective_from: "2026-01-01",
    effective_to: "2026-12-31",
    currency: "USD",
    payment_terms_days: 30,
    rate_card: [
      { role: "Senior Recruiter", bill_rate: 95 },
      { role: "Recruiting Coordinator", bill_rate: 62 },
      { role: "Sourcer", bill_rate: 70 },
      { role: "Data Analyst", bill_rate: 88 },
    ],
    allowed_charges: [
      { description: "Background check fee", max_amount: 120 },
      { description: "Job board posting", max_amount: 400 },
    ],
  },
  employees: [
    { employee_id: "E-101", name: "Maya Chen", role: "Senior Recruiter" },
    { employee_id: "E-102", name: "Jordan Alvarez", role: "Recruiting Coordinator" },
    { employee_id: "E-103", name: "Priya Natarajan", role: "Sourcer" },
    { employee_id: "E-104", name: "Sam Okafor", role: "Data Analyst" },
    { employee_id: "E-105", name: "Elena Rossi", role: "Recruiting Coordinator" },
  ],
};

const WEEK = "2026-10-18";
const PATH = "data/invoices/new/TEST-1.json";

const labor = (name: string, role: string, hours: number, rate: number, week = WEEK): LineItem => ({
  description: `Labor: ${name} (${role}) - week ending ${week}`,
  quantity: hours,
  unit_rate: rate,
  amount: Math.round(hours * rate * 100) / 100,
});
const charge = (description: string, amount: number): LineItem => ({ description, quantity: 1, unit_rate: amount, amount });

const invoiceOf = (line_items: LineItem[], total?: number): Invoice => ({
  vendor: "Halcyon Staffing Group",
  invoice_id: "TEST-1",
  issue_date: "2026-10-19",
  due_date: "2026-11-18",
  line_items,
  total: total ?? Math.round(line_items.reduce((s, l) => s + l.amount, 0) * 100) / 100,
  currency: "USD",
});

const tc = (employee_id: string, approved_hours: number, status: Timecard["status"] = "approved", week_ending = WEEK): Timecard => ({
  employee_id,
  week_ending,
  approved_hours,
  approved_by: "Dana Whitfield",
  status,
});

const cleanLines = (): LineItem[] => [
  labor("Maya Chen", "Senior Recruiter", 40, 95),
  labor("Jordan Alvarez", "Recruiting Coordinator", 36, 62),
  labor("Priya Natarajan", "Sourcer", 32, 70),
  labor("Sam Okafor", "Data Analyst", 38, 88),
  labor("Elena Rossi", "Recruiting Coordinator", 37.5, 62),
  charge("Background check fee", 120),
  charge("Job board posting", 350),
];
const cleanTimecards = (): Timecard[] => [tc("E-101", 40), tc("E-102", 36), tc("E-103", 32), tc("E-104", 38), tc("E-105", 37.5)];

const input = (invoice: Invoice, timecards: Timecard[] | null = cleanTimecards()): CalcInput => ({
  invoice,
  vendor,
  timecards,
  invoicePath: PATH,
});

const byName = (r: CalcReport, name: string) => r.checks.find((c) => c.check === name)!;
const expectPass = (o: CalcCheckOutput) => {
  expect(o.result).toBe("pass");
  expect(o.findings).toEqual([]);
  expect(o.summary.length).toBeGreaterThan(0);
};
const expectEvidenceValid = (o: CalcCheckOutput) => {
  for (const f of o.findings) expect(isValidEvidencePointer(f.evidence), f.evidence).toBe(true);
};

/* --------------------------------- parse ------------------------------------ */

describe("parse", () => {
  it("parses the frozen labor-line format", () => {
    expect(parseLaborLine("Labor: Maya Chen (Senior Recruiter) - week ending 2026-10-18")).toEqual({
      name: "Maya Chen",
      role: "Senior Recruiter",
      week_ending: "2026-10-18",
    });
  });
  it("treats anything else as non-labor", () => {
    expect(parseLaborLine("Background check fee")).toBeNull();
    expect(parseLaborLine("Labor: Maya Chen - week ending 2026-10-18")).toBeNull();
    expect(parseLaborLine("Labor: Maya Chen (Senior Recruiter) week ending 2026-10-18")).toBeNull();
  });
  it("maps names to roster employees", () => {
    expect(findEmployee(vendor, "Sam Okafor")?.employee_id).toBe("E-104");
    expect(findEmployee(vendor, "Nobody Here")).toBeNull();
  });
});

/* ------------------------------ clean invoice ------------------------------- */

describe("runCalc on a clean invoice", () => {
  const report = runCalc(input(invoiceOf(cleanLines())), new Date("2026-10-20T12:00:00Z"));
  it("returns all six checks in CHECK_NAMES order, all pass", () => {
    expect(report.checks.map((c) => c.check)).toEqual([...CHECK_NAMES]);
    report.checks.forEach(expectPass);
  });
  it("validates against CalcReportSchema and uses the injected time", () => {
    expect(CalcReportSchema.parse(report)).toEqual(report);
    expect(report.invoice_id).toBe("TEST-1");
    expect(report.computed_at).toBe("2026-10-20T12:00:00.000Z");
  });
  it("is deterministic", () => {
    const again = runCalc(input(invoiceOf(cleanLines())), new Date("2026-10-20T12:00:00Z"));
    expect(again).toEqual(report);
  });
});

/* ------------------------------ per-check fails ----------------------------- */

describe("line_amounts_correct", () => {
  it("fails a line whose amount != qty × rate, with the invoice line pointer", () => {
    const lines = cleanLines();
    lines[1] = { ...lines[1], amount: 2300 }; // 36 × 62 = 2232
    const o = lineAmountsCorrect(input(invoiceOf(lines)));
    expect(o.result).toBe("fail");
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0]).toMatchObject({ line_index: 1, expected: "$2,232.00", actual: "$2,300.00", evidence: `${PATH}#line_items[1]` });
    expectEvidenceValid(o);
  });
  it("tolerates sub-cent float drift", () => {
    const lines = [{ description: "Job board posting", quantity: 3, unit_rate: 0.1, amount: 0.3 }];
    expectPass(lineAmountsCorrect(input(invoiceOf(lines))));
  });
});

describe("total_matches_line_items", () => {
  it("fails when total != sum of lines (invoice-level finding)", () => {
    const lines = cleanLines();
    const sum = lines.reduce((s, l) => s + l.amount, 0);
    const o = totalMatchesLineItems(input(invoiceOf(lines, sum + 100)));
    expect(o.result).toBe("fail");
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0].line_index).toBeNull();
    expect(o.findings[0].evidence).toBe(`${PATH}#total`);
    expectEvidenceValid(o);
  });
  it("passes with float-drift sums", () => {
    const lines = [charge("Job board posting", 0.1), charge("Job board posting", 0.2)];
    expectPass(totalMatchesLineItems(input(invoiceOf(lines, 0.3))));
  });
});

describe("rate_matches_contract", () => {
  it("fails a labor line billed above the contract rate", () => {
    const lines = cleanLines();
    lines[0] = labor("Maya Chen", "Senior Recruiter", 40, 105);
    const o = rateMatchesContract(input(invoiceOf(lines)));
    expect(o.result).toBe("fail");
    expect(o.findings).toEqual([
      expect.objectContaining({
        line_index: 0,
        expected: "95.00/h",
        actual: "105.00/h",
        evidence: "data/vendor.json#contract.rate_card.Senior Recruiter",
      }),
    ]);
    expectEvidenceValid(o);
  });
  it("fails a labor line whose role is not on the rate card", () => {
    const lines = [...cleanLines(), labor("Elena Rossi", "Hiring Manager", 5, 62)];
    const o = rateMatchesContract(input(invoiceOf(lines)));
    expect(o.result).toBe("fail");
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0]).toMatchObject({ line_index: 7, actual: "Hiring Manager", evidence: "data/vendor.json#contract.rate_card" });
    expectEvidenceValid(o);
  });
  it("ignores non-labor lines", () => {
    expectPass(rateMatchesContract(input(invoiceOf([charge("Background check fee", 99)]))));
  });
});

describe("no_duplicate_lines", () => {
  it("flags every repeat after the first, referencing the first index", () => {
    const lines = cleanLines();
    lines.push(labor("Priya Natarajan", "Sourcer", 32, 70), labor("Priya Natarajan", "Sourcer", 8, 70));
    const o = noDuplicateLines(input(invoiceOf(lines)));
    expect(o.result).toBe("fail");
    expect(o.findings.map((f) => f.line_index)).toEqual([7, 8]);
    for (const f of o.findings) {
      expect(f.actual).toContain("line_items[2]");
      expect(f.message).toContain("line_items[2]");
      expect(f.evidence).toBe(`${PATH}#line_items[${f.line_index}]`);
    }
    expectEvidenceValid(o);
  });
  it("does not flag the same employee in different weeks", () => {
    const lines = [labor("Maya Chen", "Senior Recruiter", 40, 95, "2026-10-11"), labor("Maya Chen", "Senior Recruiter", 40, 95)];
    expectPass(noDuplicateLines(input(invoiceOf(lines))));
  });
});

describe("no_unknown_charges", () => {
  it("fails a non-labor line that is not an allowed charge", () => {
    const lines = [...cleanLines(), charge("Rush fee", 250)];
    const o = noUnknownCharges(input(invoiceOf(lines)));
    expect(o.result).toBe("fail");
    expect(o.findings).toEqual([
      expect.objectContaining({ line_index: 7, actual: "Rush fee", evidence: "data/vendor.json#contract.allowed_charges" }),
    ]);
    expectEvidenceValid(o);
  });
  it("fails an allowed charge above its cap; at the cap passes", () => {
    const over = noUnknownCharges(input(invoiceOf([charge("Background check fee", 150)])));
    expect(over.result).toBe("fail");
    expect(over.findings[0]).toMatchObject({ line_index: 0, expected: "≤ $120.00", actual: "$150.00" });
    expectEvidenceValid(over);
    expectPass(noUnknownCharges(input(invoiceOf([charge("Background check fee", 120)]))));
  });
  it("requires an exact description match", () => {
    expect(noUnknownCharges(input(invoiceOf([charge("background check fee", 50)]))).result).toBe("fail");
  });
});

describe("hours_match_timecards", () => {
  it("fails a labor line billing more than approved hours, with a fixture pointer", () => {
    const lines = cleanLines();
    lines[3] = labor("Sam Okafor", "Data Analyst", 44, 88);
    const o = hoursMatchTimecards(input(invoiceOf(lines)));
    expect(o.result).toBe("fail");
    expect(o.findings).toEqual([
      expect.objectContaining({
        line_index: 3,
        expected: "38 h",
        actual: "44 h",
        evidence: `fixture:/portal/employees/E-104?week=${WEEK}`,
      }),
    ]);
    expectEvidenceValid(o);
  });
  it("passes when billed hours are below approved hours", () => {
    const lines = [labor("Sam Okafor", "Data Analyst", 30, 88)];
    expectPass(hoursMatchTimecards(input(invoiceOf(lines))));
  });
  it("fails a labor line with no timecard for that employee-week", () => {
    const o = hoursMatchTimecards(input(invoiceOf(cleanLines()), cleanTimecards().filter((t) => t.employee_id !== "E-105")));
    expect(o.result).toBe("fail");
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0]).toMatchObject({ line_index: 4, actual: "no timecard found", evidence: `fixture:/portal/employees/E-105?week=${WEEK}` });
    expectEvidenceValid(o);
  });
  it("fails when the only timecard is not approved", () => {
    const tcs = cleanTimecards().map((t) => (t.employee_id === "E-101" ? { ...t, status: "pending" as const } : t));
    const o = hoursMatchTimecards(input(invoiceOf(cleanLines()), tcs));
    expect(o.result).toBe("fail");
    expect(o.findings[0]).toMatchObject({ line_index: 0, actual: "timecard pending, not approved" });
  });
  it("fails a labor line for someone not on the roster (invoice-line evidence)", () => {
    const o = hoursMatchTimecards(input(invoiceOf([labor("Alex Unknown", "Sourcer", 10, 70)])));
    expect(o.result).toBe("fail");
    expect(o.findings[0].evidence).toBe(`${PATH}#line_items[0]`);
    expectEvidenceValid(o);
  });
  it("does not use a timecard from a different week", () => {
    const o = hoursMatchTimecards(input(invoiceOf([labor("Maya Chen", "Senior Recruiter", 40, 95)]), [tc("E-101", 40, "approved", "2026-10-11")]));
    expect(o.result).toBe("fail");
  });
  it("is unverified (no findings) when timecards are null", () => {
    const o = hoursMatchTimecards(input(invoiceOf(cleanLines()), null));
    expect(o.result).toBe("unverified");
    expect(o.findings).toEqual([]);
    expect(o.summary).toMatch(/portal/i);
  });
});

/* ----------------------- planted-error-type invoice ------------------------- */

describe("invoice mirroring the HSG-1011 planted error types", () => {
  // rate 105 vs 95 (Maya), duplicate Priya employee-week line, Sam 44 billed vs 38 approved.
  const lines: LineItem[] = [
    labor("Maya Chen", "Senior Recruiter", 40, 105),
    labor("Jordan Alvarez", "Recruiting Coordinator", 36, 62),
    labor("Priya Natarajan", "Sourcer", 32, 70),
    labor("Sam Okafor", "Data Analyst", 44, 88),
    labor("Elena Rossi", "Recruiting Coordinator", 37.5, 62),
    labor("Priya Natarajan", "Sourcer", 32, 70),
    charge("Background check fee", 120),
  ];
  const report = runCalc(input(invoiceOf(lines)));

  it("fails exactly rate, duplicate, and hours; arithmetic/total/unknown-charge pass", () => {
    const failed = report.checks.filter((c) => c.result === "fail").map((c) => c.check);
    expect(failed).toEqual(["rate_matches_contract", "no_duplicate_lines", "hours_match_timecards"]);
    expectPass(byName(report, "line_amounts_correct"));
    expectPass(byName(report, "total_matches_line_items"));
    expectPass(byName(report, "no_unknown_charges"));
  });
  it("pins each failure to the right line", () => {
    expect(byName(report, "rate_matches_contract").findings.map((f) => f.line_index)).toEqual([0]);
    expect(byName(report, "no_duplicate_lines").findings.map((f) => f.line_index)).toEqual([5]);
    expect(byName(report, "hours_match_timecards").findings.map((f) => f.line_index)).toEqual([3]);
  });
  it("the duplicated line does NOT also fail the hours check (no summing)", () => {
    const hourLines = byName(report, "hours_match_timecards").findings.map((f) => f.line_index);
    expect(hourLines).not.toContain(2);
    expect(hourLines).not.toContain(5);
  });
  it("every finding has a valid evidence pointer and the report parses", () => {
    report.checks.forEach(expectEvidenceValid);
    expect(() => CalcReportSchema.parse(report)).not.toThrow();
    expect(Number.isNaN(Date.parse(report.computed_at))).toBe(false);
  });
  it("with timecards null, hours is unverified and the other two still fail", () => {
    const r = runCalc(input(invoiceOf(lines), null));
    expect(byName(r, "hours_match_timecards").result).toBe("unverified");
    expect(r.checks.filter((c) => c.result === "fail").map((c) => c.check)).toEqual(["rate_matches_contract", "no_duplicate_lines"]);
  });
});
