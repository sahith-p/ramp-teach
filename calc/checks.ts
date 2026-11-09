/**
 * The six deterministic invoice checks (CHECK_NAMES). Mode: deterministic — NO LLM, no network,
 * no fs access. Pure functions of their input.
 *
 * Conventions:
 * - Money comparisons use lib/money.ts `moneyEq` (to the cent).
 * - `line_index` on findings is 0-based (index into invoice.line_items); human-readable
 *   messages say "line N" 1-based and quote the description so they are unambiguous.
 * - Every finding carries one evidence pointer valid per contracts/evidence.ts.
 */
import type {
  CalcCheckOutput,
  CalcFinding,
  CheckName,
  Invoice,
  LineItem,
  Timecard,
  VendorProfile,
} from "@/contracts";
import { cents, fmtMoney, moneyEq } from "@/lib/money";
import { laborLines, parseLaborLine, type LaborLine } from "./parse";

export interface CalcInput {
  invoice: Invoice;
  vendor: VendorProfile;
  /** Approved timecards gathered from portal evidence; null = no portal evidence available. */
  timecards: Timecard[] | null;
  /** Repo-relative invoice path, e.g. "data/invoices/new/HSG-1011.json". */
  invoicePath: string;
}

/** Where the vendor profile lives (evidence pointers point here). */
export const VENDOR_PATH = "data/vendor.json";

/* ------------------------------ Evidence pointers --------------------------- */

export const linePointer = (invoicePath: string, i: number) => `${invoicePath}#line_items[${i}]`;
export const totalPointer = (invoicePath: string) => `${invoicePath}#total`;
export const rateCardPointer = (role?: string) =>
  role ? `${VENDOR_PATH}#contract.rate_card.${role}` : `${VENDOR_PATH}#contract.rate_card`;
export const allowedChargesPointer = () => `${VENDOR_PATH}#contract.allowed_charges`;
export const timecardPointer = (employeeId: string, weekEnding: string) =>
  `fixture:/portal/employees/${encodeURIComponent(employeeId)}?week=${weekEnding}`;

/* --------------------------------- Formatting ------------------------------- */

const fmtRate = (r: number) => `${cents(r).toFixed(2)}/h`;
const fmtHours = (h: number) => `${Number.isInteger(h) ? h : Number(h.toFixed(2))} h`;
const lineRef = (i: number, item: LineItem) => `Line ${i + 1} ("${item.description}")`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function output(check: CheckName, findings: CalcFinding[], passSummary: string, failSummary: string): CalcCheckOutput {
  return findings.length === 0
    ? { check, result: "pass", findings: [], summary: passSummary }
    : { check, result: "fail", findings, summary: failSummary };
}

/* --------------------------------- Checks ----------------------------------- */

/** quantity × unit_rate == amount, to the cent, for every line. */
export function lineAmountsCorrect(input: Pick<CalcInput, "invoice" | "invoicePath">): CalcCheckOutput {
  const { invoice, invoicePath } = input;
  const fmt = (n: number) => fmtMoney(n, invoice.currency);
  const findings: CalcFinding[] = [];
  invoice.line_items.forEach((item, i) => {
    const expected = cents(item.quantity * item.unit_rate);
    if (!moneyEq(expected, item.amount)) {
      findings.push({
        line_index: i,
        expected: fmt(expected),
        actual: fmt(item.amount),
        message: `${lineRef(i, item)}: ${item.quantity} × ${item.unit_rate.toFixed(2)} = ${fmt(expected)}, but the line amount is ${fmt(item.amount)}.`,
        evidence: linePointer(invoicePath, i),
      });
    }
  });
  const n = invoice.line_items.length;
  return output(
    "line_amounts_correct",
    findings,
    `All ${plural(n, "line amount")} equal quantity × unit rate to the cent.`,
    `${plural(findings.length, "line amount")} of ${n} do not equal quantity × unit rate.`,
  );
}

