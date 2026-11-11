/**
 * Credit amounts (deterministic — NO LLM, no I/O). Turns failing findings into overbilled dollars so the
 * receipt's money figures come from code, not from the model (storyboard pre-render item 1).
 *
 * Every failing finding gets `amount` (USD, 2 decimals, never negative). Per check:
 *
 *  - line_amounts_correct     amount − quantity × unit_rate            (0 when the line is underbilled)
 *  - total_matches_line_items invoice.total − Σ line amounts           (0 when the total is under the sum)
 *  - rate_matches_contract    quantity × (unit_rate − contract rate)   (0 when billed below the contract rate)
 *                             role not on the rate card ⇒ the whole line amount (no contracted rate exists)
 *  - no_duplicate_lines       the duplicate line's amount (the later line; the first one stays billable)
 *  - no_unknown_charges       charge not allowed ⇒ the whole line amount;
 *                             over the cap ⇒ min(amount, quantity × unit_rate) − cap
 *  - hours_match_timecards    (billed − approved hours) × rate, where rate = min(unit_rate, contract rate)
 *                             no approved timecard / not on roster ⇒ billed hours × rate
 *
 * The per-line pieces telescope (amount → qty × billed rate → qty × contract rate → approved hours × contract
 * rate), so a line that fails several checks is not double-counted: e.g. rate + hours on one line credits
 * exactly amount − approved × contract rate. A line with a "whole line" finding (duplicate, unknown charge,
 * role not on the rate card) credits its full amount once: the first such finding (in that priority order)
 * carries it and every other finding on that line gets 0. As a final guard a line never credits more than
 * its own amount.
 *
 * credit_total = Σ amounts (0 when nothing fails). Unverified checks have no findings, so no amount.
 */
import type { CalcCheckOutput, CheckName, LineItem } from "@/contracts";
import { cents } from "@/lib/money";
import type { CalcInput } from "./checks";
import { findEmployee, parseLaborLine } from "./parse";

const pos = (n: number) => Math.max(0, cents(n));

/** Contract rate for a labor line's role, or null for a non-labor line / a role not on the rate card. */
function contractRate(input: Pick<CalcInput, "vendor">, item: LineItem): number | null {
  const parsed = parseLaborLine(item.description);
  if (!parsed) return null;
  const entry = input.vendor.contract.rate_card.find((r) => r.role.trim().toLowerCase() === parsed.role.trim().toLowerCase());
  return entry ? entry.bill_rate : null;
}

/** Whole-line findings, highest priority first. */
const WHOLE_LINE_PRIORITY: CheckName[] = ["no_duplicate_lines", "no_unknown_charges", "rate_matches_contract"];
/** When a line's pieces exceed its amount, trim in this order (most derived first). */
const TRIM_ORDER: CheckName[] = ["hours_match_timecards", "rate_matches_contract", "no_unknown_charges", "line_amounts_correct"];

interface Piece {
  check: CheckName;
  findingIndex: number;
  line: number | null;
  amount: number;
  wholeLine: boolean;
}

function pieceFor(input: CalcInput, check: CheckName, line: number | null): { amount: number; wholeLine: boolean } {
  const { invoice, vendor, timecards } = input;
  if (check === "total_matches_line_items" || line === null) {
    if (check !== "total_matches_line_items") return { amount: 0, wholeLine: false };
    const sum = invoice.line_items.reduce((s, li) => s + li.amount, 0);
    return { amount: pos(invoice.total - sum), wholeLine: false };
  }
  const item = invoice.line_items[line];
  if (!item) return { amount: 0, wholeLine: false };
  const billedMath = cents(item.quantity * item.unit_rate);
  switch (check) {
    case "line_amounts_correct":
      return { amount: pos(item.amount - billedMath), wholeLine: false };
    case "rate_matches_contract": {
      const c = contractRate(input, item);
      if (c === null) return { amount: pos(item.amount), wholeLine: true };
      return { amount: pos(item.quantity * (item.unit_rate - c)), wholeLine: false };
    }
    case "no_duplicate_lines":
      return { amount: pos(item.amount), wholeLine: true };
    case "no_unknown_charges": {
      const charge = vendor.contract.allowed_charges.find((ch) => ch.description === item.description);
      if (!charge) return { amount: pos(item.amount), wholeLine: true };
      if (charge.max_amount === null) return { amount: 0, wholeLine: false };
      return { amount: pos(Math.min(item.amount, billedMath) - charge.max_amount), wholeLine: false };
    }
    case "hours_match_timecards": {
      const parsed = parseLaborLine(item.description);
      if (!parsed) return { amount: 0, wholeLine: false };
      const c = contractRate(input, item);
      const rate = c === null ? item.unit_rate : Math.min(item.unit_rate, c);
      const employee = findEmployee(vendor, parsed.name);
      const approved = employee
        ? (timecards ?? []).find((t) => t.employee_id === employee.employee_id && t.week_ending === parsed.week_ending && t.status === "approved")
        : undefined;
      const supported = approved ? approved.approved_hours : 0;
      return { amount: pos(Math.max(0, item.quantity - supported) * rate), wholeLine: false };
    }
    default:
      return { amount: 0, wholeLine: false };
  }
}

/** Add `amount` to every failing finding and compute the report's credit_total. Pure. */
export function assignCredits(input: CalcInput, checks: CalcCheckOutput[]): { checks: CalcCheckOutput[]; credit_total: number } {
  const pieces: Piece[] = [];
  for (const c of checks) {
    if (c.result !== "fail") continue;
    c.findings.forEach((f, findingIndex) => {
      pieces.push({ check: c.check, findingIndex, line: f.line_index, ...pieceFor(input, c.check, f.line_index) });
    });
  }

  // Per line: one whole-line finding carries the full amount; everything else on that line is 0.
  const byLine = new Map<number, Piece[]>();
  for (const p of pieces) if (p.line !== null) byLine.set(p.line, [...(byLine.get(p.line) ?? []), p]);
  for (const [line, ps] of byLine) {
    const whole = ps.filter((p) => p.wholeLine);
    if (whole.length > 0) {
      const rank = (p: Piece) => WHOLE_LINE_PRIORITY.indexOf(p.check);
      const winner = [...whole].sort((a, b) => rank(a) - rank(b) || a.findingIndex - b.findingIndex)[0];
      for (const p of ps) if (p !== winner) p.amount = 0;
      continue;
    }
    // Guard: never credit more than the line's own amount.
    const lineAmount = Math.max(0, input.invoice.line_items[line]?.amount ?? 0);
    let excess = cents(ps.reduce((s, p) => s + p.amount, 0) - lineAmount);
    for (const check of TRIM_ORDER) {
      if (excess <= 0) break;
      for (const p of ps.filter((x) => x.check === check)) {
        const cut = Math.min(p.amount, excess);
        p.amount = cents(p.amount - cut);
        excess = cents(excess - cut);
      }
    }
  }

  const amountOf = new Map(pieces.map((p) => [`${p.check}#${p.findingIndex}`, p.amount]));
  const out = checks.map((c) =>
    c.result !== "fail"
      ? c
      : { ...c, findings: c.findings.map((f, i) => ({ ...f, amount: amountOf.get(`${c.check}#${i}`) ?? 0 })) },
  );
  const credit_total = cents(pieces.reduce((s, p) => s + p.amount, 0));
  return { checks: out, credit_total };
}
