/**
 * Credit amounts (calc/credits.ts). Synthetic edge cases in-test, plus the committed seed data:
 * HSG-1011 must credit 400 + 2,520 + 528 = 3,448, and every past correction's credit memo must match.
 * Never reads data/answer_key.json.
 */
import { describe, expect, it } from "vitest";
import { CalcReportSchema, type Invoice, type LineItem, type Timecard, type VendorProfile } from "@/contracts";
import { invoicePathFor, loadAllInvoices, loadCorrections, loadInvoice, loadTimecards, loadVendor } from "@/lib/data";
import { runCalc } from "./index";

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
      { role: "Data Analyst", bill_rate: 88 },
    ],
    allowed_charges: [
      { description: "Background check fee", max_amount: 120 },
      { description: "Parking", max_amount: null },
    ],
  },
  employees: [
    { employee_id: "E-101", name: "Maya Chen", role: "Senior Recruiter" },
    { employee_id: "E-104", name: "Sam Okafor", role: "Data Analyst" },
  ],
};
const WEEK = "2026-10-18";
const labor = (name: string, role: string, hours: number, rate: number, amount = Math.round(hours * rate * 100) / 100): LineItem => ({
  description: `Labor: ${name} (${role}) - week ending ${WEEK}`,
  quantity: hours,
  unit_rate: rate,
  amount,
});
const charge = (description: string, amount: number): LineItem => ({ description, quantity: 1, unit_rate: amount, amount });
const inv = (line_items: LineItem[], total?: number): Invoice => ({
  vendor: vendor.vendor,
  invoice_id: "TEST-C",
  issue_date: "2026-10-19",
  due_date: "2026-11-18",
  line_items,
  total: total ?? Math.round(line_items.reduce((s, l) => s + l.amount, 0) * 100) / 100,
  currency: "USD",
});
const tc = (employee_id: string, approved_hours: number, status: Timecard["status"] = "approved"): Timecard => ({
  employee_id,
  week_ending: WEEK,
  approved_hours,
  approved_by: "Dana Whitfield",
  status,
});
const calc = (invoice: Invoice, timecards: Timecard[] | null = [tc("E-101", 40), tc("E-104", 38)]) =>
  CalcReportSchema.parse(runCalc({ invoice, vendor, timecards, invoicePath: "data/invoices/new/TEST-C.json" }));
const amounts = (r: ReturnType<typeof calc>) =>
  Object.fromEntries(r.checks.flatMap((c) => c.findings.map((f) => [`${c.check}@${f.line_index}`, f.amount])));

