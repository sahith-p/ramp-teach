# MORNING: Ramp Teach overnight build

**Unofficial demo inspired by Ramp's design. Synthetic data only.**
Branch: `claude/pensive-turing-jh6orb` (pushed; no PR opened, nothing merged to main).

## TL;DR

The workflow runs end to end in **real AI mode**, and RECORD now feeds LEARN:

1. **RECORD:** the MV3 extension captured a review session on the real fixture portal
   (`extension/recordings/portal-HSG-1010.json`). A **scripted Playwright operator** performed that session, not a human.
2. **LEARN:** one real Claude call distilled **that capture** into `rules/workflow_spec.json`.
   `rules/learn_meta.json` records the path and its provenance.
3. **VERIFY:** on test invoice `HSG-1011`, Claude drove a browser through the portal (it signed in and opened all
   4 timecards), and the deterministic checks flagged **all 3 planted errors**.
4. **RECEIPT:** a Claude call wrote the receipt: **dispute**, $3,448.00 credit memo, matching the answer key.
5. **DECIDE + ATTACH:** a decision was recorded through the UI and the receipt attached to the fixture bill.

`npm run demo` reports **ALL PASSED** in real mode (from the capture-learned spec) and in offline mode.
One real demo run costs about **$0.18**.

Every ticket is DONE (`board/tickets.md`). Nothing is BLOCKED. **Outstanding:** a genuinely human-recorded session (below).

## Demo videos

- **Product film for voice-over: `demo/video/ramp-teach-demo.mp4`** (192 s, 1080p, 8.1 MB):
  - Recording with the real Recorder extension, with subtitles.
  - **Send to Ramp**, then Ramp Teach inside the Ramp-style dashboard learns the rules (a live Claude call).
  - An invoice arrives and the agent reviews it live, with its own browser in a second window: "Needs a second look", then Dispute.
  - A clean invoice arrives: "Looks good", then Approve.
  - Four technical diagrams (recorder, agent, review, trace with every Claude request ID) and a dark Ramp-style outro.
  - Cursor, narration and the clicks are scripted. Details and live-vs-staged table: `demo/video/README.md`.
- Earlier walkthrough with honesty captions: `demo/video/ramp-teach-walkthrough.mp4`.

## What works

| Stage | Status | Evidence |
|---|---|---|
| RECORD | MV3 extension: content script, side panel with typed or Web Speech narration, JSON export | `extension/recordings/portal-HSG-1010.json`: 33 steps on the real fixture portal, schema-valid, localhost only, password redacted. Operator: scripted Playwright. |
| LEARN | One real Claude call on the **extension capture**; 7 eval cases from the correction history | `rules/learn_meta.json`: `mode: real`, `recording_path: extension/recordings/portal-HSG-1010.json`, `provenance.operator: scripted_playwright`. `rules/workflow_spec.json`: 7 rules, 3 proof sources, 1 open question. |
| VERIFY | 6 deterministic checks plus a real browser-use loop (`browser_toolset_20260801`) on localhost | `runs/HSG-1011/calc.json`, `runs/HSG-1011/evidence.json` (mode `real`, 4 timecards) |
| RECEIPT | One real synthesis call, then a calc-authoritative evidence post-pass | `receipts/HSG-1011.json` (mode `real`, recommendation `dispute`) |
| DECIDE + ATTACH | Review page, then `POST /api/decisions`, then bill attach | `receipts/decisions.jsonl`; `runs/HSG-1011/demo/*.png` |

The seeded `data/recording.sample.json` is kept unchanged as a **labeled fallback fixture**. LEARN uses it only
if the capture is missing (and says so), and unit tests use it.

## Run it

```bash
npm install
```

```bash
npm run typecheck && npm test
```

```bash
npm run eval
```

```bash
npm run demo
```

- `npm run demo` builds the app, starts it on :3000, runs the agent on HSG-1011, asserts against the answer key,
  clicks Dispute in the UI and checks the bill. It writes `runs/HSG-1011/demo/demo-report.json` plus screenshots.
  The report includes which recording the spec came from.
- Real mode needs `RAMP_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`) in the shell. The key is only ever read from
  the environment, never written to a file.
