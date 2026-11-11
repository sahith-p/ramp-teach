/**
 * Read-only loaders for committed seed data under data/. Server-side only (uses fs).
 * Every loader validates against the frozen contracts.
 */
import fs from "node:fs";
import path from "node:path";
import {
  InvoiceSchema,
  VendorProfileSchema,
  TimecardsFileSchema,
  CorrectionsFileSchema,
  BillSchema,
  type Invoice,
  type VendorProfile,
  type Timecard,
  type Correction,
  type Bill,
} from "@/contracts";
import { P } from "./paths";
import { z } from "zod";

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadVendor(): VendorProfile {
  return VendorProfileSchema.parse(readJson(P.vendor));
}

export function loadTimecards(): Timecard[] {
  return TimecardsFileSchema.parse(readJson(P.timecards));
}

export function loadCorrections(): Correction[] {
  return CorrectionsFileSchema.parse(readJson(P.corrections));
}

export function loadBillsSeed(): Bill[] {
  return z.array(BillSchema).parse(readJson(P.billsSeed));
}

function listInvoicesIn(dir: string): Invoice[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => InvoiceSchema.parse(readJson(path.join(dir, f))));
}

export const loadPastInvoices = () => listInvoicesIn(P.pastInvoices);
export const loadNewInvoices = () => listInvoicesIn(P.newInvoices);
export const loadAllInvoices = () => [...loadPastInvoices(), ...loadNewInvoices()];

export function loadInvoice(invoiceId: string): Invoice | null {
  return loadAllInvoices().find((i) => i.invoice_id === invoiceId) ?? null;
}

/** Repo-relative path of an invoice file, for evidence pointers. */
export function invoicePathFor(invoiceId: string): string | null {
  for (const sub of ["new", "past"]) {
    const rel = `data/invoices/${sub}/${invoiceId}.json`;
    if (fs.existsSync(path.join(P.data, "invoices", sub, `${invoiceId}.json`))) return rel;
  }
  return null;
}
