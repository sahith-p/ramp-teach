---
name: halcyon-invoice-review
description: "Review Halcyon Staffing invoice against contract and approved timecards. Use when reviewing a service (staffing) invoice from Halcyon Staffing before it is paid: applies 2 learned checks, reads approved hours from the vendor portal, and recommends approve or dispute. Learned from a recorded human review; every rule cites the reviewer's words."
---

# Review Halcyon Staffing invoice against contract and approved timecards

Version 1 (real). Vendor: Halcyon Staffing. Rules are quoted from the recorded review; "shown" means the reviewer inspected it on screen without saying it.

## When to use

A new invoice from Halcyon Staffing needs checking before payment. You gather evidence and recommend; a person approves or disputes. Never approve, pay, submit or attach anything.

## Rules

- **r1** No employee may appear on more than one labor line for the same week ending date.
  - "And nobody should be billed twice for the same week." (u3, step 14)
- **r2** For each labor line, billed hours must be less than or equal to the approved_hours shown on that employee's timecard for the billed week.
  - "Then I check each person's hours against their timecard." (u4, step 14); "Billed hours can't go over that." (u6, step 16)

## How to gather evidence

- **r4** Sign in to the Halcyon Staffing client portal, open the invoices list, and open the invoice under review by its invoice number. _(shown)_
  - shown at step 6: `main > div > form > button`; shown at step 10: `a[href="/portal/invoices/HSG-1010"]`
- **r5** For each person billed on the invoice, click that line's "View timecard" link to open the employee's timecard for the billed week, read the approved_hours field, then return to the invoice before opening the next person's timecard. _(both)_
  - "Then I check each person's hours against their timecard." (u4, step 14); shown at step 14: `a[href="/portal/employees/E-101?week=2026-10-11"]`; shown at step 16: `[data-field="approved_hours"]`; shown at step 19: `a[href="/portal/employees/E-104?week=2026-10-11"]`

## Where to look

- `/portal/invoices`: invoice link `a[href^="/portal/invoices/"]`
- `/portal/invoices/<invoice_id>`: View timecard link `a[href^="/portal/employees/"]`
- `/portal/employees/<employee_id>?week=<YYYY-MM-DD>`: approved_hours `[data-field="approved_hours"]`

## Decision rule

- **r3** If any check fails, recommend disputing the invoice and requesting a credit; otherwise the invoice passes review.
  - "If anything is off, I dispute it and ask for a credit." (u8, step 21)

## Checks

Python scripts in `checks/` (written by Claude, run in a sandbox and compared with the deterministic calculator; the calculator decides):
- `checks/no_duplicate_lines.py` (no_duplicate_lines)
- `checks/hours_match_timecards.py` (hours_match_timecards)

## Open questions

- Where are the contract rates found? The reviewer says every rate must match the contract but never opens it, and no per-role rates were stated.
- How should duplicate billing for the same week be detected? It was stated as a rule but not demonstrated.
- How is a dispute filed and a credit requested? This was not demonstrated.
- Does a small difference (e.g. rounding) count as "off", or is any difference a failure?
- Which non-labor charges are allowed and what are their caps? None were stated in the recording.
- Where on the invoice page are each line's billed hours and bill rate read? The portal_map has no selectors for these, and no click on them was recorded.
- Are the spoken approvals (Maya 40, Sam 36) meant as fixed per-person limits, or only as readings of that week's timecard? How do Maya and Sam map to employee IDs E-101 and E-104?
- Does the week parameter (e.g. 2026-10-11) mean the week-ending date or the week-start date when matching invoice lines for the duplicate check?
- Is any additional information on the timecard page (e.g. actual worked hours) to be compared, or only the approved_hours field?
