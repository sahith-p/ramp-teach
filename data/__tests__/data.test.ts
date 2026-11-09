/**
 * Data-lane self-check (T-10). Validates every seed file against the frozen contracts and
 * recomputes, with an inline checker (deliberately NOT importing calc/), that:
 *  - HSG-1011 has exactly the 3 planted errors in data/answer_key.json and nothing else fails;
 *  - each past invoice fails exactly the checks its corrections list (and clean ones fail nothing).
 * The answer key is read here because this is a test (allowed by CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AnswerKeySchema,
  BillSchema,
  CHECK_NAMES,
  InvoiceSchema,
  LABOR_LINE_REGEX,
  RecordingSchema,
  billIdFor,
  type CheckName,
  type Invoice,
  type Timecard,
  type VendorProfile,
} from "@/contracts";
import { P } from "@/lib/paths";
import {
  invoicePathFor,
  loadBillsSeed,
  loadCorrections,
  loadNewInvoices,
  loadPastInvoices,
  loadTimecards,
  loadVendor,
} from "@/lib/data";
import { cents, moneyEq } from "@/lib/money";

const readJson = (f: string): unknown => JSON.parse(fs.readFileSync(f, "utf8"));

type Failure = { check: CheckName; line_index: number | null };

/** Inline re-implementation of the six checks (calc/ is another lane's). */
function findFailures(inv: Invoice, vendor: VendorProfile, timecards: Timecard[]): Failure[] {
  const out: Failure[] = [];
  const rates = new Map(vendor.contract.rate_card.map((r) => [r.role, r.bill_rate]));
  const allowed = new Map(vendor.contract.allowed_charges.map((a) => [a.description, a.max_amount]));
  const seen = new Set<string>();
  inv.line_items.forEach((l, i) => {
    if (!moneyEq(cents(l.quantity * l.unit_rate), l.amount))
      out.push({ check: "line_amounts_correct", line_index: i });
  });
  const sum = cents(inv.line_items.reduce((s, l) => s + l.amount, 0));
  if (!moneyEq(sum, inv.total)) out.push({ check: "total_matches_line_items", line_index: null });
  inv.line_items.forEach((l, i) => {
    const m = LABOR_LINE_REGEX.exec(l.description);
    if (!m) return;
    const [, , role] = m;
    if (rates.get(role) === undefined || !moneyEq(rates.get(role)!, l.unit_rate))
      out.push({ check: "rate_matches_contract", line_index: i });
  });
  inv.line_items.forEach((l, i) => {
    const m = LABOR_LINE_REGEX.exec(l.description);
    if (!m) return;
    const key = `${m[1]}|${m[3]}`;
    if (seen.has(key)) out.push({ check: "no_duplicate_lines", line_index: i });
    seen.add(key);
  });
  inv.line_items.forEach((l, i) => {
    if (LABOR_LINE_REGEX.test(l.description)) return;
    const cap = allowed.get(l.description);
    // Unknown description, or an allowed charge over its cap (cap applied to the line amount).
    if (cap === undefined || (cap !== null && l.amount > cap + 1e-9))
      out.push({ check: "no_unknown_charges", line_index: i });
  });
  inv.line_items.forEach((l, i) => {
    const m = LABOR_LINE_REGEX.exec(l.description);
    if (!m) return;
    const emp = vendor.employees.find((e) => e.name === m[1]);
    const tc = emp && timecards.find((t) => t.employee_id === emp.employee_id && t.week_ending === m[3]);
    if (!tc || tc.status !== "approved" || l.quantity > tc.approved_hours)
      out.push({ check: "hours_match_timecards", line_index: i });
  });
  const order = (c: CheckName) => CHECK_NAMES.indexOf(c);
  return out.sort((a, b) => order(a.check) - order(b.check) || (a.line_index ?? -1) - (b.line_index ?? -1));
}

const sortF = (fs_: Failure[]) =>
  [...fs_].sort(
    (a, b) =>
      CHECK_NAMES.indexOf(a.check) - CHECK_NAMES.indexOf(b.check) || (a.line_index ?? -1) - (b.line_index ?? -1),
  );

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const vendor = loadVendor();
const timecards = loadTimecards();
const corrections = loadCorrections();
const past = loadPastInvoices();
const fresh = loadNewInvoices();
const all = [...past, ...fresh];