/** sum(line amounts) == invoice.total, to the cent. */
export function totalMatchesLineItems(input: Pick<CalcInput, "invoice" | "invoicePath">): CalcCheckOutput {
  const { invoice, invoicePath } = input;
  const fmt = (n: number) => fmtMoney(n, invoice.currency);
  const sum = cents(invoice.line_items.reduce((s, li) => s + li.amount, 0));
  const findings: CalcFinding[] = moneyEq(sum, invoice.total)
    ? []
    : [
        {
          line_index: null,
          expected: fmt(sum),
          actual: fmt(invoice.total),
          message: `Line amounts sum to ${fmt(sum)}, but the invoice total is ${fmt(invoice.total)} (difference ${fmt(cents(invoice.total - sum))}).`,
          evidence: totalPointer(invoicePath),
        },
      ];
  return output(
    "total_matches_line_items",
    findings,
    `Invoice total ${fmt(invoice.total)} equals the sum of ${plural(invoice.line_items.length, "line amount")}.`,
    `Invoice total ${fmt(invoice.total)} does not equal the line-item sum ${fmt(sum)}.`,
  );
}

/** Every labor line's unit_rate equals the contract rate-card bill rate for the line's role. */
export function rateMatchesContract(input: Pick<CalcInput, "invoice" | "vendor" | "invoicePath">): CalcCheckOutput {
  const { invoice, vendor } = input;
  const rateCard = vendor.contract.rate_card;
  const findRole = (role: string) =>
    rateCard.find((r) => r.role.trim().toLowerCase() === role.trim().toLowerCase()) ?? null;
  const labor = laborLines(invoice.line_items, vendor);
  const findings: CalcFinding[] = [];
  for (const l of labor) {
    const entry = findRole(l.role);
    if (!entry) {
      findings.push({
        line_index: l.index,
        expected: `a rate-card role (${rateCard.map((r) => r.role).join(", ")})`,
        actual: l.role,
        message: `${lineRef(l.index, l.item)}: role "${l.role}" is not on contract ${vendor.contract.contract_id}'s rate card.`,
        evidence: rateCardPointer(),
      });
    } else if (!moneyEq(entry.bill_rate, l.item.unit_rate)) {
      findings.push({
        line_index: l.index,
        expected: fmtRate(entry.bill_rate),
        actual: fmtRate(l.item.unit_rate),
        message: `${lineRef(l.index, l.item)}: billed at ${fmtRate(l.item.unit_rate)}; contract rate for ${entry.role} is ${fmtRate(entry.bill_rate)}.`,
        evidence: rateCardPointer(entry.role),
      });
    }
  }
  return output(
    "rate_matches_contract",
    findings,
    labor.length === 0
      ? "No labor lines on the invoice, so no rates to compare against the contract."
      : `All ${plural(labor.length, "labor line")} bill the contract rate-card rate for their role.`,
    `${plural(findings.length, "labor line")} do not match the contract rate card.`,
  );
}

/** No two labor lines bill the same employee for the same week. */
export function noDuplicateLines(input: Pick<CalcInput, "invoice" | "vendor" | "invoicePath">): CalcCheckOutput {
  const { invoice, vendor, invoicePath } = input;
  const labor = laborLines(invoice.line_items, vendor);
  const firstSeen = new Map<string, LaborLine>();
  const findings: CalcFinding[] = [];
  for (const l of labor) {
    const who = l.employee ? `id:${l.employee.employee_id}` : `name:${l.name.toLowerCase()}`;
    const key = `${who}|${l.week_ending}`;
    const first = firstSeen.get(key);
    if (!first) {
      firstSeen.set(key, l);
      continue;
    }
    findings.push({
      line_index: l.index,
      expected: `one labor line for ${l.name}, week ending ${l.week_ending}`,
      actual: `duplicate of line ${first.index + 1} (line_items[${first.index}])`,
      message: `${lineRef(l.index, l.item)} bills ${l.name} for week ending ${l.week_ending} again; already billed on line ${first.index + 1} (line_items[${first.index}]).`,
      evidence: linePointer(invoicePath, l.index),
    });
  }
  return output(
    "no_duplicate_lines",
    findings,
    labor.length === 0
      ? "No labor lines on the invoice, so no duplicate employee-weeks."
      : `All ${plural(labor.length, "labor line")} bill distinct employee-weeks.`,
    `${plural(findings.length, "labor line")} bill an employee-week already billed earlier on the invoice.`,
  );
}

