/** Receipt store: receipts/<invoice_id>.json. Agent writes; decision API updates human fields. */
import fs from "node:fs";
import { ReceiptSchema, type Receipt } from "@/contracts";
import { P, receiptPath } from "../paths";

export function readReceipt(invoiceId: string): Receipt | null {
  const f = receiptPath(invoiceId);
  if (!fs.existsSync(f)) return null;
  return ReceiptSchema.parse(JSON.parse(fs.readFileSync(f, "utf8")));
}

export function writeReceipt(receipt: Receipt): string {
  const parsed = ReceiptSchema.parse(receipt);
  fs.mkdirSync(P.receipts, { recursive: true });
  const f = receiptPath(parsed.invoice_id);
  fs.writeFileSync(f, JSON.stringify(parsed, null, 2) + "\n");
  return f;
}

export function listReceipts(): Receipt[] {
  if (!fs.existsSync(P.receipts)) return [];
  return fs
    .readdirSync(P.receipts)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ReceiptSchema.safeParse(JSON.parse(fs.readFileSync(`${P.receipts}/${f}`, "utf8"))))
    .filter((r) => r.success)
    .map((r) => r.data);
}
