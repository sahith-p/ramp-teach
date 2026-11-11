/**
 * POST /api/decisions logic (docs/lane-spec.md §3), kept out of route.ts so Vitest can drive it.
 * The ONLY writer of human decisions: appends receipts/decisions.jsonl, sets the receipt's human
 * fields, and attaches the receipt to bill_<invoice_id> as approved/disputed.
 */
import fs from "node:fs";
import { z } from "zod";
import {
  billIdFor,
  receiptIdFor,
  HumanDecisionSchema,
  type Bill,
  type DecisionRecord,
  type Receipt,
} from "@/contracts";
import { P } from "@/lib/paths";
import { appendDecision } from "@/lib/store/decisions";
import { readReceipt, writeReceipt } from "@/lib/store/receipts";
import { attachReceipt, getBill } from "@/lib/store/bills";
import { SAFE_ID } from "@/components/receipt/format";

export const DecisionBodySchema = z.object({
  invoice_id: z.string().regex(SAFE_ID, "invalid invoice_id"),
  decision: HumanDecisionSchema,
  decided_by: z.string().trim().min(1, "decided_by is required").max(120),
  note: z.string().trim().max(2000).optional(),
});
export type DecisionBody = z.infer<typeof DecisionBodySchema>;

export type DecisionResult =
  | { status: 200; body: { decision: DecisionRecord; receipt: Receipt; bill: Bill } }
  | { status: 400 | 404 | 409; body: { error: string; issues?: unknown } };

export function handleDecision(input: unknown, now: () => Date = () => new Date()): DecisionResult {
  const parsed = DecisionBodySchema.safeParse(input);
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid decision body", issues: z.treeifyError(parsed.error) } };
  }
  const { invoice_id, decision, decided_by } = parsed.data;
  const note = parsed.data.note || undefined;

  const receipt = readReceipt(invoice_id);
  if (!receipt) return { status: 404, body: { error: `No receipt for ${invoice_id}` } };

  // One decision per receipt. A fresh agent run writes a new receipt with null human fields, and that
  // receipt can be decided again; receipts/decisions.jsonl stays the append-only history across runs.
  if (receipt.human_decision !== null) {
    return {
      status: 409,
      body: { error: `${invoice_id} was already decided (${receipt.human_decision}) by ${receipt.decided_by ?? "a reviewer"}` },
    };
  }

  // Validate the approval target before writing anything, so a failure leaves no partial state.
  // (Guard so a missing seed never materialises an empty runtime/bills.json.)
  const billId = billIdFor(invoice_id);
  const billsAvailable = fs.existsSync(P.billsState) || fs.existsSync(P.billsSeed);
  if (!billsAvailable || !getBill(billId)) {
    return { status: 404, body: { error: `No bill ${billId} to attach the receipt to` } };
  }

  const decided_at = now().toISOString();
  const receiptId = receiptIdFor(invoice_id);
  const record = appendDecision({
    invoice_id,
    receipt_id: receiptId,
    bill_id: billId,
    decision,
    decided_by,
    decided_at,
    ...(note ? { note } : {}),
  });
  const updated: Receipt = { ...receipt, human_decision: decision, decided_by, decided_at };
  writeReceipt(updated);
  const bill = attachReceipt(billId, receiptId, decision === "approve" ? "approved" : "disputed");

  return { status: 200, body: { decision: record, receipt: updated, bill } };
}
