# Ramp Teach — how it works

> Unofficial demo inspired by Ramp's design. Not affiliated with Ramp. Every vendor, person, invoice,
> timecard and bill in this repo is synthetic.

Ramp Teach shows an AP specialist teaching an agent one job, verifying a staffing vendor's service
invoice, by doing it once while narrating. The agent then does the job on a new invoice and hands a
human an auditable receipt to approve or dispute. The slice is deliberately narrow: **one vendor, one
recording, one new invoice with exactly three planted errors, one workflow end to end.**

## 1. The five stages

```
 RECORD ───────► LEARN ───────► VERIFY ─────────────────────────► RECEIPT ─────► DECIDE + ATTACH
 MV3 extension    distill         calc (pure code)                one Claude      human clicks
 captures DOM     recording →     + browser agent gathers         call writes     Approve/Dispute;
 events +         workflow spec   evidence on the fixture         the receipt;    receipt attaches
 narration        + eval cases    portal (Claude drives it)       post-pass       to the fixture
                                                                  enforces it     bill
 extension/       learn/ rules/   calc/ agent/ workflows/         agent/          app/receipts
                                                                  enforce.ts      app/api/decisions
```

| Stage | What runs | Output | Mode in tonight's committed run |
|---|---|---|---|
| RECORD | `extension/` (Manifest V3): a content script captures clicks, inputs, submits and navigations with URL, title and timestamp. The side panel takes narration (typed, or Web Speech API). Export downloads a `Recording` JSON. | `extension/recordings/*.json`, `data/recording.sample.json` | Capture **real** (the unpacked extension recorded it). The "reviewer" was **scripted** Playwright, not a human (§4). |
| LEARN | `learn/distill.ts`: **one** Claude call (structured output, validated against the frozen `WorkflowSpec` schema). Without a key: `learn/deterministic.ts` extracts the same fields with no LLM. `workflows/invoice-review/evals.ts` turns every past correction into a permanent eval case. | `rules/workflow_spec.json`, `rules/learn_meta.json`, `rules/evals.json` | **real** (`learn_meta.mode = "real"`, claude-opus-5-5) |
| VERIFY | (a) `calc/` deterministic checks; (b) `agent/providers/browser-loop.ts`: Claude drives a local Chromium through `browser_toolset_20260801` on the fixture vendor portal and records timecard facts with a `record_evidence` tool; (c) calc runs again with the portal evidence. | `runs/<id>/calc.json`, `runs/<id>/evidence.json`, `runs/<id>/screenshots/` | calc **deterministic**; evidence **real** |
| RECEIPT | `agent/engine.ts`: **one** structured Claude call over calc + evidence + learned spec, then `agent/enforce.ts` post-pass. Without a key: `mockReceipt` (deterministic mapper, same shape). | `receipts/<id>.json` | **real** |
| DECIDE + ATTACH | `app/receipts/[invoiceId]`: Approve/Dispute buttons → `POST /api/decisions` → append `receipts/decisions.jsonl`, set the receipt's human fields, attach it to `bill_<id>` with status `approved`/`disputed`. | `receipts/decisions.jsonl`, `runtime/bills.json` | In `npm run demo` the click is a **scripted stand-in for a human**, and `decided_by` says so |

## 2. One engine, invoice review as the first workflow

The core is generic. Invoice review plugs into it and is not hard-wired into it.

- `contracts/engine.ts` defines the seams: `WorkflowDefinition` (what a workflow supplies), `BrowserDriver`
  (a local Playwright Chromium), `AIProvider` (the model boundary), `EvidenceTask`, `RunContext`.
- `agent/engine.ts` `runWorkflow()` and `learn/distill.ts` import nothing from `workflows/` or `calc/`.
  Only the CLIs and `workflows/registry.ts` wire the invoice workflow in.
- `workflows/invoice-review/index.ts` is everything domain-specific: loading the invoice, the evidence plan
  (one task per employee-week on the invoice), turning agent facts into timecards, the scripted fallback,
  synthesis instructions, the mock receipt, and the approval target `bill_<invoice_id>`.
- **Provider boundary:** `config/engine.ts` selects the provider. `agent/providers/index.ts getProvider()` returns
  the Anthropic adapter, or `null` when no credential is visible, and every caller then runs its labeled
  offline mode. Exactly one provider exists. Adding another means implementing `AIProvider`, not editing the
  engine. This is a thin seam, not a multi-provider platform.

A second workflow (say, SaaS seat true-ups) would be a new `workflows/<name>/` implementing
`WorkflowDefinition`, plus its own recording and checks. The engine, browser loop, enforcement and
receipt UI would be reused unchanged.

## 3. Why the calc path is deterministic

Money decisions need to be **reproducible, explainable and cheap to re-run**. So every arithmetic and
contract check is plain TypeScript in `calc/`, with no LLM anywhere on that path:

| Check | Rule |
|---|---|
| `line_amounts_correct` | quantity × unit_rate = amount, to the cent |
| `total_matches_line_items` | sum of line amounts = invoice total, to the cent |
| `rate_matches_contract` | labor rate = the contract rate card for the role |
| `no_duplicate_lines` | no employee billed twice for the same week |
| `no_unknown_charges` | non-labor lines must be on the contract's allowed list, within cap |
| `hours_match_timecards` | billed hours ≤ approved timecard hours for that employee-week (timecards come from the portal evidence) |

The model is used where judgment and navigation help: reading a portal it has never seen, and
writing a clear receipt. It is **not** trusted with the arithmetic. `agent/enforce.ts` makes calc
authoritative after synthesis:

1. Every calc check must appear on the receipt. A model result that contradicts calc is overridden, and
   the override is written into `reasons`.
2. Every check needs one evidence pointer from the frozen grammar (`contracts/evidence.ts`:
   `data/…`, `rules/…`, `calc:<check>`, `fixture:/…`), and that pointer must **resolve**: the file exists,
   the check is in `calc.json`, or the fixture page was actually visited this run. Any check without valid
   evidence forces the recommendation to `review`.
3. `approve` is only possible when all six checks pass. A failing check floors the recommendation at
   `dispute`, and an unverified one at `review`.
4. Human fields are always `null`. Only `POST /api/decisions` sets them.

In the committed real run the post-pass changed nothing: the model's six results already matched calc.
It is still there because the next run might not match.

Evals test the deterministic path the same way: `npm run eval` replays every correction from the
vendor's history (7 cases) and requires its named check to fail at the right line. That is recall. It then
requires every past invoice to fail **only** its corrected checks, with the three clean invoices passing all
six. That is precision.

## 4. What is real AI, what is scripted, what is mock

Stated plainly, for the committed artifacts (`rules/`, `receipts/HSG-1011.json`, `runs/HSG-1011/`, `agent/trace.jsonl`):

| Piece | Mode | What that means |
|---|---|---|
| Workflow spec (`rules/workflow_spec.json`) | **real** | One claude-opus-5-5 call distilled it from `data/recording.sample.json`. Later `npm run learn` runs hit the disk cache and say `cache_hit: true` in `learn/trace.jsonl`. |
| Eval cases (`rules/evals.json`) | deterministic | Generated from `data/corrections.json` by code. |
| Calc checks | deterministic | Plain code, always. |
| Browser evidence | **real** | claude-opus-5-5 chose every action via `browser_toolset_20260801`, executed by our Playwright driver. In the committed run: 6× `navigate`, 6× `get_page_text`, 2× `read_page`, 2× `form_input` (filling the login form), 1× `left_click` (Sign in), 1× `wait`, then 12× `record_evidence`. It signed in itself, opened each timecard and recorded 12 facts in 8 of 25 allowed turns. |
| Receipt (`receipts/HSG-1011.json`, `mode: "real"`) | **real** | One structured claude-opus-5-5 call, then the deterministic post-pass. |
| Fixture login + timecard reads when no key / when the model misses a fact | scripted | Fixed Playwright steps reading the `[data-field]` markers. Each evidence item carries its own mode. Not used in the committed run. |
| Receipt without a key | mock | `mockReceipt`, a deterministic mapper with the same shape. |
| The recorded reviewer session | scripted driver, real capture | `extension/scripts/record-session.ts` plays the reviewer with Playwright while the real extension records. The committed spec was distilled from the data lane's sample recording (same flow, more narration). No human has recorded a session yet. |
| The human decision in `npm run demo` | scripted | A Playwright click on the real UI. `decided_by` reads "Demo reviewer (scripted stand-in for a human)". |

Every trace line (`agent/trace.jsonl`, `learn/trace.jsonl`) carries `mode ∈ real | scripted | mock | deterministic`.

### Safety rails on the browser agent
- **Localhost only, enforced twice.** The toolset's `urlPolicy` refuses any non-allowed origin with a
  `ToolError`, and Playwright request routing aborts every request whose host isn't localhost or 127.0.0.1.
- `javascript_exec`, `file_upload`, `read_console` and `read_network` are disabled. Tab management and zoom
  are disabled because they aren't implemented.
- Capped at 25 turns per invoice. The loop stops after 3 identical failures and applies the toolset's halt
  rule within a batch.
