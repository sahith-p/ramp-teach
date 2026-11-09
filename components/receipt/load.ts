/** Server-side loading for the receipt review page. Never reads data/answer_key.json. */
import fs from "node:fs";
import {
  billIdFor,
  CalcReportSchema,
  InvoiceSchema,
  ReceiptSchema,
  type Bill,
  type CalcReport,
  type Invoice,
  type Receipt,
} from "@/contracts";
import { P, runDir } from "@/lib/paths";
import { invoicePathFor, loadInvoice } from "@/lib/data";
import { readReceipt } from "@/lib/store/receipts";
import { getBill } from "@/lib/store/bills";
import sampleReceipt from "@/samples/receipt.sample.json";
import sampleCalc from "@/samples/calc.sample.json";
import sampleInvoice from "@/samples/invoice.sample.json";
import { isSafeId, SAMPLE_ID } from "./format";

export interface ReviewData {
  sample: boolean;
  receipt: Receipt;
  invoice: Invoice | null;
  /** Where the invoice came from, for honest labelling. */
  invoiceSource: string | null;
  calc: CalcReport | null;
  bill: Bill | null;
  billId: string;
}

function tryLoadInvoice(invoiceId: string): Invoice | null {
  try {
    return loadInvoice(invoiceId);
  } catch {
    return null; // data lane may still be writing data/; fall back to a receipt-only summary
  }
}

function tryLoadCalc(invoiceId: string): CalcReport | null {
  try {
    const f = `${runDir(invoiceId)}/calc.json`;
    if (!fs.existsSync(f)) return null;
    const r = CalcReportSchema.safeParse(JSON.parse(fs.readFileSync(f, "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Read the bill without materialising an empty runtime/bills.json when no seed exists yet. */
export function tryGetBill(billId: string): Bill | null {
  try {
    if (!fs.existsSync(P.billsState) && !fs.existsSync(P.billsSeed)) return null;
    return getBill(billId);
  } catch {
    return null;
  }
}

export function loadReview(invoiceId: string): ReviewData | null {
  if (invoiceId === SAMPLE_ID) {
    const receipt = ReceiptSchema.parse(sampleReceipt);
    return {
      sample: true,
      receipt,
      invoice: InvoiceSchema.parse(sampleInvoice),
      invoiceSource: "samples/invoice.sample.json",
      calc: CalcReportSchema.parse(sampleCalc),
      bill: null,
      billId: billIdFor(receipt.invoice_id),
    };
  }
  if (!isSafeId(invoiceId)) return null;
  const receipt = readReceipt(invoiceId);
  if (!receipt) return null;
  const invoice = tryLoadInvoice(invoiceId);
  const billId = billIdFor(invoiceId);
  return {
    sample: false,
    receipt,
    invoice,
    invoiceSource: invoice ? invoicePathFor(invoiceId) : null,
    calc: tryLoadCalc(invoiceId),
    bill: tryGetBill(billId),
    billId,
  };
}
