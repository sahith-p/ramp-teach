/**
 * Bill store for the fixture Ramp-style bill inbox.
 * Seed: data/bills.json (committed, read-only). Live state: runtime/bills.json (gitignored),
 * created from the seed on first access. `resetBills()` restores the seed.
 */
import fs from "node:fs";
import { z } from "zod";
import { BillSchema, type Bill, type BillStatus } from "@/contracts";
import { P } from "../paths";
import { loadBillsSeed } from "../data";

const BillsSchema = z.array(BillSchema);

export function readBills(): Bill[] {
  if (!fs.existsSync(P.billsState)) resetBills();
  return BillsSchema.parse(JSON.parse(fs.readFileSync(P.billsState, "utf8")));
}

function writeBills(bills: Bill[]) {
  fs.mkdirSync(P.runtime, { recursive: true });
  fs.writeFileSync(P.billsState, JSON.stringify(BillsSchema.parse(bills), null, 2) + "\n");
}

export function resetBills(): Bill[] {
  const seed = fs.existsSync(P.billsSeed) ? loadBillsSeed() : [];
  writeBills(seed);
  return seed;
}

export function getBill(billId: string): Bill | null {
  return readBills().find((b) => b.bill_id === billId) ?? null;
}

/** Attach a receipt to a bill. Optionally set the post-decision status. Returns the updated bill. */
export function attachReceipt(billId: string, receiptId: string, status: BillStatus = "receipt_attached"): Bill {
  const bills = readBills();
  const i = bills.findIndex((b) => b.bill_id === billId);
  if (i === -1) throw new Error(`Unknown bill ${billId}`);
  bills[i] = { ...bills[i], receipt_id: receiptId, status };
  writeBills(bills);
  return bills[i];
}
