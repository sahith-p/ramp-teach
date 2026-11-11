/**
 * Correction-derived evals for the invoice-review workflow (owned by learn-builder, T-20).
 * Every reviewer correction in data/corrections.json becomes one EvalCase (EV-<correction_id>)
 * expecting the named check to FAIL at the correction's line_index on that past invoice.
 *
 * Deterministic. Never reads data/answer_key.json.
 */
import { EvalsFileSchema, type Correction, type EvalCase } from "@/contracts";
import { invoicePathFor, loadCorrections } from "@/lib/data";

/** Pure: corrections -> eval cases. `resolvePath` resolves an invoice id to its repo-relative path. */
export function buildEvalCases(corrections: Correction[], resolvePath: (invoiceId: string) => string | null): EvalCase[] {
  return EvalsFileSchema.parse(
    corrections.map((c) => {
      const invoice_path = resolvePath(c.invoice_id);
      if (!invoice_path) throw new Error(`Correction ${c.correction_id}: invoice ${c.invoice_id} not found under data/invoices/`);
      return {
        eval_id: `EV-${c.correction_id}`,
        source_correction_id: c.correction_id,
        invoice_path,
        expect: { check: c.check, result: "fail" as const, line_index: c.line_index },
        note: `${c.description} Expected ${c.expected}; invoice had ${c.actual}. Resolution: ${c.resolution} (${c.corrected_by}, ${c.corrected_at})`,
      };
    }),
  );
}

/** Convenience: build eval cases from the committed seed data (data/corrections.json). */
export function invoiceReviewEvals(): EvalCase[] {
  return buildEvalCases(loadCorrections(), invoicePathFor);
}
