import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvalsFileSchema, InvoiceSchema } from "@/contracts";
import { runCalc } from "@/calc";
import { loadCorrections, loadTimecards, loadVendor } from "@/lib/data";
import { runEvalCases } from "@/learn/evals-runner";
import { buildEvalCases, invoiceReviewEvals } from "./evals";

describe("correction-derived evals", () => {
  const corrections = loadCorrections();
  const cases = invoiceReviewEvals();

  it("creates exactly one valid EvalCase per correction", () => {
    expect(() => EvalsFileSchema.parse(cases)).not.toThrow();
    expect(cases).toHaveLength(corrections.length);
    for (const c of corrections) {
      const ev = cases.find((e) => e.source_correction_id === c.correction_id)!;
      expect(ev.eval_id).toBe(`EV-${c.correction_id}`);
      expect(ev.expect).toEqual({ check: c.check, result: "fail", line_index: c.line_index });
      expect(ev.invoice_path).toBe(`data/invoices/past/${c.invoice_id}.json`);
    }
  });

  it("covers all six checks", () => {
    expect(new Set(cases.map((c) => c.expect.check)).size).toBe(6);
  });

  it("throws on a correction whose invoice does not exist", () => {
    expect(() => buildEvalCases([{ ...corrections[0], invoice_id: "NOPE-1" }], () => null)).toThrow(/NOPE-1/);
  });

  it("every case fails its named check at the expected line under calc (timecards stand-in)", () => {
    const vendor = loadVendor();
    const timecards = loadTimecards();
    const root = path.resolve(__dirname, "../../..");
    const results = runEvalCases(cases, (c) =>
      runCalc({
        invoice: InvoiceSchema.parse(JSON.parse(fs.readFileSync(path.join(root, c.invoice_path), "utf8"))),
        vendor,
        timecards,
        invoicePath: c.invoice_path,
      }),
    );
    expect(results.filter((r) => !r.passed)).toEqual([]);
  });

  it("judges a case as failed when the check passes", () => {
    const [first] = cases;
    const results = runEvalCases([first], () => ({
      invoice_id: "x",
      computed_at: "t",
      checks: [{ check: first.expect.check, result: "pass", findings: [], summary: "" }],
    }));
    expect(results[0].passed).toBe(false);
  });
});
