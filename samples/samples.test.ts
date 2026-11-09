import { describe, expect, it } from "vitest";
import {
  CHECK_NAMES,
  CalcReportSchema,
  InvoiceSchema,
  ReceiptSchema,
  LABOR_LINE_REGEX,
  parseEvidencePointer,
} from "@/contracts";
import { moneyEq } from "@/lib/money";
import receiptJson from "./receipt.sample.json";
import calcJson from "./calc.sample.json";
import invoiceJson from "./invoice.sample.json";

describe("samples/receipt.sample.json", () => {
  const receipt = ReceiptSchema.parse(receiptJson);

  it("is a valid Receipt for HSG-1011 with all six checks in CHECK_NAMES order", () => {
    expect(receipt.invoice_id).toBe("HSG-1011");
    expect(receipt.vendor).toBe("Halcyon Staffing Group");
    expect(receipt.checks.map((c) => c.name)).toEqual([...CHECK_NAMES]);
  });

  it("fails exactly the three planted checks and recommends dispute", () => {
    const failing = receipt.checks.filter((c) => c.result === "fail").map((c) => c.name);
    expect(failing.sort()).toEqual(["hours_match_timecards", "no_duplicate_lines", "rate_matches_contract"]);
    expect(receipt.recommendation).toBe("dispute");
  });

  it("is labelled mock and undecided", () => {
    expect(receipt.mode).toBe("mock");
    expect(receipt.human_decision).toBeNull();
    expect(receipt.decided_by).toBeNull();
    expect(receipt.decided_at).toBeNull();
  });

  it("every check carries a valid evidence pointer, covering all four kinds", () => {
    const kinds = receipt.checks.map((c) => parseEvidencePointer(c.evidence)?.kind);
    expect(kinds.every(Boolean)).toBe(true);
    expect(new Set(kinds)).toEqual(new Set(["calc", "data", "rules", "fixture"]));
  });
});

describe("samples/calc.sample.json", () => {
  it("is a valid CalcReport agreeing with the sample receipt", () => {
    const calc = CalcReportSchema.parse(calcJson);
    const receipt = ReceiptSchema.parse(receiptJson);
    expect(calc.checks.map((c) => c.check)).toEqual([...CHECK_NAMES]);
    for (const c of calc.checks) {
      expect(receipt.checks.find((r) => r.name === c.check)?.result).toBe(c.result);
      for (const f of c.findings) expect(parseEvidencePointer(f.evidence)).not.toBeNull();
    }
  });
});

describe("samples/invoice.sample.json", () => {
  it("is a valid Invoice whose arithmetic ties (only the 3 planted errors)", () => {
    const inv = InvoiceSchema.parse(invoiceJson);
    for (const li of inv.line_items) expect(moneyEq(li.quantity * li.unit_rate, li.amount)).toBe(true);
    expect(moneyEq(inv.line_items.reduce((s, l) => s + l.amount, 0), inv.total)).toBe(true);
    const labor = inv.line_items.filter((l) => LABOR_LINE_REGEX.test(l.description));
    expect(labor).toHaveLength(6);
  });
});