describe("data: schemas and the synthetic world", () => {
  it("vendor matches lane-spec §1", () => {
    expect(vendor.vendor).toBe("Halcyon Staffing Group");
    expect(vendor.vendor_id).toBe("V-HSG");
    expect(vendor.contract).toMatchObject({
      contract_id: "C-HSG-2026",
      effective_from: "2026-01-01",
      effective_to: "2026-12-31",
      currency: "USD",
      payment_terms_days: 30,
    });
    expect(Object.fromEntries(vendor.contract.rate_card.map((r) => [r.role, r.bill_rate]))).toEqual({
      "Senior Recruiter": 95,
      "Recruiting Coordinator": 62,
      Sourcer: 70,
      "Data Analyst": 88,
    });
    expect(vendor.contract.allowed_charges).toEqual([
      { description: "Background check fee", max_amount: 120 },
      { description: "Job board posting", max_amount: 400 },
    ]);
    expect(vendor.employees.map((e) => `${e.employee_id} ${e.name} (${e.role})`)).toEqual([
      "E-101 Maya Chen (Senior Recruiter)",
      "E-102 Jordan Alvarez (Recruiting Coordinator)",
      "E-103 Priya Natarajan (Sourcer)",
      "E-104 Sam Okafor (Data Analyst)",
      "E-105 Elena Rossi (Recruiting Coordinator)",
    ]);
  });

  it("has HSG-1001..1010 past and HSG-1011 new, with weekly dates", () => {
    expect(past.map((i) => i.invoice_id)).toEqual(
      Array.from({ length: 10 }, (_, k) => `HSG-${1001 + k}`),
    );
    expect(fresh.map((i) => i.invoice_id)).toEqual(["HSG-1011"]);
    all.forEach((inv, k) => {
      const week = addDays("2026-08-09", 7 * k);
      expect(new Date(`${week}T00:00:00Z`).getUTCDay()).toBe(0); // Sunday
      expect(inv.issue_date).toBe(addDays(week, 1));
      expect(inv.due_date).toBe(addDays(inv.issue_date, 30));
      expect(inv.vendor).toBe(vendor.vendor);
      expect(inv.currency).toBe("USD");
      for (const l of inv.line_items) {
        const m = LABOR_LINE_REGEX.exec(l.description);
        if (!m) continue;
        expect(m[3]).toBe(week);
        const emp = vendor.employees.find((e) => e.name === m[1]);
        expect(emp, l.description).toBeDefined();
        expect(m[2]).toBe(emp!.role);
      }
      const labor = inv.line_items.filter((l) => LABOR_LINE_REGEX.test(l.description));
      expect(labor.length).toBeGreaterThanOrEqual(3);
      expect(labor.length).toBeLessThanOrEqual(5);
      expect(invoicePathFor(inv.invoice_id)).toBe(
        `data/invoices/${inv.invoice_id === "HSG-1011" ? "new" : "past"}/${inv.invoice_id}.json`,
      );
      // money is to the cent
      for (const n of [inv.total, ...inv.line_items.flatMap((l) => [l.amount, l.unit_rate])])
        expect(cents(n)).toBe(n);
    });
  });

  it("raw invoice files parse with InvoiceSchema", () => {
    for (const dir of [P.pastInvoices, P.newInvoices])
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")))
        expect(() => InvoiceSchema.parse(readJson(path.join(dir, f)))).not.toThrow();
  });

  it("timecards: exactly one approved timecard per billed (employee, week)", () => {
    const keys = timecards.map((t) => `${t.employee_id}|${t.week_ending}`);
    expect(new Set(keys).size).toBe(keys.length);
    const billed = new Set<string>();
    for (const inv of all)
      for (const l of inv.line_items) {
        const m = LABOR_LINE_REGEX.exec(l.description);
        if (!m) continue;
        const emp = vendor.employees.find((e) => e.name === m[1])!;
        billed.add(`${emp.employee_id}|${m[3]}`);
      }
    expect(new Set(keys)).toEqual(billed);
    for (const t of timecards) expect(t.status).toBe("approved");
    const sam = timecards.find((t) => t.employee_id === "E-104" && t.week_ending === "2026-10-18");
    expect(sam?.approved_hours).toBe(38);
  });

  it("bills: one per invoice with the right status and amount", () => {
    const bills = loadBillsSeed();
    expect(() => bills.forEach((b) => BillSchema.parse(b))).not.toThrow();
    const corrected = new Set(corrections.map((c) => c.invoice_id));
    expect(bills.map((b) => b.bill_id)).toEqual(all.map((i) => billIdFor(i.invoice_id)));
    for (const inv of all) {
      const b = bills.find((x) => x.bill_id === billIdFor(inv.invoice_id))!;
      expect(b.amount).toBe(inv.total);
      expect(b.vendor).toBe(vendor.vendor);
      expect(b.receipt_id).toBeNull();
      const want = inv.invoice_id === "HSG-1011" ? "pending" : corrected.has(inv.invoice_id) ? "disputed" : "approved";
      expect(b.status).toBe(want);
    }
  });
});

