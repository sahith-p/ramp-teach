/**
 * Receipt post-pass (generic; no workflow or calc imports). Runs on every receipt the engine writes,
 * whatever produced it (real synthesis or deterministic mock):
 *
 *  1. The calc path is authoritative: every calc check appears on the receipt, and a receipt check whose
 *     result contradicts calc's deterministic result is overridden to calc's result (noted in reasons).
 *  2. Every check must carry ONE valid evidence pointer (contracts/evidence.ts) that resolves to something
 *     real: data/ and rules/ files exist; calc:<check> is in calc.json; fixture:/ pages were visited or
 *     read by the scripted path. Any check without valid evidence forces recommendation "review".
 *  3. "approve" is only allowed when every check passes; a failing check floors it at "dispute",
 *     an unverified one at "review".
 *  4. human_decision / decided_by / decided_at are always null — only POST /api/decisions sets them.
 *  5. Money in reasons comes from calc (when the report carries credit_total): every dollar figure in a reason
 *     must be a calc amount (a failing finding's `amount`, or `credit_total`) or, outside a credit claim, a
 *     reference figure (a number in the subject record or in calc's own finding text, e.g. a line amount).
 *     Hourly rates ("$105.00/h") are not credits and are skipped. A figure that fails is replaced with the
 *     calc value when one is unambiguous (the amount of the line(s) the sentence names, else credit_total in a
 *     credit sentence) or annotated "[not a calc amount]"; either way a note is recorded. Finally, when calc
 *     found a credit, some reason must state credit_total: the credit-memo sentence's largest figure is set to
 *     it, or a total line is appended.
 */
import fs from "node:fs";
import path from "node:path";
import { parseEvidencePointer, type CalcReport, type Receipt, type ReceiptCheck } from "@/contracts";

export interface EnforceContext {
  calc: CalcReport;
  /** fixture:/path?query pointers of pages actually visited/read during this run. */
  visitedFixtures: Iterable<string>;
  /** Repo root for data/ and rules/ resolution. */
  repoRoot: string;
  /** Override for tests. */
  fileExists?: (repoRelative: string) => boolean;
  /** Numbers from the subject record (line amounts, rates, totals): figures a reason may quote outside a credit claim. */
  referenceAmounts?: Iterable<number>;
}

export interface EnforceResult {
  receipt: Receipt;
  /** One line per change the post-pass made (also appended to receipt.reasons). */
  notes: string[];
  invalidEvidence: string[];
  overridden: string[];
  /** Dollar figures in reasons that were replaced or flagged (original text, one entry per figure). */
  amountIssues: string[];
}

const normFixture = (p: string) => {
  try {
    return decodeURIComponent(p.trim());
  } catch {
    return p.trim();
  }
};

/** Why a pointer does not resolve, or null when it is valid and resolves. */
export function evidenceProblem(pointer: string, ctx: EnforceContext): string | null {
  const parsed = parseEvidencePointer(pointer);
  if (!parsed) return `"${pointer}" is not a valid evidence pointer`;
  switch (parsed.kind) {
    case "data":
    case "rules": {
      const exists =
        ctx.fileExists?.(parsed.target) ??
        (() => {
          const abs = path.resolve(ctx.repoRoot, parsed.target);
          return abs.startsWith(path.resolve(ctx.repoRoot) + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile();
        })();
      return exists ? null : `${parsed.target} does not exist`;
    }
    case "calc":
      return ctx.calc.checks.some((c) => c.check === parsed.target) ? null : `calc.json has no check ${parsed.target}`;
    case "fixture": {
      const visited = new Set([...ctx.visitedFixtures].map(normFixture));
      return visited.has(normFixture(pointer)) ? null : `fixture page ${parsed.target} was not visited in this run`;
    }
  }
}

/* ------------------------------ money in reasons ----------------------------- */

const MONEY_RE = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?!\d)/g;
const RATE_AFTER = /^\s*(?:\/\s*(?:h|hr|hrs|hour)\b|per\s+hour\b|an\s+hour\b|hourly\b)/i;
const CLAIM_BEFORE = /(credit|impact|over-?bill|overcharg|refund|recover|owed|adjust)/i;
const CREDIT_SENTENCE = /(credit|refund|memo)/i;
const FLAG = " [not a calc amount]";

