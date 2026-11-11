# Handoff: pick up Ramp Teach fast

Start here if you are a new agent (or person) on this repo. Read this file, then `CLAUDE.md` (the rules), then the
doc for the area you will touch. Last updated 2026-11-11.

## 0. Claude: do this first

When a person asks you to read this handoff:

1. From the repo root, run:
   ```bash
   npm run setup
   ```
   It installs dependencies if missing, checks Chromium (Playwright), ffmpeg and port 3000, caches the Lausanne
   font for the video renderers, finds the Anthropic key and checks it against the API (free; it never prints the
   key), runs the artifact guard, the typecheck and the tests. `--quick` skips the typecheck and tests.
2. Tell the person, in plain words, what passed and the **MANUAL STEPS FOR A HUMAN** it printed. Usually that is
   only the API key (see "Manual steps" below). Don't ask them to paste the key into chat.
3. Then summarize the current state (§7) and ask what they want to do next.

## Manual steps (only a human can do these)

1. **Anthropic API key**, the only required setting. Never commit it, paste it into chat, or print it. Pick one:
   - Own machine, permanent (outside the repo, so it can't be committed):
     ```bash
     echo 'RAMP_ANTHROPIC_API_KEY=sk-ant-...' > ~/ramp-teach.env && chmod 600 ~/ramp-teach.env
     ```
   - One terminal session: `export RAMP_ANTHROPIC_API_KEY=sk-ant-...`
   - Claude Code cloud session: environment menu in the session title bar → Edit → add the environment variable
     `RAMP_ANTHROPIC_API_KEY`, then restart or resume the session. The network-secrets form doesn't work for
     Anthropic's API.

   Then run `npm run setup` again; it should say the key is accepted. Without a key everything runs in labeled
   offline mode and the film script refuses to shoot. Spend so far: `npx tsx scripts/usage.ts` (a film take is
   about $0.33).
2. **Only if missing** (setup says so): Node 22+, Chromium for Playwright (`npx playwright install chromium`; never on
   a Claude Code cloud machine, it is preinstalled), ffmpeg with libx264 (only for the videos).
3. **GitHub access** to push: the person's own git credentials, or in Claude Code cloud the connected GitHub account.

## 1. What this is (30 seconds)

**Ramp Teach** is a demo of a service-invoice verification agent, made for a Ramp hackathon. It is an
**unofficial demo inspired by Ramp's design**; all data is synthetic. (Per the project owner, Ramp approved using
its look, logo and font for the hackathon.)

An AP reviewer checks one staffing-vendor invoice **once**, narrating, with a Chrome extension recording. Ramp
Teach learns the rules from that recording (one Claude call). When a new invoice arrives, the engine runs
deterministic checks in code, a **Claude browser agent** reads the vendor's timecard portal for evidence, Claude
writes a receipt, and a **human** approves or disputes. The agent never approves or pays.

```
RECORD (MV3 extension) → LEARN (spec + evals) → VERIFY (calc + browser agent) → RECEIPT (Claude) → DECIDE + ATTACH (human)
```

## 2. Where to read next

| You want to… | Read |
|---|---|
| Rules of the repo (lanes, frozen contracts, guardrails, modes) | `CLAUDE.md` |
| How the product works, real vs scripted vs mock, limitations | `docs/workflow.md` |
| Run commands, status, demo script, outstanding work | `README.md`, `MORNING.md` |
| **How the three pillars work (voice, skill + evals, execution, observability)** | **`docs/TECHNICAL.md`** |
| Claude API usage in this repo (model, browser toolset, caching) | `docs/claude-api-notes.md` |
| UI design rules | `docs/design.md` |
| Lane specs from the original build | `docs/lane-spec.md` |
| The product film: what it shows, live vs staged | `demo/video/README.md` |
| The product film: **how to make / edit it** | `demo/video/PIPELINE.md` |
| Build history and decisions | `board/tickets.md`, `board/humans.md`, `board/<lane>.md` |

## 3. Run it

```bash
npm run setup
```

```bash
npm run typecheck && npm test
```

```bash
npm run build && npm run start
```