describe("data: planted errors", () => {
  it("HSG-1011 has exactly the 3 answer-key errors and nothing else", () => {
    const key = AnswerKeySchema.parse(readJson(P.answerKey));
    expect(key.invoice_id).toBe("HSG-1011");
    expect(key.expected_recommendation).toBe("dispute");
    expect(key.planted_errors.map((e) => e.check).sort()).toEqual(
      ["hours_match_timecards", "no_duplicate_lines", "rate_matches_contract"],
    );
    const inv = fresh[0];
    const got = findFailures(inv, vendor, timecards);
    expect(got).toEqual(sortF(key.planted_errors.map((e) => ({ check: e.check, line_index: e.line_index }))));
    const desc = (i: number) => inv.line_items[i].description;
    const at = (c: CheckName) => key.planted_errors.find((e) => e.check === c)!.line_index!;
    expect(desc(at("rate_matches_contract"))).toContain("Maya Chen");
    expect(inv.line_items[at("rate_matches_contract")].unit_rate).toBe(105);
    expect(desc(at("no_duplicate_lines"))).toContain("Priya Natarajan");
    expect(desc(at("hours_match_timecards"))).toContain("Sam Okafor");
    expect(inv.line_items[at("hours_match_timecards")].quantity).toBe(44);
  });

  it("corrections cover all six checks, one invoice each, 6-8 total", () => {
    expect(corrections.length).toBeGreaterThanOrEqual(6);
    expect(corrections.length).toBeLessThanOrEqual(8);
    expect(new Set(corrections.map((c) => c.check))).toEqual(new Set(CHECK_NAMES));
    const ids = corrections.map((c) => c.invoice_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of corrections) {
      expect(past.some((p) => p.invoice_id === c.invoice_id)).toBe(true);
      expect(c.line_index === null).toBe(c.check === "total_matches_line_items");
    }
    const rush = corrections.find((c) => c.check === "no_unknown_charges")!;
    const rushInv = past.find((p) => p.invoice_id === rush.invoice_id)!;
    expect(rushInv.line_items[rush.line_index!].description).toBe("Rush fee");
  });

  it("each past invoice fails exactly the checks its corrections list", () => {
    for (const inv of past) {
      const want = sortF(
        corrections
          .filter((c) => c.invoice_id === inv.invoice_id)
          .map((c) => ({ check: c.check, line_index: c.line_index })),
      );
      expect({ id: inv.invoice_id, f: findFailures(inv, vendor, timecards) }).toEqual({
        id: inv.invoice_id,
        f: want,
      });
    }
  });
});

describe("data: sample recording", () => {
  const rec = RecordingSchema.parse(readJson(P.recordingSample));
  const base = "http://localhost:3000";

  it("is a 30-50 step session with increasing timestamps and matching transcript", () => {
    expect(rec.steps.length).toBeGreaterThanOrEqual(30);
    expect(rec.steps.length).toBeLessThanOrEqual(50);
    const ts = rec.steps.map((s) => Date.parse(s.ts));
    ts.forEach((t) => expect(Number.isNaN(t)).toBe(false));
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    expect(Date.parse(rec.started_at)).toBeLessThanOrEqual(ts[0]);
    expect(rec.transcript).toEqual(rec.steps.filter((s) => s.kind === "narration").map((s) => s.detail.text));
  });

  it("uses the exact fixture routes and redacts the password", () => {
    const urls = rec.steps.map((s) => s.detail.url ?? "");
    for (const u of [
      `${base}/portal/login`,
      `${base}/portal/invoices`,
      `${base}/portal/invoices/HSG-1010`,
      ...["E-101", "E-102", "E-103", "E-104"].map((e) => `${base}/portal/employees/${e}?week=2026-10-11`),
    ])
      expect(urls).toContain(u);
    for (const s of rec.steps.filter((x) => x.kind === "dom"))
      expect(s.detail.url?.startsWith(`${base}/`), JSON.stringify(s)).toBe(true);
    const pw = rec.steps.filter((s) => s.detail.selector === "input[name=password]" && s.detail.event === "input");
    expect(pw.length).toBe(1);
    expect(pw[0].detail.value).toBe("[redacted]");
    expect(JSON.stringify(rec)).not.toContain("demo-only");
    expect(rec.steps.some((s) => s.detail.event === "submit" && s.detail.action === `${base}/api/portal/login`)).toBe(true);
    expect(rec.steps.some((s) => s.detail.selector === 'a[href="/portal/employees/E-101?week=2026-10-11"]')).toBe(true);
    // Every billed employee on HSG-1010 has their timecard opened.
    const inv = past.find((p) => p.invoice_id === "HSG-1010")!;
    for (const l of inv.line_items) {
      const m = LABOR_LINE_REGEX.exec(l.description);
      if (!m) continue;
      const emp = vendor.employees.find((e) => e.name === m[1])!;
      expect(urls).toContain(`${base}/portal/employees/${emp.employee_id}?week=2026-10-11`);
    }
  });

  it("narration states the rules and open questions", () => {
    const text = rec.transcript.join(" ").toLowerCase();
    for (const needle of [
      "rate card",
      "duplicate",
      "allowed list",
      "cap",
      "total",
      "timecard",
      "dispute",
      "credit memo",
      "overtime",
      "1.5",
      "pre-approval",
      "open question",
    ])
      expect(text, needle).toContain(needle);
  });
});
