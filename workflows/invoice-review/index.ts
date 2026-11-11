/**
 * Invoice review — the first workflow on the Ramp Teach engine (WorkflowDefinition, contracts/engine.ts).
 *
 * Subject: one vendor invoice (+ the vendor profile). Evidence: approved timecard hours read off the
 * fixture vendor portal (docs/lane-spec.md §2). This module never reads data/timecards.json or
 * data/answer_key.json: hours come from portal pages (real browser loop or scripted Playwright steps).
 */
import {
  billIdFor,
  type AgentEvidenceFact,
  type BrowserDriver,
  type CalcCheckOutput,
  type CalcReport,
  type EvidenceBundle,
  type EvidenceItem,
  type EvidenceTask,
  type Invoice,
  type Receipt,
  type ReceiptCheck,
  type Recording,
  type RunContext,
  type Timecard,
  type VendorProfile,
  type WorkflowDefinition,
  type WorkflowSpec,
} from "@/contracts";
import { invoicePathFor, loadInvoice, loadVendor } from "@/lib/data";
import { fmtMoney } from "@/lib/money";
import { laborLines, runCalc } from "@/calc";
import { parseDataFields } from "@/agent/browser/outline";
import { signInToPortal } from "@/agent/browser/sign-in";
import { fixturePointerFor } from "@/agent/browser/url-policy";
import * as learnModule from "./learn";

export interface InvoiceSubject {
  invoice: Invoice;
  vendor: VendorProfile;
  /** Repo-relative, e.g. data/invoices/new/HSG-1011.json */
  invoicePath: string;
}

/* ---------------------------------- learn ---------------------------------- */

type LearnBlock = WorkflowDefinition["learn"];
// learn.ts is owned by the learn lane (T-20). After it merges it exports `invoiceReviewLearn`; until then
// only `deterministicDistill` exists. Read both defensively so this compiles and runs either way.
const learnExports = learnModule as unknown as {
  invoiceReviewLearn?: LearnBlock;
  deterministicDistill?: (r: Recording) => WorkflowSpec;
};
export const invoiceReviewLearnBlock: LearnBlock = learnExports.invoiceReviewLearn ?? {
  recordingPath: "data/recording.sample.json",
  specPath: "rules/workflow_spec.json",
  distillHints:
    "AP specialist verifying a staffing vendor's weekly service invoice against the contract rate card, allowed charges, " +
    "and approved timecards in the vendor's timecard portal.",
  deterministicDistill: (r: Recording) => {
    if (!learnExports.deterministicDistill) throw new Error("learn lane exports no deterministic distiller");
    return learnExports.deterministicDistill(r);
  },
};

/* ------------------------------ evidence plan ------------------------------ */

export const PORTAL_LOGIN_PATH = "/portal/login";
export const timecardPath = (employeeId: string, week: string) =>
  `/portal/employees/${encodeURIComponent(employeeId)}?week=${week}`;
export const invoicePagePath = (invoiceId: string) => `/portal/invoices/${encodeURIComponent(invoiceId)}`;