const toCents = (n: number) => Math.round(n * 100);
const plainUsd = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsd = (c: number) => `$${plainUsd(c)}`;

/** Every finite number in a JSON-like value (for referenceAmounts). */
export function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) numbersIn(v, out);
  return out;
}

interface MoneyFigure {
  index: number;
  length: number;
  cents: number;
  /** An hourly rate ("$105.00/h"), not a credit. */
  rate: boolean;
}

function moneyFigures(text: string): MoneyFigure[] {
  const out: MoneyFigure[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const end = m.index + m[0].length;
    out.push({ index: m.index, length: m[0].length, cents: toCents(Number(m[1].replace(/,/g, ""))), rate: RATE_AFTER.test(text.slice(end)) });
  }
  return out;
}

/** 1-based line numbers a sentence names ("Line 5 duplicates line 3" → [5, 3]). */
function lineRefs(text: string): number[] {
  return [...new Set([...text.matchAll(/\blines?\s+(\d+)\b/gi)].map((m) => Number(m[1])))];
}

export interface AmountCheckResult {
  reasons: string[];
  notes: string[];
  /** The original text of every figure that was replaced or flagged. */
  issues: string[];
}

/** Rule 5: check every dollar figure in the reasons against calc's amounts (see the header). */
export function enforceAmounts(reasons: string[], calc: CalcReport, referenceAmounts: Iterable<number> = []): AmountCheckResult {
  if (calc.credit_total === undefined) return { reasons: [...reasons], notes: [], issues: [] };
  const total = toCents(calc.credit_total);
  const credits = new Set<number>([total]);
  const byLine = new Map<number, Set<number>>(); // 1-based line → finding amounts (cents)
  const refs = new Set<number>([...referenceAmounts].map(toCents));
  let anyFail = false;
  for (const c of calc.checks) {
    for (const fig of moneyFigures(c.summary)) refs.add(fig.cents);
    for (const f of c.findings) {
      for (const t of [f.expected, f.actual, f.message]) for (const fig of moneyFigures(t)) refs.add(fig.cents);
      if (c.result !== "fail" || f.amount === undefined) continue;
      anyFail = true;
      credits.add(toCents(f.amount));
      if (f.line_index !== null && f.amount > 0) {
        const set = byLine.get(f.line_index + 1) ?? new Set<number>();
        set.add(toCents(f.amount));
        byLine.set(f.line_index + 1, set);
      }
    }
  }

  const notes: string[] = [];
  const issues: string[] = [];
  const out = reasons.map((reason, ri) => {
    let result = "";
    let last = 0;
    for (const fig of moneyFigures(reason)) {
      result += reason.slice(last, fig.index);
      last = fig.index + fig.length;
      const original = reason.slice(fig.index, last);
      const flagged = reason.slice(last).startsWith(FLAG);
      const claim = CLAIM_BEFORE.test(reason.slice(Math.max(0, fig.index - 60), fig.index));
      if (fig.rate || flagged || credits.has(fig.cents) || (!claim && refs.has(fig.cents))) {
        result += original;
        continue;
      }
      issues.push(original);
      const lineAmounts = new Set(lineRefs(reason).flatMap((n) => [...(byLine.get(n) ?? [])]));
      const fromLine = lineAmounts.size === 1 ? [...lineAmounts][0] : null;
      const candidate = fromLine ?? (CREDIT_SENTENCE.test(reason) && total > 0 ? total : null);
      if (candidate !== null) {
        result += fmtUsd(candidate);
        notes.push(
          `Amount check: reason ${ri + 1} stated ${plainUsd(fig.cents)}, which is not an amount computed by calc; ` +
            `replaced with ${fmtUsd(candidate)} (${fromLine !== null ? "calc finding amount" : "calc credit_total"}).`,
        );
      } else {
        result += original + FLAG;
        notes.push(`Amount check: reason ${ri + 1} states ${plainUsd(fig.cents)}, which is not an amount computed by calc; flagged for the approver.`);
      }
    }
    return result + reason.slice(last);
  });

  // When calc found a credit, some reason must state credit_total exactly.
  if (anyFail && total > 0 && !out.some((r) => moneyFigures(r).some((f) => !f.rate && f.cents === total))) {
    let idx = -1;
    for (let i = out.length - 1; i >= 0 && idx < 0; i--) {
      if (/credit/i.test(out[i]) && /(memo|total|request)/i.test(out[i]) && moneyFigures(out[i]).some((f) => !f.rate)) idx = i;
    }
    if (idx >= 0) {
      const big = moneyFigures(out[idx])
        .filter((f) => !f.rate)
        .reduce((a, b) => (b.cents > a.cents ? b : a));
      issues.push(out[idx].slice(big.index, big.index + big.length));
      out[idx] = out[idx].slice(0, big.index) + fmtUsd(total) + out[idx].slice(big.index + big.length);
      notes.push(`Amount check: the credit-memo sentence (reason ${idx + 1}) stated ${plainUsd(big.cents)}; set to calc credit_total ${fmtUsd(total)}.`);
    } else {
      out.push(`Total credit to request (computed by calc): ${fmtUsd(total)}.`);
      notes.push(`Amount check: no reason stated calc credit_total ${fmtUsd(total)}; total credit line added.`);
    }
  }
  return { reasons: out, notes, issues };
}

