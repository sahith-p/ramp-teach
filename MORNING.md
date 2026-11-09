# MORNING — Ramp Teach overnight build

**Unofficial demo inspired by Ramp's design. Synthetic data only.**
Branch: `claude/pensive-turing-jh6orb` (pushed; no PR opened, nothing merged to main).

## TL;DR

The workflow runs end to end in **real AI mode**. On test invoice `HSG-1011`, Claude drove a browser
through the fixture vendor portal (signed in and opened all 4 timecards), the deterministic checks flagged
**all 3 planted errors**, a Claude call wrote the receipt (**dispute**, $3,448.00 credit memo, matching the
answer key), a decision was recorded through the UI, and the receipt attached to the fixture bill.
`npm run demo` reported **ALL PASSED** in both real and offline mode. The API cost of the whole real demo
run was about **$0.19**.

Every ticket is DONE (`board/tickets.md`). Nothing is BLOCKED.

## What works

| Stage | Status | Evidence |
|---|---|---|
| RECORD | MV3 extension (content script, side panel with typed/Web Speech narration, JSON export) | `extension/recordings/portal-HSG-1010.json`: 33 steps captured on the real fixture portal, password redacted |
| LEARN | Spec distilled by one real Claude call; 7 eval cases from corrections | `rules/learn_meta.json` → `mode: real`; `rules/workflow_spec.json` (8 rules, 3 proof sources, 2 open questions) |
| VERIFY | 6 deterministic checks plus a real browser-use loop (`browser_toolset_20260801`) on localhost | `runs/HSG-1011/calc.json`, `runs/HSG-1011/evidence.json` (mode `real`, 4 timecards) |
| RECEIPT | One real synthesis call, then a calc-authoritative evidence post-pass | `receipts/HSG-1011.json` (mode `real`, recommendation `dispute`) |
| DECIDE + ATTACH | Review page → `POST /api/decisions` → bill attach | `receipts/decisions.jsonl`; `runs/HSG-1011/demo/*.png` |

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

- `npm run demo` builds the app, starts it on :3000, runs the agent on HSG-1011, asserts against the
  answer key, clicks Dispute in the UI and checks the bill. It writes `runs/HSG-1011/demo/demo-report.json`
  plus screenshots.
- Real mode needs `RAMP_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`) in the shell. The key is only ever read
  from the environment, never written to a file. Each real demo run costs about $0.15–0.20.
- `npm run demo -- --offline` is free: deterministic learn, scripted evidence, mock receipt, all labeled.
- `npx tsx scripts/usage.ts` prints token usage and estimated cost from `runtime/usage.jsonl`.
- A demo run overwrites `receipts/HSG-1011.json`, `runs/HSG-1011/*` and `agent/trace.jsonl`, which are the
  committed real-run artifacts. Don't commit an offline run over them by accident.

## Which modes ran, and why

The key was available as `RAMP_ANTHROPIC_API_KEY`. Its presence was verified by **using** it
(`GET /v1/models` → 200, `GET /v1/models/claude-opus-5-5` → 200); it was never printed. So the real paths ran:

| Piece | Mode | Notes |
|---|---|---|
| Learn (committed `rules/`) | **real** | 1 call. Later runs are cache hits (`cache_hit: true` in `learn/trace.jsonl`). |
| Browser evidence (committed run) | **real** | 8/25 turns, ended normally, 12 facts. Actions: navigate ×6, get_page_text ×6, read_page ×2, form_input ×2, left_click ×1, wait ×1. |
| Receipt (committed run) | **real** | The post-pass changed nothing; the model's results matched calc. |
| Calc, evals | deterministic | No LLM in `calc/`, by design. |
| Reviewer in the recording | scripted | Playwright played the reviewer; the extension's capture is real. |
| Human decision in the demo | scripted | Labeled in `decided_by`. A real person should click it live (script below). |
| Offline fallbacks | scripted / mock | Verified separately with `npm run demo -- --offline` → ALL PASSED. |

**Model:** `claude-opus-5-5` for every call (learn, browser loop, synthesis), with adaptive thinking at effort
medium. No substitution.

## Tests and evals

- `npm run typecheck`: clean.
- `npm test`: **164/164 pass** (18 files, covering calc, data, contracts samples, the extension, fixtures,
  receipt UI and decision API, learn, the agent driver/toolset/loop/enforce/engine, and the invoice workflow).
- `npm run eval`: **7/7** correction-derived cases (recall). The **precision guard** also passes 10/10: each past
  invoice fails exactly its corrected check, and the 3 clean invoices pass all six checks.
- `components/fixtures/smoke.mjs`: **24/24** against the production build.

