import path from "node:path";

/** Repo root. Everything reads/writes relative to this (never outside it). */
export const ROOT = process.env.RAMP_TEACH_ROOT ?? process.cwd();

export const P = {
  data: path.join(ROOT, "data"),
  vendor: path.join(ROOT, "data", "vendor.json"),
  timecards: path.join(ROOT, "data", "timecards.json"),
  corrections: path.join(ROOT, "data", "corrections.json"),
  billsSeed: path.join(ROOT, "data", "bills.json"),
  answerKey: path.join(ROOT, "data", "answer_key.json"),
  recordingSample: path.join(ROOT, "data", "recording.sample.json"),
  pastInvoices: path.join(ROOT, "data", "invoices", "past"),
  newInvoices: path.join(ROOT, "data", "invoices", "new"),
  rules: path.join(ROOT, "rules"),
  workflowSpec: path.join(ROOT, "rules", "workflow_spec.json"),
  evals: path.join(ROOT, "rules", "evals.json"),
  receipts: path.join(ROOT, "receipts"),
  decisions: path.join(ROOT, "receipts", "decisions.jsonl"),
  runtime: path.join(ROOT, "runtime"),
  billsState: path.join(ROOT, "runtime", "bills.json"),
  runs: path.join(ROOT, "runs"),
  agentTrace: path.join(ROOT, "agent", "trace.jsonl"),
};

export const receiptPath = (invoiceId: string) => path.join(P.receipts, `${invoiceId}.json`);
export const runDir = (invoiceId: string) => path.join(P.runs, invoiceId);

/** Base URL of the local Next app (fixture portal + bill inbox + receipt UI). localhost only. */
export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