export function enforceReceipt(input: Receipt, ctx: EnforceContext): EnforceResult {
  const notes: string[] = [];
  const invalidEvidence: string[] = [];
  const overridden: string[] = [];
  const byName = new Map<string, ReceiptCheck>();
  for (const c of input.checks) if (!byName.has(c.name)) byName.set(c.name, { ...c });

  const checks: ReceiptCheck[] = [];
  for (const cc of ctx.calc.checks) {
    const existing = byName.get(cc.check);
    if (!existing) {
      const f = cc.findings[0];
      checks.push({
        name: cc.check,
        expected: f?.expected ?? "",
        actual: f?.actual ?? cc.summary,
        result: cc.result,
        evidence: `calc:${cc.check}`,
      });
      notes.push(`Check ${cc.check} was missing from the synthesized receipt; added from the deterministic calc (${cc.result}).`);
      overridden.push(cc.check);
    } else {
      if (existing.result !== cc.result) {
        notes.push(
          `Check ${cc.check}: receipt said "${existing.result}" but the deterministic calc says "${cc.result}"; calc result used (calc is authoritative).`,
        );
        overridden.push(cc.check);
        existing.result = cc.result;
      }
      checks.push(existing);
    }
    byName.delete(cc.check);
  }
  checks.push(...byName.values()); // checks calc does not know about (kept; still need evidence)

  for (const c of checks) {
    const problem = evidenceProblem(c.evidence, ctx);
    if (problem) {
      invalidEvidence.push(c.name);
      notes.push(`Check ${c.name} has no valid evidence (${problem}); recommendation forced to review.`);
    }
  }

  const anyFail = checks.some((c) => c.result === "fail");
  const anyUnverified = checks.some((c) => c.result === "unverified");
  let recommendation = input.recommendation;
  if (invalidEvidence.length > 0) {
    recommendation = "review";
  } else if (recommendation === "approve" && (anyFail || anyUnverified)) {
    recommendation = anyFail ? "dispute" : "review";
    notes.push(`Recommendation "approve" is not allowed with ${anyFail ? "failing" : "unverified"} checks; changed to ${recommendation}.`);
  }
  if (recommendation !== input.recommendation && invalidEvidence.length > 0) {
    notes.push(`Recommendation changed from ${input.recommendation} to review.`);
  }

  const amounts = enforceAmounts(input.reasons, ctx.calc, ctx.referenceAmounts ?? []);
  notes.push(...amounts.notes);

  const receipt: Receipt = {
    ...input,
    checks,
    recommendation,
    reasons: [...amounts.reasons, ...notes],
    human_decision: null,
    decided_by: null,
    decided_at: null,
  };
  return { receipt, notes, invalidEvidence, overridden, amountIssues: amounts.issues };
}
