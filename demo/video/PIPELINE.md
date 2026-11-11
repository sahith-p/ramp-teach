# Product film pipeline: how it is made

Everything needed to re-make, edit or extend `ramp-teach-film.mp4` (the voice-over product film). Read
`demo/video/README.md` for what the film shows and the live-vs-staged table; this file is the **how**.

## One command

```bash
npx tsx demo/video/film.ts --phase all
```

Needs `RAMP_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`) in the environment, ffmpeg with libx264, the preinstalled
Chromium (Playwright), and port 3000 free. Without a key the script **refuses** to shoot. A real take makes live
Claude calls for learning (the six stages), each agent run and each receipt, and by default runs the **real skill
evals** on the learned version (`--evals real`, the learner and the judge on all eight eval recordings, with
`--yes` passed to the evals CLI). The evals cost far more than the rest of the take; `evals/cli.ts` prints its own
estimate into `work-film/evals.log`. Cheaper: `--evals sample:2`. `--evals skip` leaves the version a draft, so
routing falls back to the built-in workflow (the story then no longer shows the learned workflow being picked).

Free rehearsal (no API calls; output goes to `demo/video/work-film/rehearsal.mp4` and its archive to
`work-film/rehearsal-run/`, never over the committed film or `film-run/`):

```bash
npx tsx demo/video/film.ts --phase all --offline
```

Rehearsals use `--evals offline` (plain-code grader, offline learner, gate applied) and leave out the `paraphrase`
case, which the offline keyword grader cannot match; a real take never uses the offline grader (refused).
`--no-build` skips `next build` on rehearsal iterations when the app did not change.

## Phases (`--phase <name>`)

| Phase | What it does | Output (in `demo/video/work-film/`, gitignored) |
|---|---|---|
| `shoot` | Backs up every path a take touches (fresh when they match git; else the earlier backup is reused), `npx next build`, starts `next start` on :3000 (detached, killed by process group) with `RAMP_TEACH_NO_CACHE=1`, `RAMP_TEACH_VIEWPORT=1280x800` and `RAMP_TEACH_ROUTER=deterministic`, resets Bill Pay, then plays the whole take in Playwright on the stage page. At the end it **archives** the take and **restores** the repo (a failed archive in a real take leaves the outputs in place and says so). | `film.webm`, `marks.json`, `film-recording.json`, `evals.log`, `next.log`, `backup/` |
| `archive` | (runs inside `shoot`; standalone only to redo it before a restore) Copies the take's outputs to `film-run/` (real) or `work-film/rehearsal-run/` (rehearsal): see "What a take archives". | `film-run/*` (committed for a real take) |
| `assemble` | Trims pre-roll and fits each wait into a short target (the six learning stages, the agent in the live view, the rest of the run on the run page, the second review). No compositing: the agent's browser is already in the footage, inside the bill page. | `assembled.mp4`, `assemble.json` |
| `outro` | Dark Ramp-style end card (Ramp logo + divider + "Teach", Lausanne), rendered frame by frame. | `outro.mp4` |
| `diagrams` | Renders the four diagrams from `diagrams.ts`, reading the take's archive. | `diag-{voice,skill,execution,trace}.mp4` (+ `.html`) |
| `captions` | Draws the voice-over captions as PNGs and overlays them, then **composes** main + diagrams + outro with 0.5 s crossfades (the eval run is cut out behind diagram 02), and writes the `.srt` voice-over script. Refuses any caption or script line containing banned wording. | `captioned.mp4`, then `../ramp-teach-film.mp4` + `.voiceover.srt` |
| `restore` | Puts the touched paths back as they were before the take (runs inside `shoot`; standalone after a manual `archive`). | — |

`--phase all` = shoot (with archive + restore) → assemble → outro → diagrams → captions.
Post-only re-edits (no new take, free): `--phase assemble` (redoes everything after the shoot), `--phase diagrams`
(re-renders diagrams + recomposes), `--phase captions` (recomposes only). Add `--offline` to re-edit a rehearsal.
They reuse `work-film/`, so they only work in the container that shot the take.

