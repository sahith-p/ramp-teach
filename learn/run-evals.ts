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
process.exit(failed.length ? 1 : 0);