## API credit usage (honest estimate)

| What | Calls | Est. cost |
|---|---|---|
| Learn distillation (learn lane) | 1 | ~$0.04 |
| Agent lane development (1 smoke + 2 full browser runs against a test stub, 2 synthesis) | 18 + 2 requests | ~$0.28 |
| Orchestrator real `npm run demo` (8 browser turns + 1 synthesis) | 9 | ~$0.19 (from `runtime/usage.jsonl`) |
| **Total tonight** | | **≈ $0.50** of the $50 budget |

The lane figures are computed from the token counts each lane reported, at Opus 5.5 list prices
($4 / $20 per MTok input/output, $0.20 cache read, ~$5 cache write). The Anthropic console is the
authoritative number. The Claude Code sessions that built this are not billed to this key.

## Unfinished work and next steps

1. **A human recording.** Load `extension/` unpacked (see `extension/README.md`), record a real AP specialist,
   point `invoiceReviewLearn.recordingPath` (in `workflows/invoice-review/learn.ts`) at it, and run `npm run learn`
   (one new call, since the cache key includes the recording).
2. **Learn executable checks, not just the spec.** Today the six checks are hand-written in `calc/`. The learned
   spec feeds the browser task, the synthesis prompt and the open questions.
3. **Ramp sandbox adapter.** Swap the fixture bill store for a Ramp developer-sandbox approval target (attach the
   receipt, record the decision in Ramp's flow). See `docs/workflow.md` §6. No Ramp API was called tonight.
4. **Decision API auth.** `POST /api/decisions` is unauthenticated (demo grade).
5. **Housekeeping.** Lane worktrees are under `.claude/worktrees/` (gitignored, local to this container). Next warns
   about a `package-lock.json` in `/home/user` (outside the repo). It's harmless, and setting `outputFileTracingRoot`
   in `next.config.ts` silences it.

Fixes made at integration (all logged in `board/tickets.md`):
- the decision API now allows one decision per *receipt*, so re-runs can be decided
- the smoke test's alert selector was fixed for production builds
- the usage ledger was wired into the provider
- the eval precision guard was added

## 3-minute demo script (follow it cold)

Setup, before the audience arrives: `npm install`, then `npm run build && npm run start`, and open
http://localhost:3000. If you want a fresh undecided receipt for a live click, run `npm run agent -- HSG-1011`
in a second terminal (real mode, ~$0.17, ~45 s; or add `--offline`), then `rm -f runtime/bills.json` to reset
the bill inbox.

1. **0:00 — The problem** (`/`). "A staffing vendor bills weekly. An AP specialist checks every line against the
   contract and the vendor's timecard portal. We want an agent that learns that check from watching it done once."
   Point at the five stages and the "Unofficial demo" banner.
2. **0:30 — RECORD.** Open `extension/recordings/portal-HSG-1010.json` (or `data/recording.sample.json`). "The Chrome
   extension captured clicks, page URLs and narration: 'billed hours must not exceed approved hours'. The password
   is redacted."
3. **0:55 — LEARN.** Open `rules/workflow_spec.json`. "One Claude call turned that into rules, where the proof lives,
   and open questions, like whether overtime over 40 h is billable at 1.5×. Every past correction became a permanent
   eval." Run `npm run eval` (7/7 plus precision).
4. **1:25 — VERIFY.** Open `/portal/login` and sign in as `ap.reviewer` / `demo-only`. Open invoice HSG-1011, then Sam
   Okafor's timecard: 38 h approved, but the invoice bills 44. "Claude drove exactly this portal itself: it signed in
   and read all four timecards. Our code only executes its actions, and only on localhost." Show
   `runs/HSG-1011/screenshots/` or the `browser.*` lines in `agent/trace.jsonl`.
5. **2:00 — RECEIPT** (`/receipts/HSG-1011`). Lemon banner: **Dispute**, with a Real AI badge. "Three of six checks fail:
   rate $105 vs $95, Priya billed twice, Sam 44 h vs 38. The credit memo is $3,448. Every row links its evidence:
   the contract line, the invoice line, the portal page." Click one evidence link. "The math is plain code; Claude
   can't overrule it."
6. **2:35 — DECIDE + ATTACH.** Type your name and click **Dispute** (if you didn't re-run the agent, the page shows
   the demo's scripted decision instead). Click "Open bill in inbox": `bill_HSG-1011` is Disputed with the receipt
   attached. "The agent never approves or pays. A person decides, and the receipt is the audit trail."
7. **2:55 — Close.** "One workflow on a reusable record → learn → act → evidence → approve engine. About $0.19 of API
   per invoice in real mode."