**Always finish with** `npx tsx scripts/guard-artifacts.ts` (must print OK) and `git status` before committing.

## The take (what `shoot` does, in order)

Marks (seconds of film time, saved in `marks.json`) drive captions, cuts and the speed-ups:

`start` → `record_start` (Recorder side panel: Start, voice on) → vendor portal: sign in, invoice HSG-1010, two
timecards, narration lines (each drives the panel's voice visualizer) → `record_stop` (Stop: the panel shows the
word-timed transcript, each sentence linked to its steps) → `record_end` → Send to Ramp → straight into Bill Pay >
Workflows (`/bills/workflows?recording=<id>`, no sign-in) → `learn_start` (learning card, six stages, live) →
`learn_done` → View v1 → Rules tab → `rules` (rule 1 opened: quote, clicked element, eval cases) → its time link →
`recording` (recording page: waveform, transcript lined up with clicks) → `eval_start` (the skill evals run in a
child process; cut in post) → `eval_end` (workflow Evals tab: gate) → Workflows table (active v1) → For approval →
`deliver_1011` → bill page, Review tab → `review` (routing card: workflow chosen, the triggered run) → `agent_on`
(the agent's live frames inside the bill) → `agent_leave` → click the run → `run_open` (Workflows > Runs: the
waterfall) → `result_1011` (a model span's tokens, cost, request id) → Open bill → `evidence` (Evidence tab) →
`dispute` → back to Bills → `deliver_1012` → `ready_1012` → bill → `approve` → Payment required → `end` (fade out).

Diagram slots (`slotsFor()` in `film.ts`): 01 voice at `record_end` (before Send to Ramp); 02 skill from
`eval_start` to `eval_end` (it covers the eval run, which is cut out); 03 execution at `dispute + 2.8`; 04 trace at
`end - 2.9`, then the outro.

## What a take archives (`film-run/` for a real take)

`receipt-HSG-1011.json`, `receipt-HSG-1012.json`, `route-<id>.json`, `spans-<id>.jsonl`, `evidence-check-<id>.json`,
`evidence-HSG-1011/` (field crops the evidence check took), `trace.jsonl` (agent, since t0), `learn-trace.jsonl`,
`decisions.jsonl`, `usage.jsonl` (one line per Claude call, with request ids), `skill/` (the learned version: SKILL.md,
skill.json, stages/, checks/), `eval-run.json`, `learned-workflow_spec.json` + `learned-learn_meta.json` (rules/
as synced from the version when it passed the gate), `sent-recording.json` (what Send to Ramp uploaded, with the
word-timed transcript), `film-recording.json`, `marks.json`, `assemble.json`.

Paths a take touches and `restore` puts back: `TRACKED` (committed receipts, decisions, `runs/HSG-1011/{calc,evidence}.json`,
traces, `rules/*`) and `NEW_OUTPUTS` (`receipts/HSG-1012.json`, `runs/HSG-1011/{route.json,spans.jsonl,evidence-check.json,evidence/}`,
`runs/HSG-1012/`, `skills/halcyon-invoice-review/`, `evals/runs/`). The learned skill version is removed from
`skills/` after the take (it stays in `film-run/skill/`); to keep a real one in the repo, copy it back deliberately.

## Pieces and where they live

| Piece | File(s) | Notes |
|---|---|---|
| Orchestration | `demo/video/film.ts` | All phases. `voiceover()` holds the caption lines, timed off marks; `waitsFor()` the speed-ups; `slotsFor()` the diagram slots. `TRACKED` / `NEW_OUTPUTS` list the paths a take touches. |
| Stage (desktop + Chrome) | `public/stage/index.html`, `public/stage/wallpaper.jpg` | macOS Tahoe wallpaper, no menu bar/dock. Chrome-refresh frame: tab, new-tab button, omnibox, extension icon (Ramp mark on lemon) with REC badge, flat blue "A" avatar, per-site favicon, side panel (388 px, inset card). The app runs in a same-origin iframe. The URL bar shows fake demo domains: `/portal/*` → `portal.halcyonstaffing.demo`, `/bills…`, `/login`, `/agents` → `app.rampteach.demo`. No agent window: the agent's browser is the live view inside the bill page. API on `window.stage`: `go, fadeIn, fadeOut, move, press, say, unsay, openPanel, closePanel, openInMain, rect, back, href, urlChange`. |
| Real extension in the stage | `app/stage-ext/[...path]/route.ts`, `public/stage/chrome-shim.js` | Serves the **real** `extension/sidepanel.*`, `content.js`, `lib/recording.js`. `chrome-shim.js` stands in for `chrome.*` (storage, runtime messages, tabs.create → `stage.openInMain`). Narration reaches the panel through a stand-in `SpeechRecognition` (`window.__ext.speak`), which also drives the panel's voice visualizer; at Stop the panel asks `/api/stt` for the scripted narration transcript (word timings from the narration steps, aligned to the clicks). The panel shows no provider name for it. `window.__RT_OPERATOR="scripted_playwright"` labels the recording honestly. |
| Bill Pay | `app/(dash)/bills/**`, `components/dash/**`, `lib/dash.ts`, `app/api/{dash,runs,teach,learn,stt}/*` | Bill page tabs Overview / Review / Evidence / Activity; Review = routing card + the triggered run + live view (frames from `runs/<id>/live/frame.jpg`, the agent's CDP screencast) + steps. Workflows tab with the learning card; workflow page tabs (Rules, Recordings, Runs, Evals, Versions); run page waterfall; recording page. `POST /api/dash/reset` hides invoices; `POST /api/dash/deliver` makes one arrive and spawns `agent/cli.ts` (route → run). |
| Diagrams | `demo/video/diagrams.ts`, `demo/video/diagram-assets/` | Four HTML/CSS scenes rendered frame by frame, reading the take's archive at render time (`setRunDir`). The login screenshot, its element boxes and the page outline are from an earlier live take. |
| Captions | `film.ts` `captions()` | Caption PNGs in the stage subtitle style (Inter 500 30px, dark pill), alpha-faded overlays. Diagram captions are inside the diagram renders. |
| Outro | `film.ts` `outro()` | Dark `#121211`, white logo + divider + "Teach". No tagline, no underline (by request). |

## The four diagrams (`diagrams.ts`)

| Id | Shows | Data |
|---|---|---|
| `voice` (01, 13 s) | The transcript with one sentence expanded word by word with start times, the recorded steps it is linked to, and words and clicks on one time axis | `sent-recording.json` (its `speech`; else its narration aligned by `lib/speech`) |
| `skill` (02, 16 s) | The six learning stages with their times, one rule with its quote and clicked element, the other rules, the skill package, the eight eval recordings, the graders, the promotion gate (thresholds from `GATE`) | `skill/skill.json`, `skill/` files, `evals/cases/`, `eval-run.json` (scores shown **only** for a real eval run of that version) |
| `execution` (03, 16 s) | Routing (candidates, chosen workflow), the portal page with refs, what the agent reads, what it can't do, its tool calls turn by turn, the facts read again by plain code | `route-HSG-1011.json`, `trace.jsonl` (real tool calls when the take has them, else the earlier live take's), `evidence-check-HSG-1011.json` |
| `trace` (04, 14 s) | Trace lines with their mode (learning, route, agent, evidence check, receipt, decision), Claude calls per part of the take with tokens and cost, request ids, the run's spans on a time axis | `learn-trace.jsonl`, `trace.jsonl`, `route-HSG-1011.json`, `spans-HSG-1011.jsonl`, `usage.jsonl`, `decisions.jsonl`, `marks.json` |

The Claude mark appears on a panel only when the data in it came from Claude (`mode: "real"`).

## Assets (all in the repo, except one font)

| Asset | Where | License / source |
|---|---|---|
| Inter (400, 500): captions | `demo/video/assets/fonts/inter/` | SIL OFL 1.1 (license file alongside) |
| JetBrains Mono (400, 500, italic): code and log lines in diagrams | `demo/video/assets/fonts/jetbrains-mono/` | Apache 2.0 / OFL (license file alongside) |
| Lausanne (300, 400, 700): Ramp's typeface | **not committed**; `demo/video/assets/fonts/lausanne/` is a gitignored cache | Commercial typeface licensed to Ramp. `npm run setup` fetches it (or `NODE_USE_ENV_PROXY=1 npx tsx demo/video/fetch-fonts.ts`); without the cache, renderers load it from `assets.ramp.com` (allowed by the environment's network list). The app and extension always load it from there. |
| Claude mark | `demo/video/assets/logos/claude.svg` (also inline in `diagrams.ts`) | Simple Icons `claude`, CC0 |
| Ramp logo + mark | `demo/video/assets/logos/ramp-logo.svg`, `ramp-mark.svg`; source of truth `components/dash/RampLogo.tsx` | Ramp's; used with Ramp's approval for the hackathon (per the project owner) |
| Halcyon mark (fictional vendor) | `demo/video/assets/logos/halcyon-mark.svg`; source `components/fixtures/HalcyonLogo.tsx` | Original artwork for this demo |
| Extension icon (Ramp mark on lemon) | `extension/icons/` (svg + 16/32/48/128 png); copy in `assets/logos/` | Made for this demo |
| Desktop wallpaper (macOS Tahoe) | `public/stage/wallpaper.jpg` | Downloaded once from the image URL the user provided |
| Diagram screenshots + data | `demo/video/diagram-assets/` | Captured from this app; data from a real take |

