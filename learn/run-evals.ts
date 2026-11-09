/**
 * `npm run eval` — run every correction-derived eval case through calc's runCalc (deterministic, no LLM).
 * Exits non-zero if any case does not fail its named check at the expected line.
 *
 * Hours evidence: the eval harness uses data/timecards.json as the STAND-IN for portal evidence
 * (the agent reads the same numbers off the fixture portal pages at run time).
 * Never reads data/answer_key.json.
 *
 * Like learn/cli.ts this CLI is a wiring point (it imports calc + the workflow); the runner logic
 * in learn/evals-runner.ts stays generic.
 */
import fs from "node:fs";
import path from "node:path";
import { EvalsFileSchema, InvoiceSchema, type EvalCase } from "@/contracts";
import { runCalc } from "@/calc";
import { loadTimecards, loadVendor } from "@/lib/data";
import { ROOT } from "@/lib/paths";
import { formatEvalTable, runEvalCases } from "@/learn/evals-runner";
import { invoiceReviewEvals } from "@/workflows/invoice-review/evals";

function loadCases(): { cases: EvalCase[]; source: string } {
  const file = path.join(ROOT, "rules", "evals.json");
  if (fs.existsSync(file)) return { cases: EvalsFileSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))), source: "rules/evals.json" };
  return { cases: invoiceReviewEvals(), source: "data/corrections.json (rules/evals.json missing; generated in memory)" };
}

const { cases, source } = loadCases();
const vendor = loadVendor();
const timecards = loadTimecards();

console.log(`EVAL — ${cases.length} cases from ${source}`);
console.log("Mode: deterministic (calc runCalc, no LLM). Hours evidence: data/timecards.json as stand-in for portal evidence.\n");

const results = runEvalCases(cases, (c) => {
  const invoice = InvoiceSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, c.invoice_path), "utf8")));
  return runCalc({ invoice, vendor, timecards, invoicePath: c.invoice_path });
});

console.log(formatEvalTable(results));
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
for (const f of failed) console.log(`  FAIL ${f.eval_id}: ${f.reason}`);

// Precision guard (orchestrator, T-31): every past invoice must fail ONLY the checks its corrections
// name — clean invoices pass all six. Catches false positives the recall cases above cannot.
console.log("\nPRECISION — past invoices fail only the corrected check(s); clean invoices pass all");
const pastDir = path.join(ROOT, "data", "invoices", "past");
const expectedByInvoice = new Map<string, Set<string>>();
for (const c of cases) {
  const id = path.basename(c.invoice_path, ".json");
  if (!expectedByInvoice.has(id)) expectedByInvoice.set(id, new Set());
  expectedByInvoice.get(id)!.add(c.expect.check);
}
const precisionFailures: string[] = [];
for (const f of fs.readdirSync(pastDir).filter((x) => x.endsWith(".json")).sort()) {
  const rel = `data/invoices/past/${f}`;
  const invoice = InvoiceSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")));
  const report = runCalc({ invoice, vendor, timecards, invoicePath: rel });
  const got = report.checks.filter((c) => c.result !== "pass").map((c) => c.check).sort();
  const want = [...(expectedByInvoice.get(invoice.invoice_id) ?? [])].sort();
  const ok = got.join(",") === want.join(",");
  if (!ok) precisionFailures.push(`${invoice.invoice_id}: expected [${want.join(", ")}] got [${got.join(", ")}]`);
  console.log(`${invoice.invoice_id.padEnd(9)} ${(want.join(",") || "clean").padEnd(26)} ${(got.join(",") || "all pass").padEnd(26)} ${ok ? "PASS" : "FAIL"}`);
}
console.log(`${precisionFailures.length === 0 ? "precision OK" : `${precisionFailures.length} precision failure(s)`}`);
for (const p of precisionFailures) console.log(`  FAIL ${p}`);
process.exit(failed.length || precisionFailures.length ? 1 : 0);
