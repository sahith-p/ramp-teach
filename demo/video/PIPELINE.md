# Product film pipeline: how it is made

Everything needed to re-make, edit or extend `ramp-teach-film.mp4` (the voice-over product film). Read
`demo/video/README.md` for what the film shows and the live-vs-staged table; this file is the **how**.

## One command

```bash
npx tsx demo/video/film.ts --phase all
```

Needs `RAMP_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`) in the environment, ffmpeg with libx264, the preinstalled
Chromium (Playwright), and port 3000 free. A real take costs about **$0.33** (19 Claude calls). Without a key the
script **refuses** to shoot (it used to fall back to offline mode silently and film a fake run).

Free rehearsal (no API calls; output goes to `demo/video/work-film/rehearsal.mp4`, never over the committed film):

```bash
npx tsx demo/video/film.ts --phase all --offline
```

## Phases (`--phase <name>`)

| Phase | What it does | Output (in `demo/video/work-film/`, gitignored) |
|---|---|---|
| `shoot` | Backs up committed run artifacts, `npx next build`, starts `next start` on :3000 (detached, killed by process group), resets dashboard state, then plays the whole take in Playwright on the stage page. The agent runs are **real** (spawned by the app with `npx tsx agent/cli.ts`). | `film.webm`, `marks.json`, `film-recording.json`, `agent/<job>/…webm` (the agent's own browser video), `video-start.json` |
| `archive` (auto after a real shoot) | Copies the take's outputs to `demo/video/film-run/`: receipts, `trace.jsonl` (agent, since t0), `learn-trace.jsonl`, `decisions.jsonl`, learned `workflow_spec`/`learn_meta`, `usage.jsonl` (API ledger), `sent-recording.json` (what Send to Ramp uploaded), marks. | `demo/video/film-run/*` (committed) |
| `assemble` | Composites the agent's own browser video into the stage's "agent window" by wall-clock offset, speeds up the two waits (learning, second invoice) 5×, trims pre-roll. | `assembled.mp4`, `assemble.json` |
| `outro` | Dark Ramp-style end card (Ramp logo + divider + "Teach", Lausanne), rendered frame by frame. | `outro.mp4` |
| `diagrams` | Renders the four technical diagrams from `diagrams.ts`. | `diag-{record,agent,review,trace}.mp4` |
| `captions` | Draws the voice-over captions as PNGs and overlays them, then **composes** main + diagrams + outro with 0.5 s crossfades, and writes the `.srt` voice-over script. | `captioned.mp4`, then `../ramp-teach-film.mp4` + `.voiceover.srt` |
| `restore` | Puts the repo's committed run artifacts back (the take overwrote them). | — |

`--phase all` = shoot → archive → assemble → outro → diagrams → captions → restore.
Post-only re-edits (no new take, free): `--phase assemble` (redoes everything after the shoot), `--phase diagrams`
(re-renders diagrams + recomposes), `--phase captions` (recomposes only). They reuse `work-film/`, so they only
work in the container that shot the take.

**Always finish with** `npx tsx scripts/guard-artifacts.ts` (must print OK) before committing.

## The take (what `shoot` does, in order)

Marks (seconds of film time, saved in `marks.json`) drive captions, cuts and the speed-ups:

`start` → `record_start` → (vendor portal: login, invoice HSG-1010, two timecards, narration) → `record_end` →
Send to Ramp → Ramp sign-in → `learn_start` → (live learn call) → `learn_done` → Bills → `deliver_1011` → `agent_on`
(agent window overlay) → `agent_off` → `result_1011` → Dispute → close drawer → `deliver_1012` → `fast_start` →
`fast_end` → Approve → "Payment required" tab → `end` (fade out).

Diagram cut points (in `captions()`, `slots`): after `record_end`, at `learn_done+5.9` (before Bills), at
`deliver_1012-0.3` (after the dispute), at `end-2.9` (then the outro).

## Pieces and where they live

| Piece | File(s) | Notes |
|---|---|---|
| Orchestration | `demo/video/film.ts` | All phases. `voiceover()` holds the 16 caption lines, timed off marks. `TRACKED` / `NEW_OUTPUTS` list the artifacts a take touches. |
| Stage (desktop + Chrome) | `public/stage/index.html`, `public/stage/wallpaper.jpg` | macOS Tahoe wallpaper, no menu bar/dock. Chrome-refresh frame: tabs, omnibox, extension icon (Ramp mark on lemon) with REC badge, flat blue "A" avatar, per-site favicon, side panel (388 px, inset card). The app runs in a same-origin iframe. The URL bar shows fake demo domains: `/portal/*` → `portal.halcyonstaffing.demo`, `/bills`, `/login`, `/agents` → `app.rampteach.demo`. API on `window.stage`: `go, fadeIn, fadeOut, move, press, say, unsay, openPanel, closePanel, openInMain, rect, back, href, urlChange, agentWindow, agentUrl, agentContentRect`. |
| Real extension in the stage | `app/stage-ext/[...path]/route.ts`, `public/stage/chrome-shim.js` | Serves the **real** `extension/sidepanel.*`, `content.js`, `lib/recording.js` (allowlist). `chrome-shim.js` stands in for `chrome.*` (storage, runtime messages, tabs.create → `stage.openInMain`, speech). The background worker is replaced by `window.__ext` using `extension/lib/recording.js`. Narration reaches the panel through a stand-in `SpeechRecognition` (`window.__ext.speak`). `window.__RT_OPERATOR="scripted_playwright"` labels the recording honestly. |
| Ramp-style dashboard | `app/(dash)/{login,bills,agents}`, `components/dash/*`, `lib/dash.ts`, `app/api/dash/*` | Bill Pay mirror (Ramp logo in `components/dash/RampLogo.tsx`, Lausanne from `assets.ramp.com`). State in `runtime/inbox.json` (hidden/arrived invoices) and `runtime/agent-jobs.json`. `POST /api/dash/reset` hides invoices; `POST /api/dash/deliver` makes one arrive and spawns the agent. `/agents` = Ramp Teach page that runs learning (`POST /api/learn` → `lib/learnjob.ts` → `learn/cli.ts --recording-file … --operator`). |
| Agent footage | env `RAMP_TEACH_FILM_DIR` on the server → per job `RAMP_TEACH_RECORD_VIDEO_DIR`, `RAMP_TEACH_VIEWPORT=1280x800` | The agent's own Playwright browser is video-recorded; `assemble` overlays it into the agent window rect (`agent-rect.json`). |
| Diagrams | `demo/video/diagrams.ts`, `demo/video/diagram-assets/` | HTML/CSS scenes rendered frame by frame. 01–03 use real material from an earlier live take: portal screenshots + element boxes (`boxes.json`), `source-recording.json`, `source-trace-HSG-1011.jsonl`, `source-receipt-HSG-1011.json`. 04 (observability) reads **this take's** `film-run/` traces at render time (rows, calls per step, cost from `usage.jsonl`, request IDs). |
| Captions | `film.ts` `captions()` | Caption PNGs in the stage subtitle style (Inter 500 30px, dark pill), alpha-faded overlays. Diagram captions are inside the diagram renders. |
| Outro | `film.ts` `outro()` | Dark `#121211`, white logo + divider + "Teach". No tagline, no underline (by request). |

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
3. **If a take goes wrong, kill it before `archive`/`restore`** or it will archive junk over `film-run/`. Then restore
   tracked files with `git show HEAD:<path> > <path>` (no `git checkout --`; destructive git is banned here) and
   delete `receipts/HSG-1012.json` and `runs/HSG-1012/`.
4. **Stale build:** the take films whatever `.next` holds; `shoot` always runs `next build` for that reason.
5. **Port 3000 stuck:** a leftover `next-server` keeps the port. `pkill -f next-server`.
6. **Click targets in the stage:** the panel is an iframe; scroll buttons into view (`scrollIntoViewIfNeeded`). Scope
   selectors to the drawer (`[data-testid="bill-drawer"] footer button:has-text("Dispute")`), or they hit the
   "Disputed" tab.
7. **Learn cache:** `RAMP_TEACH_NO_CACHE=1` is set for takes so the learn and receipt calls are live (traces say
   `cache_hit: false`).
8. **Work dir is per container.** `work-film/` (raw footage) is gitignored; a new container must reshoot.
9. **Honesty labels:** the operator is scripted Playwright, the narration uses a stand-in speech recognizer, the
   decisions are scripted stand-ins through the real decision API. The README's live-vs-staged table must stay true.

## Observability (what proves it is not just frontend)

- `learn/trace.jsonl`: load_recording (steps, narration, operator) → `distill.real` (model, `cache_hit`, tokens, rules).
- `agent/trace.jsonl`: per run: calc results → spec loaded → each `browser.action` Claude chose (per turn) →
  `browser.evidence` facts with their source page → `browser.done` → calc with evidence → `synthesis.done` →
  `receipt.written`. Every line has `mode`: `real` (Claude), `deterministic` (code), `scripted`, `mock`.
- `runtime/usage.jsonl`: one line per Claude call with tokens, plus Anthropic `request_id` and `message_id`
  (since commit cef405e), which match Anthropic's own logs. `npx tsx scripts/usage.ts` sums cost.
- `receipts/decisions.jsonl`: the human decision.
- Per take, all of the above is archived in `demo/video/film-run/`; diagram 04 shows it on screen.
