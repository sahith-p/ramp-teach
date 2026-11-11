---
name: halcyon-invoice-review
description: "Review Halcyon Staffing invoices against contract and approved timecards. Use when reviewing a service (staffing) invoice from Halcyon Staffing before it is paid: applies 1 learned check, reads approved hours from the vendor portal, and recommends approve or dispute. Learned from a recorded human review; every rule cites the reviewer's words."
---

# Review Halcyon Staffing invoices against contract and approved timecards

Version 2 (real). Vendor: Halcyon Staffing. Rules are quoted from the recorded review; "shown" means the reviewer inspected it on screen without saying it.

## When to use

A new invoice from Halcyon Staffing needs checking before payment. You gather evidence and recommend; a person approves or disputes. Never approve, pay, submit or attach anything.

## Rules

- **r1** No employee may be billed on more than one labor line for the same week ending date.
  - "And nobody should be billed twice for the same week." (u3, step 14)

## How to gather evidence

- **r2** Sign in to the Halcyon Staffing client portal, open the Invoices list, and open the invoice under review by its invoice number link. _(shown)_
  - shown at step 6: `main > div > form > button`; shown at step 10: `a[href="/portal/invoices/HSG-1010"]`
- **r3** For each billed person on the invoice page, click "View timecard" to open their timecard for the billed week, read the approved hours field ([data-field="approved_hours"]), then return to the invoice page before opening the next person's timecard. _(both)_
  - shown at step 14: `a[href="/portal/employees/E-101?week=2026-10-11"]`; shown at step 16: `[data-field="approved_hours"]`; "Then I check each person's hours against their timecard." (u4, step 16); shown at step 18: `navigate`

## Where to look

- `/portal/invoices`: invoice link `a[href^="/portal/invoices/"]`
- `/portal/invoices/<invoice_id>`: View timecard link `a[href^="/portal/employees/"]`
- `/portal/employees/<employee_id>?week=<YYYY-MM-DD>`: approved_hours `[data-field="approved_hours"]`

## Decision rule

- Not stated in the recording: recommend review by a person.

## Checks

Python scripts in `checks/` (written by Claude, run in a sandbox and compared with the deterministic calculator; the calculator decides):
- `checks/no_duplicate_lines.py` (no_duplicate_lines)

## Open questions

- What are the contract rates per role, and where are they found to compare against invoice rates?
- How should the reviewer check whether someone is billed twice for the same week?
- Where on the invoice are billed hours read for comparison against the timecard?
- Which non-labor charges are allowed and what are their caps? This was never mentioned.
- How is the dispute or credit request filed when something is off?
- Are the spoken approved hours (Maya 40, Sam 36) fixed caps the reviewer knows independently, or just read aloud from the timecard? Should the timecard value always be the source of truth?
- Which timecard belongs to which person (E-101 vs E-104)? How are billed persons on the invoice matched to their timecards?
- How does the reviewer pick 'this month's' invoice from the invoices list, given that HSG-1010 was clicked without a stated criterion?
- What should the reviewer conclude or do when every check passes, since only the dispute path was described?
- What did the reviewer do on the invoice page after returning from the last timecard (step 23)?
