# Lane interface spec (orchestrator-owned, pinned before Phase 1)

This pins the cross-lane details the frozen contracts do not: the synthetic world, file locations,
fixture routes and page markers, and module entry points. Lanes build against THIS document so
they can work in parallel. If you need something changed, post a QUESTION in your outbox.

## 1. The synthetic world (data lane writes it; everyone else reads it via `lib/data.ts`)

**Vendor**: `Halcyon Staffing Group` (vendor_id `V-HSG`). Fictional. Contract `C-HSG-2026`,
effective 2026-01-01 → 2026-12-31, USD, net 30.

**Rate card** (USD/hour): Senior Recruiter 95 · Recruiting Coordinator 62 · Sourcer 70 · Data Analyst 88.

**Allowed non-labor charges** (exact descriptions): `Background check fee` (max_amount 120),
`Job board posting` (max_amount 400).

**Employees**: E-101 Maya Chen (Senior Recruiter) · E-102 Jordan Alvarez (Recruiting Coordinator) ·
E-103 Priya Natarajan (Sourcer) · E-104 Sam Okafor (Data Analyst) · E-105 Elena Rossi (Recruiting Coordinator).

**Invoices** — one invoice per week, weeks end on Sundays. issue_date = week end + 1 day,
due_date = issue_date + 30 days. Labor lines use the frozen format
`Labor: <Employee Name> (<Role>) - week ending YYYY-MM-DD`, quantity = hours, unit_rate = bill rate.
- Past: `HSG-1001` … `HSG-1010` (weeks ending 2026-08-09 … 2026-10-11) in `data/invoices/past/`.
- New test invoice: `HSG-1011` (week ending 2026-10-18) in `data/invoices/new/HSG-1011.json`.

**HSG-1011 has exactly 3 planted errors** (and is otherwise clean: every line amount = qty × rate,
total = sum of line amounts, so arithmetic checks PASS):
1. `rate_matches_contract` — Maya Chen billed at 105.00/h; contract rate is 95.00.
2. `no_duplicate_lines` — Priya Natarajan's labor line for week ending 2026-10-18 appears twice.
3. `hours_match_timecards` — Sam Okafor billed 44 h; the approved timecard says 38 h.
Expected recommendation: `dispute`. Line indices live in `data/answer_key.json` (tests/demo only).

**Past invoices** are clean except for the errors that `data/corrections.json` documents — one
correction per affected invoice, covering all six CHECK_NAMES at least once (incl. an unknown charge
such as `Rush fee` and a line-arithmetic error and a total mismatch). Every past invoice error MUST be
exactly what its correction says, so eval cases derived from corrections fail the named check.

**Timecards** `data/timecards.json`: one approved timecard per employee per week that employee was
billed (all weeks incl. 2026-10-18). This is the PORTAL's backend data. The agent must obtain hours
by reading portal pages, not by importing this file.

**Bills** `data/bills.json`: one bill per invoice, `bill_<invoice_id>`, amount = invoice total.
Past bills `approved` (receipt_id null) except the ones with corrections: `disputed`. `bill_HSG-1011` is `pending`.

**Sample recording** `data/recording.sample.json`: a reviewer (AP specialist) verifying past invoice
`HSG-1010` in the fixture portal (URLs on `http://localhost:3000`, routes in §2): login, open the
invoice, open each employee's timecard for that week, compare hours, with narration stating the
rules (rate = contract rate card; no duplicate employee-week lines; non-labor charges must be on the
allowed list and under the cap; billed hours ≤ approved timecard hours; arithmetic and total must tie;
any failure → dispute and ask for a credit memo) and at least one open question (e.g. overtime
above 40 h — billable at 1.5×?). Password inputs are recorded as `[redacted]`.

## 2. Fixture app routes (fixture lane builds; agent lane and recorder depend on these EXACTLY)

All on the Next app at `BASE_URL` (default `http://localhost:3000`). Every page shows the global demo
banner (layout) plus a fixture label, e.g. "Fixture vendor portal — synthetic data".

Vendor timecard portal (`app/portal/**`, `app/api/portal/**`):
- `GET /portal/login` — form with `input[name=username]`, `input[name=password]` (type password),
  button text `Sign in`. Shows demo creds on the page: username `ap.reviewer`, password `demo-only`.
  Form posts to `POST /api/portal/login` → sets cookie `portal_session` and 303-redirects to
  `/portal/invoices`. Bad creds → `/portal/login?error=1` with a visible error.
- All other `/portal/*` pages redirect to `/portal/login` without the cookie.
- `GET /portal/invoices` — table of all invoices (past + new): invoice id (link to
  `/portal/invoices/<invoice_id>`), week ending, total (tabular, right-aligned).
- `GET /portal/invoices/<invoice_id>` — invoice header + line items table. Each labor line has a link
  `View timecard` → `/portal/employees/<employee_id>?week=<YYYY-MM-DD>`.