- The agent only reads. It never approves, pays, submits or attaches. Facts are accepted only when recorded
  on the matching timecard page (the source is the browser's current URL, not something the model claims).
- `data/answer_key.json` is read only by `scripts/demo.ts` and tests, never by `agent/`, `learn/`, the provider
  or the review prompt. The receipt evidence viewer refuses to show it.

## 5. How it was built: orchestrator, subagents and the board

The build ran overnight as one orchestrator session delegating to seven lane subagents
(`.claude/agents/*.md`, each `isolation: worktree`, so each worked in its own git worktree):

| Lane | Ticket | Owns |
|---|---|---|
| data-builder | T-10 | `data/**`: corpus, test invoice, answer key, sample recording |
| calc-builder | T-11 | `calc/**` |
| fixture-builder | T-12 | portal + bill inbox (`app/portal`, `app/bills`, their APIs) |
| ui-builder | T-13 | receipt review page + decision API |
| recorder-builder | T-14 | `extension/**` |
| learn-builder | T-20 | `learn/**`, `rules/**`, invoice learn/evals |
| agent-builder | T-21 | `agent/**`, `workflows/registry.ts`, invoice workflow |

- **Phase 0** (the orchestrator, before any spawn) froze the interfaces: `contracts/` (Zod schemas for
  Invoice, Receipt, Recording, WorkflowSpec and Bill, plus supporting shapes and the evidence grammar) and
  `docs/lane-spec.md` (the synthetic world, exact fixture routes and `data-field` markers, module entry
  points). Lanes could then build in parallel against each other's *contracts*. The agent lane, for
  example, built against a test stub of the portal routes while the real portal was being built.
- **The board** (`board/`) is the audit trail. `tickets.md` has a single writer (the orchestrator), each
  lane appends to its own outbox (`CLAIM / STATUS / DONE with evidence / BLOCKED / QUESTION`), and
  `humans.md` holds human DECISION lines (the architecture steer is one). No lane edits another lane's
  files; cross-lane needs go through a QUESTION.
- **Integration** stayed with the orchestrator: merging each lane branch, reconciling outboxes, resolving
  conflicts against the frozen contracts, and running the end-to-end proof (`npm run demo`, `npm run eval`).
  The integration fixes it made are logged in `board/tickets.md`: a smoke-test selector, the usage ledger,
  and the eval precision guard.
- The build spanned several sessions. Handoffs were committed board lines and pushed branches, so a new
  session could continue from committed state instead of redoing work.

## 6. Upgrade path to a Ramp sandbox

The fixture apps stand in for two real systems behind narrow seams:

1. **Bill inbox → Ramp bills.** Today `lib/store/bills.ts` + `POST /api/decisions` attach the receipt to a
   fixture bill. The upgrade is an approval-target adapter that, in a Ramp developer sandbox, looks up the
   bill for the invoice, uploads the receipt (JSON, or a rendered PDF) as an attachment, and records the
   human's decision through Ramp's own approval flow rather than ours. Endpoint names and scopes need
   checking against Ramp's API documentation; none were called tonight. The human stays the one who decides.
2. **Fixture portal → a real vendor portal.** The browser loop is already origin-allowlisted. Pointing it at a
   real portal means adding that one origin to `allowedOrigins`, keeping credentials in a vault the agent
   never sees (sign-in stays a scripted, labeled step), and keeping the read-only rule.
3. **Recording → real reviewers.** Load `extension/` unpacked, record a real AP specialist, and run
   `npm run learn` on that recording (point `invoiceReviewLearn.recordingPath` at it). The distiller and
   schema don't change.
4. **Contracts and timecards from systems of record** (contract repository, HRIS / VMS) replace
   `data/vendor.json` and the portal's timecards. The `calc/` inputs are already typed by `contracts/`.

## 7. Honest limitations

- **Synthetic and narrow.** One vendor, one contract, ten past invoices, one test invoice. The three
  planted errors are exactly the kinds the hand-written checks catch. The demo proves the end-to-end
  plumbing, the evidence trail and the honest labeling. It does not show that the agent generalizes to
  other vendors or to invoice errors nobody wrote a check for.
- **The checks are hand-coded, not learned.** The learned spec shapes the browser task (where the proof
  lives), the synthesis prompt and the open questions on the receipt. The six checks themselves live in
  `calc/` and were written by the calc lane from the brief. Learning executable checks from a recording
  is future work.
- **No human has recorded or decided yet.** The reviewer in the recording and the decision click in the
  demo are scripted stand-ins, labeled as such.
- **Browser evidence is not cached.** Each real run pays for a fresh loop (~$0.15 tonight; synthesis is
  cached by input hash). The model's path can differ from run to run, but the calc results and the
  recommendation floor don't.
- **Open business question left open:** the contract is silent on overtime above 40 h. The spec records it as
  an open question, and the receipt surfaces it instead of guessing.
- **Demo-grade web app.** The decision API has no authentication. The fixture portal's login is a demo
  cookie. Runtime state lives in JSON files (`runtime/bills.json`, `receipts/`), with no database and no
  concurrency control.
- **Worktree builds need `--webpack`.** Turbopack can't resolve the symlinked `node_modules` in lane worktrees.
  The main checkout builds with the default.