Then http://localhost:3000:
- `/` overview, `/learn` learned spec, `/receipts/HSG-1011` receipt page
- `/portal/login` vendor portal (login `ap.reviewer` / `demo-only`)
- `/login` → `/bills` Ramp-style Bill Pay, `/agents` Ramp Teach page

End-to-end proof (real Claude calls if a key is present, labeled offline modes otherwise):

```bash
npm run demo
```

Per-step commands: `npm run learn`, `npm run agent -- HSG-1011` (app must be running), `npm run eval`,
`npx tsx scripts/usage.ts` (API cost so far).

## 4. Code map

| Path | What | Notes |
|---|---|---|
| `contracts/` | Frozen Zod schemas + engine interfaces | Change only with a human DECISION line in `board/humans.md`. Import from `@/contracts`. |
| `agent/engine.ts`, `agent/cli.ts` | Engine runner: calc → evidence → receipt | |
| `agent/providers/` | Anthropic adapter, browser-use loop, `browser_toolset_20260801` mapping | `getProvider()` returns null without a key ⇒ offline mode |
| `agent/browser/` | Playwright driver, page outline + `data-agent-ref` stamping, URL policy (localhost only) | |
| `calc/` | The six deterministic checks | **No LLM, ever.** |
| `learn/`, `rules/` | Distiller (recording → workflow spec), evals; learned outputs | |
| `workflows/invoice-review/` | The one workflow on the engine | |
| `extension/` | MV3 recorder (content script, side panel, background, icons) | Ramp-styled side panel; "Send to Ramp" posts to `/api/learn` |
| `app/(site)` | Overview, learn page, receipt page | |
| `app/(vendor)/portal` | Fixture vendor portal (Halcyon Staffing) | |
| `app/(dash)` | Ramp-style shell: login, Bill Pay, Ramp Teach (`/agents`) | `components/dash/*`, `lib/dash.ts` |
| `app/api/*` | decisions, receipts, portal, bills, dash (login/reset/deliver/bills), learn | Human decisions only via `POST /api/decisions` |
| `app/stage-ext/` | Serves real extension files to the film stage | film only |
| `lib/` | paths, validated data loaders, stores, trace, usage ledger, money, cache, dash, learn job | |
| `data/` | Synthetic seed data | `data/answer_key.json` is never read by agent/, learn/ or prompts |
| `lib/speech/`, `app/api/stt/` | ElevenLabs transcription, word ↔ click alignment, key terms, peaks | voice pillar |
| `learn/skill/`, `lib/skills/`, `skills/` | Six-stage skill learner, Agent Skill package, diff, status | skill pillar; only real versions are committed |
| `evals/`, `lib/evals/` | Skill eval cases, graders, runner, gate | `npm run eval:skill` |
| `agent/router.ts`, `agent/spans.ts`, `agent/live.ts`, `agent/evidence-check.ts` | Routing, spans, live view, evidence re-check | execution + observability |
| `app/(dash)/bills/**`, `components/dash/**` | Bill page (Review / Evidence), Workflows tab, recording, run and eval pages | the app |
| `contracts/pillars.ts`, `lib/pillars.ts` | Contracts and shared paths for all of the above | |
| `scripts/` | `demo.ts`, `usage.ts`, `guard-artifacts.ts` | |
| `demo/video/` | Films, their scripts, archived runs | See PIPELINE.md |
| `public/stage/` | Film stage (desktop + Chrome frame) | |
| `board/` | Build audit trail | Append-only outboxes |

Runtime files (gitignored `runtime/`): `bills.json`, `inbox.json`, `agent-jobs.json`, `learn-job.json`,
`recordings/`, `cache/`, `usage.jsonl`.

## 5. Conventions that bite

- **Modes, labeled honestly everywhere:** `real` (a Claude call), `scripted` (fixed Playwright steps), `mock` /
  `deterministic` (no LLM). Never call scripted things AI.
- **Committed run artifacts must be real-mode.** `receipts/`, `runs/HSG-1011/`, `rules/`, `agent/trace.jsonl`,
  `learn/trace.jsonl`. Run `npx tsx scripts/guard-artifacts.ts` before every commit. Never `git add -A` after a run.