`demo/video/fonts.ts` builds the `@font-face` CSS for every renderer (diagrams, outro, caption PNGs), embedding
the local font files as data URIs so pages loaded with `setContent` need no server.

## Deterministic animation rendering (diagrams, outro)

Pages use plain CSS animations with delays. The renderer pauses every animation via the Web Animations API and
seeks `currentTime` per frame (30 fps), screenshots each frame, then ffmpeg encodes. This makes the result exact
and independent of machine speed. To preview without encoding, `renderDiagram(d, "", dir, logos, { stills: [t1, t2] })`
writes `still-<id>-<t>.png` (see the pattern in the git history / ask: a tiny tsx script that imports `DIAGRAMS`).

Diagram style rules the user signed off on (keep them):
- Dark `#121211` background with sparse faint "+" marks (no dot grid, no glowing dots).
- Lausanne for text, JetBrains Mono (system font) for code/log lines; lemon `rgb(228,242,34)` only for the one
  thing that matters in a frame; red `rgb(255,122,107)` only for "fail".
- Show the real mechanism with real data (screenshots, selectors, page outline with refs, tool calls, trace lines).
  No generic boxes-and-arrows, no lemon callout pills, no slogans ("every claim needs a source" was rejected).
- Plain words in labels and captions; no jargon. Light motion only: fade-and-rise, rows in order, a few lines
  drawing in.