- `GET /portal/employees` — roster with links to `/portal/employees/<employee_id>`.
- `GET /portal/employees/<employee_id>` — that employee's weeks, each linking to `?week=`.
- `GET /portal/employees/<employee_id>?week=YYYY-MM-DD` — the timecard page. Stable markers:
  `[data-field="employee_id"]`, `[data-field="employee_name"]`, `[data-field="role"]`,
  `[data-field="week_ending"]`, `[data-field="approved_hours"]` (a plain number, e.g. `38`),
  `[data-field="status"]`, `[data-field="approved_by"]`. Human-readable label next to each.
  Unknown employee/week → a page saying "No timecard found" with `[data-field="approved_hours"]` absent.

Bill inbox (`app/bills/**`, `app/api/bills/**`):
- `GET /bills` — bill list (bill id, vendor, amount, status badge, receipt attached?).
- `GET /bills/<bill_id>` — bill detail; if a receipt is attached, shows its recommendation, human
  decision and a link to `/receipts/<invoice_id>`. A human-only `Attach receipt` button (when a
  receipt file exists and none is attached) calls `POST /api/bills/<bill_id>/attach` `{receipt_id}`.
- State via `lib/store/bills.ts` (runtime/bills.json). The agent never calls these.

## 3. Receipt UI + decision API (ui lane)
- `GET /` — five-stage overview (RECORD → LEARN → VERIFY → RECEIPT → DECIDE+ATTACH) with links.
- `GET /receipts` — list of receipts from `lib/store/receipts.ts`.
- `GET /receipts/<invoice_id>` — the review page (docs/design.md). Every check shows its evidence
  pointer as a link: `fixture:/x` → `/x`; `data/…`, `rules/…`, `calc:<check>` → an evidence viewer page
  under `/receipts/<invoice_id>/evidence?p=<pointer>` that renders the file/JSON fragment read-only
  (only from `data/`, `rules/`, `runs/<invoice_id>/`).
- `POST /api/decisions` JSON `{ invoice_id, decision: "approve"|"dispute", decided_by, note? }` →
  appends `receipts/decisions.jsonl` (lib/store/decisions), sets the receipt's human fields
  (lib/store/receipts), attaches the receipt to `bill_<invoice_id>` with status `approved`/`disputed`
  (lib/store/bills `attachReceipt`). Returns `{ decision, receipt, bill }`. 400 on invalid input,
  404 if no receipt.
- `GET /api/receipts/<invoice_id>` — receipt JSON.

## 4. Module entry points
- **calc** (`calc/index.ts`): `runCalc(input: { invoice: Invoice; vendor: VendorProfile;
  timecards: Timecard[] | null; invoicePath: string }): CalcReport` — all six CHECK_NAMES in order.
  `timecards === null` ⇒ `hours_match_timecards` is `unverified`. Per-check functions exported too.
  `hours_match_timecards` compares EACH labor line's quantity to the approved hours for that
  employee+week (no summing; double billing is `no_duplicate_lines`' job). A labor line whose
  employee has no timecard for that week fails. Evidence pointers in findings: `data/…` paths
  (e.g. `data/vendor.json#contract.rate_card.Senior Recruiter`, `<invoicePath>#line_items[2]`);
  for hours, `fixture:/portal/employees/<id>?week=<date>`. No LLM, no network, no fs writes.
- **learn** (`learn/**`, `workflows/invoice-review/learn.ts`, `workflows/invoice-review/evals.ts`):
  `workflows/invoice-review/learn.ts` exports `invoiceReviewLearn` =
  `{ recordingPath, specPath, distillHints, deterministicDistill }` (shape of `WorkflowDefinition.learn`).
  `npm run learn` (learn/cli.ts) writes `rules/workflow_spec.json`, `rules/learn_meta.json` (LearnMeta),
  `rules/evals.json`, and traces to `learn/trace.jsonl`. `npm run eval` (learn/run-evals.ts) runs every
  eval case through calc and exits non-zero on any failure (the eval harness may use data/timecards.json
  as the stand-in for portal evidence — documented).
- **agent** (`agent/**`, `workflows/registry.ts`, `workflows/invoice-review/**` except learn/evals):
  `npm run agent -- HSG-1011` (needs the Next app running at BASE_URL) writes `runs/HSG-1011/calc.json`,
  `runs/HSG-1011/evidence.json`, `runs/HSG-1011/screenshots/*.png`, `receipts/HSG-1011.json`, and appends
  `agent/trace.jsonl`. It never attaches, approves, or decides. `workflows/invoice-review/index.ts`
  sets `learn: invoiceReviewLearn` imported from `./learn`.
- **Model calls**: only via `agent/providers/index.ts getProvider()` (null ⇒ labeled offline mode).
  Cache every model output with `lib/cache.ts` (spending guardrail). Model `claude-opus-5-5`.
  Browser loop capped at `engineConfig.browser.maxTurns` (25).
