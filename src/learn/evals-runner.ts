/**
 * Generic eval runner: each EvalCase expects one check to FAIL (optionally at a line index).
 * The caller supplies `evaluate` (learn/run-evals.ts wires calc's runCalc). Deterministic.
 * MUST NOT import from workflows/ or calc/.
 */
import type { CalcReport, EvalCase } from "@/contracts";

export interface EvalOutcome {
  eval_id: string;
  check: string;
  expected_line: number | null;
  actual_result: string;
  failing_lines: (number | null)[];
  passed: boolean;
  reason: string;
}

export function judgeCase(c: EvalCase, report: CalcReport): EvalOutcome {
  const out = report.checks.find((k) => k.check === c.expect.check);
  const base = { eval_id: c.eval_id, check: c.expect.check, expected_line: c.expect.line_index };
  if (!out) return { ...base, actual_result: "missing", failing_lines: [], passed: false, reason: "check not in report" };
  const failing_lines = out.findings.map((f) => f.line_index);
  if (out.result !== "fail") {
    return { ...base, actual_result: out.result, failing_lines, passed: false, reason: `expected fail, got ${out.result}` };
  }
  const atLine = failing_lines.includes(c.expect.line_index);
  return {
    ...base,
    actual_result: out.result,
    failing_lines,
    passed: atLine,
    reason: atLine ? "fails at expected line" : `fails, but not at line ${c.expect.line_index ?? "null (invoice-level)"}`,
  };
}

export function runEvalCases(cases: EvalCase[], evaluate: (c: EvalCase) => CalcReport): EvalOutcome[] {
  return cases.map((c) => {
    try {
      return judgeCase(c, evaluate(c));
    } catch (err) {
      return {
        eval_id: c.eval_id,
        check: c.expect.check,
        expected_line: c.expect.line_index,
        actual_result: "error",
        failing_lines: [],
        passed: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function formatEvalTable(results: EvalOutcome[]): string {
  const rows = results.map((r) => [
    r.eval_id,
    r.check,
    r.expected_line === null ? "null" : String(r.expected_line),
    r.actual_result,
    r.failing_lines.map((l) => (l === null ? "null" : String(l))).join(",") || "-",
    r.passed ? "PASS" : "FAIL",
  ]);
  const header = ["eval_id", "check", "exp_line", "result", "failing_lines", "verdict"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}