- Real logos only: Claude mark = Simple Icons `claude` path (CC0, `#D97757`); Ramp mark from `RampLogo.tsx`.

## Changing things

- **Caption text / timing:** edit `voiceover()` in `film.ts`, then `--phase captions` (same container) or a new take.
- **A diagram:** edit `diagrams.ts`, preview stills, then `--phase diagrams`.
- **New screenshots for diagrams:** start the app (`npx next start -p 3020`), capture at viewport 1100×720,
  deviceScaleFactor 2, record element boxes with `locator.boundingBox()` into `diagram-assets/boxes.json`.
- **Stage look (Chrome frame, icons):** edit `public/stage/index.html` → needs a **new take** (it is in the footage).
- **Dashboard or extension UI:** edit the app/extension → new take (`shoot` always rebuilds Next first).

## Gotchas (all learned the hard way)

1. **Never `git add -A` after a take or rehearsal.** A take overwrites committed receipts/traces/rules; `restore`
   puts them back. Commit only the files you mean, and run `scripts/guard-artifacts.ts`. Twice in the past a
   rehearsal's mock outputs got committed over the real ones.
2. **No key ⇒ no real take.** The session's environment must carry `RAMP_ANTHROPIC_API_KEY`. Check with
   `[ -n "$RAMP_ANTHROPIC_API_KEY" ] && echo set` (never print the value). Anthropic hosts can't be given a key via
   the network-secrets card; it must be an environment variable set by the user in the environment settings.