- `npm run demo -- --offline` is free: deterministic learn, scripted evidence, mock receipt, all labeled.
- `npm run learn` re-distills from the capture. Its output is cached by recording + prompt + model, so it is free
  after the first call. `npm run learn -- --recording data/recording.sample.json` uses the fallback fixture on purpose.
- `npx tsx scripts/usage.ts` prints token usage and estimated cost from `runtime/usage.jsonl`.
- A demo run overwrites `receipts/HSG-1011.json`, `runs/HSG-1011/*` and `agent/trace.jsonl`, which are the committed
  real-run artifacts. Don't commit an offline run over them by accident.

## Which modes ran, and why

The key was available as `RAMP_ANTHROPIC_API_KEY`. Its presence was verified by **using** it
(`GET /v1/models` returned 200, `GET /v1/models/claude-opus-5-5` returned 200); it was never printed. So the real
paths ran:

| Piece | Mode | Notes |
|---|---|---|
| The recorded session | **scripted operator, real capture** | `extension/scripts/record-session.ts` plays the reviewer (fixed clicks and narration). The extension's capture is real. Not a human. |
| Learn (committed `rules/`) | **real** | 1 call on the capture. The capture never names the vendor, so the spec says "Not stated in recording"; the distiller is told not to guess. |
| Eval cases | deterministic | Generated from `data/corrections.json` in the same learn run. They come from the correction history, not the recording, so they are unchanged. |
| Browser evidence (committed run) | **real** | 8/25 turns, ended normally, 12 facts. Actions: navigate ×6, get_page_text ×6, form_input ×2, read_page ×1, find ×1, left_click ×1, wait ×1. |
| Receipt (committed run) | **real** | The post-pass changed nothing; the model's results matched calc. |
| Calc, evals | deterministic | No LLM in `calc/`, by design. |
| Human decision in the demo | scripted | Labeled in `decided_by`. A real person should click it live (script below). |
| Offline fallbacks | scripted / mock | Verified with `npm run demo -- --offline`: ALL PASSED. |

**Model:** `claude-opus-5-5` for every call (learn, browser loop, synthesis), adaptive thinking, effort medium.
No substitution.

## Tests and evals

- `npm run typecheck`: clean.
- `npm test`: **171/171 pass** (19 files). They cover calc, data, contracts samples, the extension, fixtures, the
  receipt UI and decision API, learn (including the capture as LEARN input), the agent driver/toolset/loop/enforce/
  engine, the invoice workflow, and the failure-flag copy.
- `npm run eval`: **7/7** correction-derived cases (recall). The **precision guard** also passes 10/10: each past
  invoice fails exactly its corrected check, and the 3 clean invoices pass all six.
- `components/fixtures/smoke.mjs`: 24/24 on a fresh state. 18/18 when HSG-1011's receipt is already attached
  (its attach checks are skipped then).

## Receipt UI copy (operator fix)

- Red line-item flags now state the failure: **Rate mismatch**, **Duplicate line**, **Hours not approved**, Line amount
  wrong, Total mismatch, Unknown charge. Hovering shows the check name.
- The hours check also fails when no approved timecard exists, so the flag says "not approved" rather than "over approved".
- The checks table still shows check names, next to their Pass/Fail badge.
- Em dashes are removed from all visible UI copy (titles, labels, placeholders). Every page reads 0.
- Math, evidence pointers and the receipt text are unchanged.
- The demo screenshots in `runs/HSG-1011/demo/` were regenerated with the new copy.

## API credit usage (honest estimate)

| What | Calls | Est. cost |
|---|---|---|
| Learn distillation on the seeded sample (learn lane, superseded) | 1 | ~$0.04 |
| Agent lane development (1 smoke + 2 full browser runs against a test stub, 2 synthesis) | 18 + 2 requests | ~$0.28 |
| Orchestrator: first real `npm run demo` | 9 | ~$0.19 |
| Orchestrator: real LEARN on the capture + real `npm run demo` from the new spec | 10 | ~$0.22 |
| Walkthrough video: one live real-mode agent run (8 browser turns + 1 synthesis) | 9 | ~$0.20 |
| **Total** | | **≈ $0.93** of the $50 budget |

The orchestrator and video rows come from `runtime/usage.jsonl` (~$0.61). The lane rows are computed from the token counts
each lane reported, at Opus 5.5 list prices ($4 / $20 per MTok input/output, $0.20 cache read, ~$5 cache write).
The Anthropic console is the authoritative number. The Claude Code sessions that built this are not billed to this key.