/** Unique roster employee-weeks billed on the invoice (in line order). */
function employeeWeeks(s: InvoiceSubject): Array<{ employee_id: string; name: string; week_ending: string }> {
  const seen = new Set<string>();
  const out: Array<{ employee_id: string; name: string; week_ending: string }> = [];
  for (const l of laborLines(s.invoice.line_items, s.vendor)) {
    if (!l.employee) continue; // not on roster: calc fails it; nothing to look up
    const k = `${l.employee.employee_id}|${l.week_ending}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ employee_id: l.employee.employee_id, name: l.employee.name, week_ending: l.week_ending });
  }
  return out;
}

const TIMECARD_STATUSES = new Set(["approved", "pending", "rejected"]);

/* ------------------------------ mock receipt ------------------------------- */

const RULE_TEXT: Record<string, string> = {
  line_amounts_correct: "Every line amount = quantity × unit rate",
  total_matches_line_items: "Invoice total = sum of line amounts",
  rate_matches_contract: "Every labor line bills the contract rate-card rate for its role",
  no_duplicate_lines: "At most one labor line per employee per week",
  no_unknown_charges: "Non-labor charges are on the contract's allowed list and under the cap",
  hours_match_timecards: "Billed hours ≤ approved timecard hours for that employee-week",
};

function lineLabel(i: number | null): string {
  return i === null ? "Invoice" : `Line ${i + 1}`;
}

function mockCheck(c: CalcCheckOutput): ReceiptCheck {
  const rule = RULE_TEXT[c.check] ?? c.check;
  if (c.result === "fail" && c.findings.length > 0) {
    return {
      name: c.check,
      expected: c.findings.map((f) => `${lineLabel(f.line_index)}: ${f.expected}`).join("; "),
      actual: c.findings.map((f) => `${lineLabel(f.line_index)}: ${f.actual}`).join("; "),
      result: "fail",
      evidence: c.findings[0].evidence,
    };
  }
  return { name: c.check, expected: rule, actual: c.summary, result: c.result, evidence: `calc:${c.check}` };
}

export function invoiceMockReceipt(s: InvoiceSubject, calc: CalcReport, _evidence: EvidenceBundle | null, spec: WorkflowSpec): Receipt {
  const checks = calc.checks.map(mockCheck);
  const failing = calc.checks.filter((c) => c.result === "fail");
  const unverified = calc.checks.filter((c) => c.result === "unverified");
  const reasons: string[] = [];
  const money = (n: number) => fmtMoney(n, s.invoice.currency);
  // Dollar amounts come from calc (finding.amount, credit_total): this mapper copies them, never computes them.
  for (const c of failing) {
    for (const f of c.findings) {
      reasons.push(`${f.message}${f.amount !== undefined && f.amount > 0 ? ` Impact: ${money(f.amount)}.` : ""}`);
    }
  }
  if (failing.length > 0) {
    reasons.push(
      calc.credit_total !== undefined && calc.credit_total > 0
        ? `Dispute and request a credit memo for ${money(calc.credit_total)}.`
        : "Dispute the failing checks with the vendor (calc found no overbilled amount to credit).",
    );
  }
  for (const c of unverified) reasons.push(`${c.check} not verified: ${c.summary}`);
  if (failing.length === 0 && unverified.length === 0) reasons.push("All checks pass against the contract and the approved timecards.");
  for (const q of spec.open_questions.slice(0, 2)) reasons.push(`Open question from the recorded review session: ${q}`);
  return {
    invoice_id: s.invoice.invoice_id,
    vendor: s.invoice.vendor,
    checks,
    recommendation: failing.length > 0 ? "dispute" : unverified.length > 0 ? "review" : "approve",
    reasons,
    mode: "mock",
    human_decision: null,
    decided_by: null,
    decided_at: null,
  };
}

/* ------------------------- agent facts → evidence -------------------------- */

/** True when `source` is the timecard page for this employee-week. */
function isTimecardSource(source: string, employeeId: string, week: string): boolean {
  if (!source.startsWith("fixture:/")) return false;
  const u = new URL(source.slice("fixture:".length), "http://localhost");
  return decodeURIComponent(u.pathname) === `/portal/employees/${employeeId}` && u.searchParams.get("week") === week;
}

export function collectInvoiceAgentEvidence(s: InvoiceSubject, facts: AgentEvidenceFact[], ctx: RunContext): EvidenceBundle {
  const now = new Date().toISOString();
  const items: EvidenceItem[] = [];
  const timecards: Timecard[] = [];
  for (const ew of employeeWeeks(s)) {
    const forEw = facts.filter((f) => f.subject_ref.employee_id === ew.employee_id && f.subject_ref.week_ending === ew.week_ending);
    const valid = forEw.filter((f) => isTimecardSource(f.source, ew.employee_id, ew.week_ending));
    for (const f of forEw.filter((x) => !valid.includes(x))) {
      ctx.trace("agent.fact.rejected", "real", "evidence", { reason: "source is not this employee-week's timecard page", fact: f });
    }
    const get = (k: string) => valid.find((f) => f.key === k);
    const hoursFact = get("approved_hours");
    if (!hoursFact) continue;
    const hours = typeof hoursFact.value === "number" ? hoursFact.value : Number(String(hoursFact.value).trim());
    if (!Number.isFinite(hours)) {
      ctx.trace("agent.fact.rejected", "real", "evidence", { reason: "approved_hours is not a number", fact: hoursFact });
      continue;
    }
    items.push({
      source: hoursFact.source,
      kind: "timecard_hours",
      employee_id: ew.employee_id,
      week_ending: ew.week_ending,
      value: hours,
      screenshot: (hoursFact as AgentEvidenceFact & { screenshot?: string | null }).screenshot ?? null,
      captured_at: now,
      mode: "real",
    });
    const status = String(get("status")?.value ?? "").trim().toLowerCase();
    if (!TIMECARD_STATUSES.has(status)) continue; // incomplete: the engine falls back to scripted for this task
    timecards.push({
      employee_id: ew.employee_id,
      week_ending: ew.week_ending,
      approved_hours: hours,
      approved_by: String(get("approved_by")?.value ?? "(not recorded)"),
      status: status as Timecard["status"],
    });
  }
  return { invoice_id: s.invoice.invoice_id, mode: "real", items, timecards };
}

/* ------------------------- scripted Playwright steps ----------------------- */

/** The vendor portal's id in the credential vault (lib/vault.ts). */
export const PORTAL_ID = "halcyon";

/** Sign in from the credential vault (same harness routine as the browser loop's sign_in tool). */
async function scriptedLogin(driver: BrowserDriver, baseUrl: string, ctx: RunContext): Promise<void> {
  const r = await signInToPortal(driver, { baseUrl, portal: PORTAL_ID });
  if (!r.ok) throw new Error(`scripted login: ${r.error}`);
  // Portal + username only: the password never reaches the trace.
  ctx.trace("scripted.login", "scripted", "evidence", {
    portal: r.portal,
    username: r.username,
    credential_source: r.source,
    landed: r.landed,
    already_signed_in: r.alreadySignedIn,
  });
}

export async function invoiceScriptedEvidence(
  s: InvoiceSubject,
  tasks: EvidenceTask[],
  driver: BrowserDriver,
  ctx: RunContext,
): Promise<EvidenceBundle> {
  const base = ctx.baseUrl.replace(/\/+$/, "");
  const items: EvidenceItem[] = [];
  const timecards: Timecard[] = [];
  await scriptedLogin(driver, base, ctx);

  await driver.navigate(`${base}${invoicePagePath(s.invoice.invoice_id)}`);
  const invShot = await driver.screenshot().catch(() => ({ savedPath: null }));
  items.push({
    source: fixturePointerFor(await driver.currentUrl()) ?? `fixture:${invoicePagePath(s.invoice.invoice_id)}`,
    kind: "invoice_view",
    employee_id: null,
    week_ending: null,
    value: s.invoice.invoice_id,
    screenshot: invShot.savedPath,
    captured_at: new Date().toISOString(),
    mode: "scripted",
  });

  for (const task of tasks) {
    const employeeId = task.subject_ref.employee_id;
    const week = task.subject_ref.week_ending;
    if (!employeeId || !week) continue;
    await driver.navigate(`${base}${timecardPath(employeeId, week)}`);
    const url = await driver.currentUrl();
    if (new URL(url).pathname === PORTAL_LOGIN_PATH) throw new Error("scripted evidence: portal session lost (redirected to sign-in)");
    const fields = parseDataFields(await driver.readPage({ filter: "all" }));
    const shot = await driver.screenshot().catch(() => ({ savedPath: null }));
    const source = fixturePointerFor(url) ?? `fixture:${timecardPath(employeeId, week)}`;
    const hours = fields.approved_hours !== undefined ? Number(fields.approved_hours) : null;
    const found = hours !== null && Number.isFinite(hours);
    items.push({
      source,
      kind: "timecard_hours",
      employee_id: employeeId,
      week_ending: week,
      value: found ? hours : null,
      screenshot: shot.savedPath,
      captured_at: new Date().toISOString(),
      mode: "scripted",
    });
    const status = (fields.status ?? "").trim().toLowerCase();
    if (found && TIMECARD_STATUSES.has(status)) {
      timecards.push({
        employee_id: employeeId,
        week_ending: week,
        approved_hours: hours!,
        approved_by: fields.approved_by ?? "(not shown)",
        status: status as Timecard["status"],
      });
    }
    ctx.trace("scripted.timecard", "scripted", "evidence", { source, approved_hours: found ? hours : null, status: status || null });
  }
  return { invoice_id: s.invoice.invoice_id, mode: "scripted", items, timecards };
}

/* ------------------------------- definition -------------------------------- */

export const INVOICE_SYNTHESIS_INSTRUCTIONS = [
  "Workflow: review a staffing vendor's weekly service invoice against its contract (rate card, allowed non-labor charges)",
  "and the vendor portal's approved timecards, then recommend approve / dispute / review to a human AP approver.",
  "- Report the six checks in the given order, copying each result from the calc report exactly.",
  "- expected/actual: concrete values (money as $1,234.00, rates as 95.00/h, hours as 38 h) and the line they come from (Line N, 1-based).",
  "- Evidence: for a failing check cite its specific finding pointer (rate card entry, invoice line, or the fixture:/portal/employees/… timecard page);",
  "  for a passing or unverified check cite calc:<check>.",
  "- Recommendation: dispute if any check fails (ask for a credit memo); review if any check is unverified; approve only if every check passes.",
  "- Dollar amounts are computed by code: each failing finding in the calc report carries `amount` (overbilled dollars) and the report",
  "  carries `credit_total`. COPY them; never compute, round, re-derive or sum amounts yourself, and state no other credit figure.",
  "- Reasons: one short sentence per failing finding citing its line and its `amount` (as $1,234.00), then one sentence requesting a",
  "  credit memo for exactly `credit_total` (skip it if credit_total is 0), then at most one relevant open question from the learned spec",
  "  (omit it if the spec has none).",
].join("\n");

export const invoiceReviewWorkflow: WorkflowDefinition<InvoiceSubject> = {
  id: "invoice-review",
  title: "Service invoice review",

  loadSubject(subjectId) {
    const invoice = loadInvoice(subjectId);
    if (!invoice) throw new Error(`Unknown invoice ${subjectId} (looked in data/invoices/new and data/invoices/past)`);
    const invoicePath = invoicePathFor(subjectId);
    if (!invoicePath) throw new Error(`No invoice file for ${subjectId}`);
    return { invoice, vendor: loadVendor(), invoicePath };
  },

  summarize(s) {
    return {
      subject_id: s.invoice.invoice_id,
      vendor: s.invoice.vendor,
      amount: s.invoice.total,
      currency: s.invoice.currency,
      label: `${s.invoice.vendor} invoice ${s.invoice.invoice_id} (${fmtMoney(s.invoice.total, s.invoice.currency)})`,
    };
  },

  learn: invoiceReviewLearnBlock,

  deterministicChecks(s, evidence) {
    // Feed calc timecards only when the evidence covers every billed employee-week; otherwise the hours
    // check is honestly "unverified" (a page we never read is not "no timecard found").
    let timecards: Timecard[] | null = null;
    if (evidence) {
      const covered = new Set(
        evidence.items.filter((i) => i.kind === "timecard_hours").map((i) => `${i.employee_id}|${i.week_ending}`),
      );
      const all = employeeWeeks(s).every((ew) => covered.has(`${ew.employee_id}|${ew.week_ending}`));
      timecards = all ? evidence.timecards : null;
    }
    return runCalc({ invoice: s.invoice, vendor: s.vendor, timecards, invoicePath: s.invoicePath });
  },

  evidencePlan(s, _spec) {
    const id = s.invoice.invoice_id;
    return employeeWeeks(s).map((ew) => ({
      task_id: `timecard:${ew.employee_id}:${ew.week_ending}`,
      instruction:
        `Open the approved timecard for ${ew.name} (${ew.employee_id}), week ending ${ew.week_ending} — reach it via the ` +
        `"View timecard" link on invoice ${id}'s page (${invoicePagePath(id)}) in the vendor portal. Record approved_hours (a number) ` +
        `and status as shown on the timecard page; also record approved_by if shown.`,
      start_path: PORTAL_LOGIN_PATH,
      expected_keys: ["approved_hours", "status"],
      subject_ref: { employee_id: ew.employee_id, week_ending: ew.week_ending },
    }));
  },

  collectAgentEvidence: collectInvoiceAgentEvidence,
  scriptedEvidence: invoiceScriptedEvidence,
  synthesisInstructions: INVOICE_SYNTHESIS_INSTRUCTIONS,
  mockReceipt: invoiceMockReceipt,
  approvalTargetId: (subjectId) => billIdFor(subjectId),
};

export default invoiceReviewWorkflow;