3. **If a take fails**, `shoot` does not archive it and restores the repo from its backup. If a take is killed
   outright, run `--phase restore` (it uses `work-film/backup/`); without a backup, restore tracked files with
   `git show HEAD:<path> > <path>` (no `git checkout --`; destructive git is banned here) and delete the
   `NEW_OUTPUTS` paths.
4. **Stale build:** the take films whatever `.next` holds; `shoot` always runs `next build` for that reason.
5. **Port 3000 stuck:** a leftover `next-server` keeps the port. `pkill -f next-server`.
6. **Click targets in the stage:** the panel is an iframe; scroll buttons into view (`scrollIntoViewIfNeeded`). Use the
   UI's test ids (`[data-testid="dispute"]`, `[data-testid="run-link"]`, `[data-testid="bill-tabs"] [data-tab="evidence"]`)
   and scope back links to the page (`[data-testid="bill-page"] a[href="/bills"]`), or they hit the sidebar.
7. **Learn cache:** `RAMP_TEACH_NO_CACHE=1` is set for takes so the learn and receipt calls are live (traces say
   `cache_hit: false`).
8. **Work dir is per container.** `work-film/` (raw footage) is gitignored; a new container must reshoot.
9. **Honesty labels:** the operator is scripted Playwright, the voice is the scripted narration path (no microphone,
   no speech model), routing uses its plain-code path, the decisions are scripted stand-ins through the real decision
   API. The README's live-vs-staged table must stay true. On screen the scripted voice carries no provider name, and
   no caption, diagram or UI text may call anything "simulated" (`captions` and `diagrams` refuse it).
10. **The eval gate decides the story.** Routing only picks active workflows; if the learned version fails the gate
   the take stops (before the agent runs) and says so. Read `work-film/evals.log`.

## Observability (what proves it is not just frontend)

- `learn/trace.jsonl`: `skill.start` → one line per stage (`skill.segment` … `skill.package`: model, request id,
  `cache_hit`, ms) → `skill.done` (rules, pages, checks, stage modes).
- `runs/<id>/route.json` + the `route.*` trace lines: the routing decision (workflow, version, confidence, reason,
  candidates, mode).
- `runs/<id>/spans.jsonl`: one span per model turn, tool call, calc, evidence check and synthesis (tokens, cost,
  request ids); the run page's waterfall. `runs/<id>/evidence-check.json`: each fact re-read from its page.
- `agent/trace.jsonl`: per run: calc results → spec loaded → each `browser.action` Claude chose (per turn) →
  `browser.evidence` facts with their source page → `browser.done` → calc with evidence → `synthesis.done` →
  `receipt.written`. Every line has `mode`: `real` (Claude), `deterministic` (code), `scripted`, `mock`.
- `runtime/usage.jsonl`: one line per Claude call with tokens, plus Anthropic `request_id` and `message_id`
  (since commit cef405e), which match Anthropic's own logs. `npx tsx scripts/usage.ts` sums cost.
- `receipts/decisions.jsonl`: the human decision.
- Per take, all of the above is archived in `demo/video/film-run/`; diagrams 02 to 04 show it on screen.