## Outstanding work and next steps

1. **A genuinely human-recorded session (outstanding).** Every recording so far came from a scripted Playwright
   operator or was hand-authored. To close this:
   - load `extension/` unpacked (see `extension/README.md`)
   - have a real AP specialist record a review of a past invoice with narration
   - add the file as the first entry of `invoiceReviewRecordings` in `workflows/invoice-review/learn.ts` with
     `operator: "human"`
   - run `npm run learn` (one call), then `npm run demo`
2. **Learn executable checks, not just the spec.** Today the six checks are hand-written in `calc/`. The learned spec
   feeds the browser task, the synthesis prompt and the open questions.
3. **Ramp sandbox adapter.** Swap the fixture bill store for a Ramp developer-sandbox approval target: attach the
   receipt and record the decision in Ramp's flow (see `docs/workflow.md` §6). No Ramp API was called.
4. **Decision API auth.** `POST /api/decisions` is unauthenticated (demo grade).
5. **Housekeeping.** Lane worktrees are under `.claude/worktrees/` (gitignored, local to this container). Next warns
   about a `package-lock.json` in `/home/user` (outside the repo). It's harmless; setting `outputFileTracingRoot` in
   `next.config.ts` silences it.

Integration fixes, all logged in `board/tickets.md`:
- RECORD connected to LEARN, with provenance
- the decision API allows one decision per *receipt*, so re-runs can be decided
- the smoke-test selector was fixed for production builds
- the usage ledger was wired into the provider
- the eval precision guard was added
- failure-flag copy and the em dash sweep

## 3-minute demo script (follow it cold)

Setup, before the audience arrives: `npm install`, then `npm run build && npm run start`, and open
http://localhost:3000. If you want a fresh undecided receipt for a live click, run `npm run agent -- HSG-1011` in a
second terminal (real mode, about $0.17 and 45 s; or add `--offline`), then `rm -f runtime/bills.json` to reset the
bill inbox.

1. **0:00, the problem** (`/`). "A staffing vendor bills weekly. An AP specialist checks every line against the
   contract and the vendor's timecard portal. We want an agent that learns that check from watching it done once."
   Point at the five stages and the "Unofficial demo" banner.
2. **0:30, RECORD.** Open `extension/recordings/portal-HSG-1010.json`. "Our Chrome extension captured this session on
   the vendor portal: clicks, page URLs, and narration like 'billed hours must not exceed approved hours'. The password
   is redacted. Full disclosure: a script played the reviewer here; a real reviewer recording is next."
3. **0:55, LEARN.** Open `rules/learn_meta.json`, then `rules/workflow_spec.json`. "One Claude call turned that exact
   capture into rules, where the proof lives, and an open question about overtime. It didn't invent a vendor name the
   recording never said. Every past correction became a permanent eval." Run `npm run eval` (7/7 plus precision).
4. **1:25, VERIFY.** Open `/portal/login` and sign in as `ap.reviewer` / `demo-only`. Open invoice HSG-1011, then Sam
   Okafor's timecard: 38 h approved, but the invoice bills 44. "Claude drove exactly this portal itself: it signed in
   and read all four timecards. Our code only executes its actions, and only on localhost." Show
   `runs/HSG-1011/screenshots/` or the `browser.*` lines in `agent/trace.jsonl`.
5. **2:00, RECEIPT** (`/receipts/HSG-1011`). Lemon banner: **Dispute**, with a Real AI badge. "Three of six checks fail.
   The flags say what's wrong: rate mismatch on Maya, a duplicate line for Priya, Sam's hours not approved. The credit
   memo is $3,448. Every row links its evidence." Click one evidence link. "The math is plain code; Claude can't
   overrule it."
6. **2:35, DECIDE + ATTACH.** Type your name and click **Dispute** (if you didn't re-run the agent, the page shows the
   demo's scripted decision instead). Click "Open bill in inbox": `bill_HSG-1011` is Disputed with the receipt
   attached. "The agent never approves or pays. A person decides, and the receipt is the audit trail."
7. **2:55, close.** "One workflow on a reusable record, learn, act, evidence, approve engine. About $0.18 of API per
   invoice in real mode."
