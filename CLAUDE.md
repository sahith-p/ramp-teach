# Ramp Teach — agent conventions

Service-invoice verification agent demo. **Unofficial demo inspired by Ramp's design** — synthetic data only.
One reusable core engine: **RECORD → LEARN → BROWSER ACTIONS → EVIDENCE → APPROVAL**.
Invoice review (`src/workflows/invoice-review/`) is the first workflow on it. Not a multi-workflow
or multi-provider platform: one workflow, one provider adapter (Anthropic), behind thin interfaces.

Handoff for a new agent: **`docs/HANDOFF.md`**. If asked to read it, run `npm run setup` first and tell the person the manual steps it prints (usually just the API key). Product demo video: `docs/ramp-teach-demo.mp4` (its production tooling is kept outside the repo).

## Stack (fixed)
Next.js 16 App Router + TypeScript + Tailwind v4 · `@anthropic-ai/sdk` · Playwright 1.63.0 (pinned to the
preinstalled Chromium) · Zod 4 · Vitest · JSON files (no DB) · Manifest V3 extension.
App code lives in `src/`; path alias `@/` = `src/` (and `@/samples` = `samples/`). `npm run typecheck`, `npm test`.

## Lane map — no agent edits files outside its lane
| Lane / agent | Ticket | Owns (write access) |
|---|---|---|
| orchestrator | T-0x, T-3x | `src/contracts/`, `src/config/`, `src/lib/`, `src/components/ui/`, `src/app/layout.tsx`, `src/app/globals.css`, `package.json` + lockfile, all configs, `scripts/`, `docs/`, `README.md`, `CLAUDE.md`, `docs/board/tickets.md`, `.claude/` |
| data-builder | T-10 | `data/**` |
| calc-builder | T-11 | `src/calc/**` |
| fixture-builder | T-12 | `src/app/portal/**`, `src/app/bills/**`, `src/app/api/portal/**`, `src/app/api/bills/**`, `src/components/fixtures/**` |
| ui-builder | T-13 | `src/app/page.tsx`, `src/app/receipts/**`, `src/app/api/decisions/**`, `src/app/api/receipts/**`, `src/components/receipt/**`, `samples/**` |
| recorder-builder | T-14 | `extension/**` |
| learn-builder | T-20 | `src/learn/**`, `rules/**`, `src/workflows/invoice-review/learn.ts`, `src/workflows/invoice-review/evals.ts` (+ their tests) |
| agent-builder | T-21 | `src/agent/**`, `src/workflows/registry.ts`, `src/workflows/invoice-review/**` except learn.ts/evals.ts |

Every lane may append to **its own** outbox `docs/board/<lane>.md`. Need a dependency, a shared-file change,
or a contract change? Post a QUESTION in your outbox and work around it — never edit another lane's files.
Lanes must not change `package.json`; ask the orchestrator for new deps.

## Frozen interfaces (change only with a human DECISION line in docs/board/humans.md)
- `src/contracts/core.ts` — Invoice, Receipt, Recording, WorkflowSpec, Bill (from the spec).
- `src/contracts/supporting.ts` — CHECK_NAMES, labor-line format, VendorProfile, Timecard, Correction, AnswerKey,
  CalcReport, EvidenceBundle, TraceEvent, EvalCase, DecisionRecord, LearnMeta, id helpers.
- `src/contracts/evidence.ts` — evidence pointer grammar (`data/…`, `rules/…`, `calc:<check>`, `fixture:/…`).
- `src/contracts/engine.ts` — BrowserDriver, AIProvider, WorkflowDefinition, EvidenceTask, RunContext.
Import everything from `@/contracts`.

## Key conventions
- Labor line description: `Labor: <Employee Name> (<Role>) - week ending YYYY-MM-DD`. Anything else is a non-labor charge.
- IDs: receipt id `rcpt_<invoice_id>`, bill id `bill_<invoice_id>` (`receiptIdFor`, `billIdFor`).
- Files: seed data `data/` (committed, read-only at runtime) · learned rules `rules/` · receipts `receipts/<invoice_id>.json` ·
  decisions `receipts/decisions.jsonl` (decision API only) · live bill state `runtime/bills.json` (gitignored, from `data/bills.json`) ·
  per-run artifacts `runs/<invoice_id>/` (calc.json, evidence.json, screenshots/) · trace `src/agent/trace.jsonl`.
- Shared helpers: `src/lib/paths.ts`, `src/lib/data.ts` (validated loaders), `src/lib/store/{receipts,bills,decisions}.ts`, `src/lib/trace.ts`, `src/lib/money.ts`.
- `data/answer_key.json` is **never** read by src/agent/, src/learn/, the provider, or the review prompt. Tests and `scripts/demo.ts` only.
- Fixture app (portal + bill inbox + receipt UI) runs on Next at `BASE_URL` (default http://localhost:3000). Lane dev ports:
  fixture 3011, ui 3012, recorder 3013, agent 3014, learn 3015.
- UI: follow `docs/design.md`; reuse `src/components/ui/*`. Every page carries the demo label (layout does it).
- Claude API usage: read `docs/claude-api-notes.md` first. Provider selection: `src/agent/providers/index.ts getProvider()`
  (null ⇒ no credentials ⇒ labeled offline mode). Config in `src/config/engine.ts`.

## Modes — label honestly, everywhere (trace, receipts, UI, docs)
- `real` — a Claude call produced/decided it (learn distillation, browser actions, receipt synthesis).
- `scripted` — fixed Playwright steps (fixture login, opening invoice N, offline evidence). Never called AI.
- `mock` / `deterministic` — no LLM (deterministic distiller, deterministic receipt mapper, calc).
The calc path is ALWAYS deterministic: no LLM anywhere in `src/calc/`.

## Guardrails
Stay inside this repo. No global installs, sudo, deploys, purchases, or submissions. No destructive git
(no reset --hard, clean -f, branch -D, checkout --, force-push). Never write secrets to committed files.
The agent's browser may reach only localhost fixture pages. The agent never approves, pays, submits,
or attaches; human decisions go only through `POST /api/decisions`.

## Board protocol
- `docs/board/tickets.md` — orchestrator only. `docs/board/humans.md` — humans only (DECISION lines).
- `docs/board/<lane>.md` — that lane's append-only outbox:
  `[ISO timestamp] <agent> | <TYPE> | <ticket> | <note>` with TYPE ∈ CLAIM, STATUS, DONE (with evidence), BLOCKED (with reason), QUESTION.
- Lanes work in git worktrees; nothing is visible to main until the orchestrator merges. Commit early and often on your branch.

## Worktree setup (lanes)
Worktrees have no node_modules. First command in a lane worktree: `ln -s /home/user/ramp-teach/node_modules node_modules`.
Do not run `npm install` in a worktree. In a worktree, run Next with `--webpack` (`npx next dev --webpack -p <lane port>`, `npx next build --webpack`): Turbopack refuses the symlinked node_modules. Main uses plain `next build`.
