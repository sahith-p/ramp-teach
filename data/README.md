# data/ — the synthetic world (seed data, read-only at runtime)

All data here is **synthetic**. Halcyon Staffing Group and every person named are fictional.
This is an unofficial demo inspired by Ramp's design. Load these files through `lib/data.ts`
(validated against `@/contracts`). Paths are in `lib/paths.ts`.

| File | Shape | What it is |
|---|---|---|
| `vendor.json` | `VendorProfile` | Halcyon Staffing Group (`V-HSG`), contract `C-HSG-2026` (2026-01-01 → 2026-12-31, USD, net 30), the rate card, allowed non-labor charges, and 5 employees |
| `invoices/past/HSG-1001…1010.json` | `Invoice` | Ten weekly invoices, weeks ending 2026-08-09 … 2026-10-11 |
| `invoices/new/HSG-1011.json` | `Invoice` | The new invoice to review, week ending 2026-10-18 |
| `timecards.json` | `Timecard[]` | One approved timecard per employee per billed week. This is the **portal's** backend data: the agent reads hours from portal pages, never from this file |
| `corrections.json` | `Correction[]` | What AP reviewers caught on past invoices, one per affected invoice, covering all six `CHECK_NAMES` |
| `bills.json` | `Bill[]` | Seed for `runtime/bills.json`: one bill per invoice (`bill_<invoice_id>`, amount = invoice total). Past bills are `approved`, corrected ones `disputed`, `bill_HSG-1011` is `pending` |
| `recording.sample.json` | `Recording` | An AP specialist verifying HSG-1010 in the fixture portal (`http://localhost:3000/portal/...`), with DOM steps and narration stating the review rules and open questions. Password recorded as `[redacted]` |
| `answer_key.json` | `AnswerKey` | **Tests and `scripts/demo.ts` only.** Never read by `agent/`, `learn/`, the provider, or the review prompt |

## Rate card (USD/hour)
Senior Recruiter 95 · Recruiting Coordinator 62 · Sourcer 70 · Data Analyst 88.

Allowed non-labor charges (exact description, cap per line): `Background check fee` (120), `Job board posting` (400).

Employees: E-101 Maya Chen (Senior Recruiter) · E-102 Jordan Alvarez (Recruiting Coordinator) ·
E-103 Priya Natarajan (Sourcer) · E-104 Sam Okafor (Data Analyst) · E-105 Elena Rossi (Recruiting Coordinator).

## Invoice conventions
- One invoice per week. Weeks end on Sunday, `issue_date` = week end + 1 day, `due_date` = issue + 30 days.
- Labor lines: `Labor: <Employee Name> (<Role>) - week ending YYYY-MM-DD`, with quantity = hours and unit_rate = bill rate.
  Any other description is a non-labor charge.
- Money is exact to the cent.
- Past invoices are clean except for the errors documented in `corrections.json`. Each correction's
  `line_index` (0-based, `null` for an invoice-level total mismatch) points at the planted error.
- HSG-1011 has three planted errors (see `docs/lane-spec.md` §1). It is otherwise clean.

## Self-check
`npx vitest run data` (`data/__tests__/data.test.ts`) parses every file with the frozen schemas. It then
re-runs the six checks inline (independent of `calc/`) and asserts that each invoice fails exactly the checks its
corrections or the answer key name, and nothing else.
