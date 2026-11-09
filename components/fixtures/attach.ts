/**
 * Human-only "Attach receipt" action for the fixture bill inbox (POST /api/bills/<bill_id>/attach).
 * The agent never calls this. Kept out of the route file so it can be unit-tested.
 */
import { invoiceIdFromBillId, receiptIdFor, type Bill, type BillStatus } from "@/contracts";
import { attachReceipt, getBill } from "@/lib/store/bills";
import { readReceipt } from "@/lib/store/receipts";

export type AttachResult =
  | { ok: true; bill: Bill }
  | { ok: false; status: 400 | 404 | 409; error: string };

export function attachReceiptToBill(billId: string, receiptId: unknown): AttachResult {
  const bill = getBill(billId);
  if (!bill) return { ok: false, status: 404, error: `Unknown bill ${billId}` };

  const invoiceId = invoiceIdFromBillId(billId);
  const expected = receiptIdFor(invoiceId);
  if (typeof receiptId !== "string" || receiptId.trim() === "") {
    return { ok: false, status: 400, error: "Body must include receipt_id (string)" };
  }
  if (receiptId !== expected) {
    return { ok: false, status: 400, error: `receipt_id for ${billId} must be ${expected}` };
  }
  if (bill.receipt_id) {
    return { ok: false, status: 409, error: `Bill ${billId} already has receipt ${bill.receipt_id} attached` };
  }
  const receipt = readReceipt(invoiceId);
  if (!receipt) return { ok: false, status: 404, error: `No receipt file for ${invoiceId} (receipts/${invoiceId}.json)` };

  // If a human already decided on the receipt, the bill reflects that decision; otherwise it is just attached.
  const status: BillStatus =
    receipt.human_decision === "approve" ? "approved" : receipt.human_decision === "dispute" ? "disputed" : "receipt_attached";
  return { ok: true, bill: attachReceipt(billId, receiptId, status) };
}
