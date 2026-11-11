# Ramp Teach

**Unofficial demo inspired by Ramp's design. Not affiliated with Ramp. All data is synthetic.**

An AP specialist reviews one staffing vendor's invoice once while narrating, with a Chrome extension recording.
Ramp Teach learns a versioned workflow from that recording, tests it, and when a new invoice arrives in Bill Pay a
routing model picks the workflow and its agent reviews the invoice in a real browser. A person decides.

Three technical pillars, with observability across all of them (details: **[docs/TECHNICAL.md](docs/TECHNICAL.md)**):

- **Voice and recording:** ElevenLabs Scribe v2 transcription with word timing and page-aware key terms, each
  sentence linked to the clicks it is about.
- **Skill and evals:** a six-stage Claude learner with citations to the exact words and clicks, packaged as an Agent
  Skill (Skills API) with check scripts run in Anthropic's code-execution sandbox; eight eval cases and a promotion
  gate decide which version goes live.
- **Execution:** a routing model picks the workflow; the workflow agent drives Chromium through Claude's browser
  tools with live progress notes and a task budget; every fact is re-checked against its page by plain code.
- **Observability:** spans for every model turn and tool call (tokens, cost, Anthropic request IDs), a live view of
  the agent's browser inside the bill page, traces labeled real / scripted / mock / deterministic.

**New to the repo (agent or person)? Start with [docs/HANDOFF.md](docs/HANDOFF.md).** The product film and how to re-make it: [demo/video/README.md](demo/video/README.md), [demo/video/PIPELINE.md](demo/video/PIPELINE.md).
How it works, what is real AI vs scripted vs mock, and the limitations: **[docs/workflow.md](docs/workflow.md)**.
Morning status and a 3-minute demo script: **[MORNING.md](MORNING.md)**.
Two-minute walkthrough video (real app, live Claude run): **[demo/video/ramp-teach-walkthrough.mp4](demo/video/ramp-teach-walkthrough.mp4)**.

## Quick start

```bash
npm install && npm run setup
```

`npm run setup` checks everything (Chromium, ffmpeg, fonts, the API key, tests) and lists any manual steps.

```bash
npm run typecheck && npm test
```

```bash
npm run eval
```

```bash
npm run demo
```

`npm run demo` builds and starts the Next app on :3000, runs the agent on the test invoice `HSG-1011`,
checks the result against the answer key, records one decision through the UI (a scripted stand-in for a
human) and verifies the receipt is attached to the bill. It uses real Claude calls when a key is
visible (`RAMP_ANTHROPIC_API_KEY`, then `ANTHROPIC_API_KEY`), and labeled offline modes otherwise
(`--offline` forces them).

Look around yourself:

```bash
npm run build && npm run start
```

Then open http://localhost:3000. The pages are `/` (overview), `/receipts/HSG-1011` (the review page),
`/portal/login` (fixture vendor portal; demo creds `ap.reviewer` / `demo-only`) and `/bills` (fixture bill inbox).

## Commands

| Command | What it does |
|---|---|
| `npm run learn` | Distill the extension capture `extension/recordings/portal-HSG-1010.json` into `rules/workflow_spec.json` (one Claude call, cached; provenance in `rules/learn_meta.json`) plus `rules/evals.json`. `-- --offline` uses the deterministic distiller; `-- --recording data/recording.sample.json` uses the labeled fallback fixture. |
| `npm run agent -- HSG-1011` | Engine run for one invoice (needs the app running): calc → browser evidence → receipt. `--offline` gives scripted evidence and a mock receipt. |
| `npm run eval` | Correction-derived eval cases (recall) plus a precision guard over all past invoices. |
| `npm run demo` | The end-to-end proof above. Flags: `--offline`, `--relearn`, `--no-build`, `--keep-server`. |
| `npm run record:session` | Play a reviewer session in Chromium with the unpacked recorder extension capturing it. |
| `npx tsx scripts/usage.ts` | Token usage and estimated cost of the real Claude calls recorded in `runtime/usage.jsonl`. |

## Layout

| Path | Contents |
|---|---|
| `contracts/` | Frozen Zod schemas + engine interfaces (`WorkflowDefinition`, `AIProvider`, `BrowserDriver`) |
| `agent/` | Generic engine runner, Playwright driver, browser-use loop, receipt post-pass, Anthropic adapter |
| `workflows/invoice-review/` | The first (and only) workflow on the engine |
| `calc/` | Deterministic checks, with no LLM |
| `learn/`, `rules/` | Distiller, evals; learned spec and eval cases |
| `extension/` | Manifest V3 recorder |
| `app/` | Receipt UI + decision API, fixture vendor portal, fixture bill inbox |
| `data/` | Synthetic vendor, invoices, timecards, corrections, answer key (tests/demo only) |
| `board/` | Build audit trail: tickets, lane outboxes, human decisions |

Stack: Next.js 16 (App Router) · TypeScript · Tailwind v4 · `@anthropic-ai/sdk` (claude-opus-5-5,
`browser_toolset_20260801`) · Playwright · Zod · Vitest · JSON files.