- **No destructive git** (no reset --hard, checkout --, clean -f, force-push). To restore a file:
  `git show HEAD:<path> > <path>`.
- **UI copy:** plain words, no em dashes in visible UI text, no jargon.
- **The agent's browser** may reach only localhost fixture pages; no scripts, uploads or other sites; 25-turn cap.
- **Secrets:** never print, log or commit keys. Check presence with `[ -n "$RAMP_ANTHROPIC_API_KEY" ] && echo set`.
- **Commits:** push to branch `claude/pensive-turing-jh6orb`. No PRs unless asked. End commit messages with the
  session's attribution lines.

## 6. Configuration and environment

The **only required** setting is an Anthropic API key. Everything else has a working default.

**Secret (required for real mode)**, first match wins (`config/engine.ts` `resolveAnthropicKey()`):
1. `RAMP_ANTHROPIC_API_KEY` env var
2. `ANTHROPIC_API_KEY` env var
3. a `KEY=VALUE` file at `$HOME/ramp-teach.env` with either name

Never print, log or commit it. Without it: app, learn and agent run in labeled offline modes; `film.ts` refuses a
real take. In a cloud session the user adds it as an environment variable in the environment settings (Anthropic
hosts can't take a key through the network-secrets card).

**Optional env vars**

| Variable | Default | Effect |
|---|---|---|
| `ELEVENLABS_API_KEY` | unset | Speech-to-text (Scribe v2 batch + Realtime tokens). Server-side only; without it the voice path falls back to browser dictation and the demo narration. Network host `api.elevenlabs.io` is allowed in the cloud environment. |
| `TYPESAFE_API_KEY` | unset | Routing with TypeSafe Jev (`api.typesafe.ai`, allowed in the cloud environment). Without it routing uses Claude |
| `RAMP_TEACH_JEV_MODEL` | `jev-latest` | Pin a Jev version, e.g. `jev-1.13.0` |
| `RAMP_TEACH_ROUTER` | unset | `deterministic` forces the code routing path (the product film uses it); `jev` or `claude` forces that model |
| `RAMP_TEACH_ROUTER_MODEL` | `claude-opus-5-5` | Claude routing model (when Jev is not used) |
| `RAMP_TEACH_TASK_BUDGET` | `60000` | Browser-agent task budget in tokens (`0` turns it off) |
| `RAMP_TEACH_LIVE` | on | `0` turns off the live screencast of the agent browser |
| `RAMP_ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | API base URL. Set explicitly because cloud sessions export `ANTHROPIC_BASE_URL` for Claude Code itself. |
| `RAMP_TEACH_MODEL` | `claude-opus-5-5` | Model for learn, browser agent and receipt |
| `RAMP_TEACH_EFFORT` | `medium` | Effort level (`low`…`max`) |
| `RAMP_TEACH_PROVIDER` | `anthropic` | Only provider implemented |
| `RAMP_TEACH_OFFLINE` | unset | `1` forces offline modes |
| `RAMP_TEACH_MAX_TURNS` | `25` | Browser agent turn cap |
| `RAMP_TEACH_NO_CACHE` | unset | `1` bypasses the model-output cache (live calls every time) |
| `RAMP_TEACH_HEADFUL` | unset | `1` shows the agent's browser |
| `RAMP_TEACH_VIEWPORT` | driver default | e.g. `1280x800` for the agent's browser |
| `RAMP_TEACH_RECORD_VIDEO_DIR` | unset | Records the agent's browser video there (film) |
| `RAMP_TEACH_FILM_DIR` | unset | Set on the app server by `film.ts`; per agent job it becomes `RAMP_TEACH_RECORD_VIDEO_DIR` |
| `RAMP_TEACH_ROOT` | repo root | Root for data/runtime paths (tests) |
| `BASE_URL` | `http://localhost:3000` | Where the app runs (agent, demo) |

**Cloud environment "ramp-teach"** (personal, attached to `sahith-p/ramp-teach`):
- Network allowlist: api.anthropic.com, ramp.com, www/demo/app.ramp.com, assets.ramp.com (Lausanne font),
  demo-api.ramp.com, cdn1–4.demo-static.ramp.com, images.squarespace-cdn.com (wallpaper source), plus package
  registries and MCP hosts.
- Setup script: `npm install` in `ramp-teach/` only if `package.json` exists (fixed 2026-11-11 after it failed by
  running npm with no package.json; unproven until a fresh container is built).
- No environment variables stored yet; the API key is the one to add.
- Node's built-in `fetch` ignores the HTTPS proxy unless `NODE_USE_ENV_PROXY=1` (needed for `fetch-fonts.ts`).

**Tools expected on the machine:** Node 22, ffmpeg with libx264, Chromium + Playwright 1.63.0 (preinstalled in
cloud sessions; don't reinstall), system fonts are optional (Inter and JetBrains Mono are committed under
`demo/video/assets/fonts/`).

**Other state worth knowing:** `.claude/worktrees/` held lane worktrees during the original build (gitignored);
`runtime/` is local state (bills, inbox, jobs, recordings, cache, usage ledger) and is safe to delete between runs.

## 7. Current state (2026-11-11)

- Branches: work happens on `claude/pensive-turing-jh6orb`; `main` was fast-forwarded to it on 2026-11-11 at the
  user's request. Keep `main` a fast-forward of the work branch (no force pushes).
- **Pillar build (T-40) merged:** voice (ElevenLabs), skill learner + Skills API, skill evals + gate, routing +
  execution observability, and the new Bill Pay UI (bill page, Workflows tab). 379 tests pass; `next build` passes;
  artifact guard OK. Verified end to end **offline** in the built app (learn → evals → route → agent run → every
  page reviewed). **Not yet verified with real calls** (no key was visible in the building session):
  the six learning stages against Claude, the Skills API upload, code-execution checks, the Claude judge,
  ElevenLabs batch + Realtime, task budget + progress notes + fallbacks in one request. First real-mode session:
  run `npm run setup`, then `npm run skill:learn -- --recording extension/recordings/portal-HSG-1010.json`,
  `npm run eval:skill -- --yes` (prints a cost estimate first), then deliver an invoice in Bill Pay and watch the run.
  Commit only real skill versions and eval runs (the guard enforces it).
- Walkthrough video: `demo/video/ramp-teach-walkthrough.mp4` (old flow).
- **Product film:** the committed `ramp-teach-demo.mp4` is the previous cut (old flow). The film script is being
  re-cut for the new flow (no sign-in, Bill Pay → Workflows learning, routing, the triggered run, live view inside
  the bill page, new diagrams). A real take needs `RAMP_ANTHROPIC_API_KEY` visible:
  ```bash
  npx tsx demo/video/film.ts --phase all
  ```
  Then: check frames, confirm `film-run/usage.jsonl` has `request_id`s, update `demo/video/README.md` and
  `MORNING.md`, run the guard, commit only the intended files, push, fast-forward `main`, send the MP4.
- Owner rules for the film and commits: never show "simulated" on screen or in commit messages; never label a
  non-real step with a real provider's name (just no tag). Disclosure of what is staged lives in
  `demo/video/README.md`'s live-vs-staged table.
- API spend so far ≈ $2.00 total (103 calls) by the usage ledger; a film take ≈ $0.33.

## 8. Outstanding product work

From `MORNING.md`: a genuinely human-recorded session (all recordings so far are scripted or hand-authored);
learning executable checks (today the six checks are hand-written); a Ramp sandbox adapter; auth on the decision API.

## 9. What the user cares about (from the conversation)

- Visuals must look real and polished: Chrome frame must look like real Chrome; Ramp UI should mirror Ramp.
- Diagrams: technical substance with real data, clean, dark, no "slop" (no generic boxes, slogans, callout pills,
  dot grids, overdone motion), no jargon, real logos.
- Honesty: the film's live-vs-staged table must stay true; the observability (traces, request IDs) is the proof
  that the agent work is real, not frontend.
- Keep captions throughout the film (voice-over script), and the `.srt` in sync.