describe("calc credit amounts — definitions", () => {
  it("clean invoice: no findings, credit_total 0", () => {
    const r = calc(inv([labor("Maya Chen", "Senior Recruiter", 40, 95), labor("Sam Okafor", "Data Analyst", 38, 88)]));
    expect(r.checks.every((c) => c.findings.length === 0)).toBe(true);
    expect(r.credit_total).toBe(0);
  });

  it("rate: (billed − contract) × hours; hours: (billed − approved) × rate; duplicate: the line amount", () => {
    const r = calc(
      inv([
        labor("Maya Chen", "Senior Recruiter", 40, 105),
        labor("Sam Okafor", "Data Analyst", 44, 88),
        labor("Sam Okafor", "Data Analyst", 10, 88),
      ]),
    );
    expect(amounts(r)).toEqual({
      "rate_matches_contract@0": 400,
      "hours_match_timecards@1": 528,
      "no_duplicate_lines@2": 880,
    });
    expect(r.credit_total).toBe(1808);
  });

  it("rate + hours on the same line telescope: credit = amount − approved × contract rate (no double count)", () => {
    const r = calc(inv([labor("Maya Chen", "Senior Recruiter", 44, 105)]));
    // rate 44 × 10 = 440; hours 4 × min(105, 95) = 380; total 4620 − 40 × 95 = 820
    expect(amounts(r)).toEqual({ "rate_matches_contract@0": 440, "hours_match_timecards@0": 380 });
    expect(r.credit_total).toBe(4620 - 40 * 95);
  });

  it("a duplicate line that also bills a wrong rate credits its amount once", () => {
    const r = calc(inv([labor("Maya Chen", "Senior Recruiter", 20, 105), labor("Maya Chen", "Senior Recruiter", 20, 105)]));
    expect(amounts(r)).toEqual({
      "rate_matches_contract@0": 200,
      "rate_matches_contract@1": 0,
      "no_duplicate_lines@1": 2100,
    });
    expect(r.credit_total).toBe(2300);
  });

  it("line math and total: the overbilled difference; underbilling credits 0", () => {
    const over = calc(inv([labor("Maya Chen", "Senior Recruiter", 40, 95, 3900)], 4100));
    expect(amounts(over)).toEqual({ "line_amounts_correct@0": 100, "total_matches_line_items@null": 200 });
    expect(over.credit_total).toBe(300);
    const under = calc(inv([labor("Maya Chen", "Senior Recruiter", 40, 95, 3700)], 3600));
    expect(amounts(under)).toEqual({ "line_amounts_correct@0": 0, "total_matches_line_items@null": 0 });
    expect(under.credit_total).toBe(0);
  });

  it("unknown charge: the whole charge; over the cap: the excess", () => {
    const r = calc(inv([labor("Maya Chen", "Senior Recruiter", 40, 95), charge("Rush fee", 250), charge("Background check fee", 150), charge("Parking", 999)]));
    expect(amounts(r)).toEqual({ "no_unknown_charges@1": 250, "no_unknown_charges@2": 30 });
    expect(r.credit_total).toBe(280);
  });

  it("no approved timecard or not on roster: every billed hour is unsupported", () => {
    const r = calc(inv([labor("Maya Chen", "Senior Recruiter", 10, 95), labor("Sam Okafor", "Data Analyst", 5, 88)]), [tc("E-101", 10, "pending")]);
    expect(amounts(r)).toEqual({ "hours_match_timecards@0": 950, "hours_match_timecards@1": 440 });
    const ghost = calc(inv([labor("Pat Doe", "Senior Recruiter", 2, 95)]));
    expect(amounts(ghost)["hours_match_timecards@0"]).toBe(190);
  });

  it("role not on the rate card: the whole line (once)", () => {
    const r = calc(inv([labor("Maya Chen", "Wizard", 10, 50)]), [tc("E-101", 10)]);
    expect(amounts(r)).toEqual({ "rate_matches_contract@0": 500 });
    expect(r.credit_total).toBe(500);
  });

  it("unverified hours carry no amount", () => {
    const r = calc(inv([labor("Sam Okafor", "Data Analyst", 44, 88)]), null);
    expect(r.checks.find((c) => c.check === "hours_match_timecards")?.result).toBe("unverified");
    expect(r.credit_total).toBe(0);
  });
});

describe("calc credit amounts — seed data", () => {
  const v = loadVendor();
  const timecards = loadTimecards();
  const run = (id: string) => {
    const invoice = loadInvoice(id)!;
    return runCalc({ invoice, vendor: v, timecards, invoicePath: invoicePathFor(id)! });
  };

  it("HSG-1011: rate 400.00, duplicate 2,520.00, hours 528.00, credit_total 3,448.00", () => {
    const r = run("HSG-1011");
    const failing = r.checks.filter((c) => c.result === "fail");
    expect(Object.fromEntries(failing.map((c) => [c.check, c.findings.map((f) => f.amount)]))).toEqual({
      rate_matches_contract: [400],
      no_duplicate_lines: [2520],
      hours_match_timecards: [528],
    });
    expect(r.credit_total).toBe(3448);
  });

  it("clean invoices: credit_total 0 and no findings", () => {
    for (const id of ["HSG-1001", "HSG-1008", "HSG-1010", "HSG-1012"]) {
      const r = run(id);
      expect(r.credit_total, id).toBe(0);
      expect(r.checks.flatMap((c) => c.findings), id).toEqual([]);
    }
  });

  it("matches every past correction's credit memo amount", () => {
    for (const c of loadCorrections()) {
      const memo = /\$([\d,]+\.\d{2})/.exec(c.resolution);
      expect(memo, c.correction_id).not.toBeNull();
      expect(run(c.invoice_id).credit_total, c.invoice_id).toBe(Number(memo![1].replace(/,/g, "")));
    }
  });

  it("every failing finding on every invoice has a non-negative 2-decimal amount", () => {
    for (const invoice of loadAllInvoices()) {
      const r = runCalc({ invoice, vendor: v, timecards, invoicePath: invoicePathFor(invoice.invoice_id)! });
      for (const c of r.checks)
        for (const f of c.findings) {
          expect(f.amount).toBeGreaterThanOrEqual(0);
          expect(Math.round(f.amount! * 100) / 100).toBe(f.amount);
        }
    }
  });
});