/** Every non-labor line exactly matches an allowed charge and is within its cap (if any). */
export function noUnknownCharges(input: Pick<CalcInput, "invoice" | "vendor" | "invoicePath">): CalcCheckOutput {
  const { invoice, vendor } = input;
  const fmt = (n: number) => fmtMoney(n, invoice.currency);
  const allowed = vendor.contract.allowed_charges;
  const findings: CalcFinding[] = [];
  let nonLabor = 0;
  invoice.line_items.forEach((item, i) => {
    if (parseLaborLine(item.description)) return;
    nonLabor++;
    const charge = allowed.find((c) => c.description === item.description);
    if (!charge) {
      findings.push({
        line_index: i,
        expected: `an allowed charge (${allowed.map((c) => c.description).join(", ")})`,
        actual: item.description,
        message: `${lineRef(i, item)} is not a labor line and is not an allowed charge under contract ${vendor.contract.contract_id}.`,
        evidence: allowedChargesPointer(),
      });
    } else if (charge.max_amount !== null && item.amount > charge.max_amount && !moneyEq(item.amount, charge.max_amount)) {
      findings.push({
        line_index: i,
        expected: `≤ ${fmt(charge.max_amount)}`,
        actual: fmt(item.amount),
        message: `${lineRef(i, item)}: ${fmt(item.amount)} exceeds the contract cap of ${fmt(charge.max_amount)}.`,
        evidence: allowedChargesPointer(),
      });
    }
  });
  return output(
    "no_unknown_charges",
    findings,
    nonLabor === 0
      ? "Invoice has only labor lines; no non-labor charges to check."
      : `All ${plural(nonLabor, "non-labor charge")} are allowed by the contract and within their caps.`,
    `${plural(findings.length, "non-labor charge")} are not allowed by the contract or exceed the cap.`,
  );
}

/**
 * EACH labor line's quantity must be ≤ the approved timecard hours for that employee + week.
 * No summing across lines (double billing is no_duplicate_lines' job). A labor line with no
 * approved timecard for that employee-week fails. timecards === null ⇒ unverified.
 */
export function hoursMatchTimecards(input: CalcInput): CalcCheckOutput {
  const { invoice, vendor, timecards, invoicePath } = input;
  const labor = laborLines(invoice.line_items, vendor);
  if (timecards === null) {
    return {
      check: "hours_match_timecards",
      result: "unverified",
      findings: [],
      summary: `Not verified: approved timecard hours for ${plural(labor.length, "labor line")} must be read from the vendor portal, and no portal evidence was provided.`,
    };
  }
  const findings: CalcFinding[] = [];
  for (const l of labor) {
    if (!l.employee) {
      findings.push({
        line_index: l.index,
        expected: "an employee on the vendor roster with an approved timecard",
        actual: `${l.name} (not on roster)`,
        message: `${lineRef(l.index, l.item)}: ${l.name} is not on the vendor roster, so no timecard can be matched.`,
        evidence: linePointer(invoicePath, l.index),
      });
      continue;
    }
    const id = l.employee.employee_id;
    const evidence = timecardPointer(id, l.week_ending);
    const forWeek = timecards.filter((t) => t.employee_id === id && t.week_ending === l.week_ending);
    const approved = forWeek.find((t) => t.status === "approved");
    if (!approved) {
      const other = forWeek[0];
      findings.push({
        line_index: l.index,
        expected: `approved timecard ≥ ${fmtHours(l.item.quantity)}`,
        actual: other ? `timecard ${other.status}, not approved` : "no timecard found",
        message: other
          ? `${lineRef(l.index, l.item)}: ${l.name}'s timecard for week ending ${l.week_ending} is ${other.status}, not approved.`
          : `${lineRef(l.index, l.item)}: no timecard found for ${l.name} (${id}) for week ending ${l.week_ending}.`,
        evidence,
      });
      continue;
    }
    if (l.item.quantity > approved.approved_hours + 1e-9) {
      findings.push({
        line_index: l.index,
        expected: fmtHours(approved.approved_hours),
        actual: fmtHours(l.item.quantity),
        message: `${lineRef(l.index, l.item)}: billed ${fmtHours(l.item.quantity)}, but ${l.name}'s approved timecard for week ending ${l.week_ending} shows ${fmtHours(approved.approved_hours)}.`,
        evidence,
      });
    }
  }
  return output(
    "hours_match_timecards",
    findings,
    labor.length === 0
      ? "No labor lines on the invoice, so no hours to compare against timecards."
      : `All ${plural(labor.length, "labor line")} bill hours at or below the approved timecard hours for that employee-week.`,
    `${plural(findings.length, "labor line")} bill hours not supported by an approved timecard.`,
  );
}
