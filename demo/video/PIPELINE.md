# Product film pipeline: how it is made

Everything needed to re-make, edit or extend `ramp-teach-film.mp4` (the voice-over product film). Read
`demo/video/README.md` for what the film shows and the live-vs-staged table; this file is the **how**.

## One command

```bash
npx tsx demo/video/film.ts --phase all
```

Needs `RAMP_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`) in the environment, ffmpeg with libx264, the preinstalled
Chromium (Playwright), and port 3000 free. Without a key the script **refuses** to shoot. A real take makes live
Claude calls for learning (the six stages), each agent run and each receipt. The skill evals that promote the
learned version use the **fast plain-code path** by default (`--evals fast`: offline learner, keyword grader, the
`paraphrase` case left out, gate applied), the same path rehearsals use, so the take does not wait for the live
evals (owner decision). `--evals real` runs the live evals instead (learner + Claude judge on all eight
recordings, `--yes` passed; `evals/cli.ts` prints its estimate into `work-film/evals.log`), `--evals sample:2` a
cheaper live sample. `--evals skip` leaves the version a draft, so routing falls back to the built-in workflow.

The finished film is fitted to **about 3:00** (`--target 180`, seconds): assemble speeds up the waits (learning,
the agent in the live view, the run page, the second review) and, only when needed, the footage holds (up to
1.35x) just enough for the film to land on the target; it never cuts a section.

Free rehearsal (no API calls; output goes to `demo/video/work-film/rehearsal.mp4` and its archive to
`work-film/rehearsal-run/`, never over the committed film or `film-run/`):

```bash
npx tsx demo/video/film.ts --phase all --offline
```

Rehearsals write their master take to `work-film/master/`, never to `demo/video/master/`.
`--no-build` skips `next build` on rehearsal iterations when the app did not change.

## Change a screen or a caption without refilming (post only)

Everything that is not recorded app footage is rebuilt from two committed things: the **master take**
(`demo/video/master/take.mp4` + `take.json`: the assembled footage with no captions and no screens, its marks,
speed-ups, slots and t0) and the **take's archive** (`demo/video/film-run/`). So in any container, with no take,
no API calls and no raw footage:

1. Edit the screen in `demo/video/diagrams.ts` (a section's body or its `captions`), or a footage caption in
   `voiceover()` in `demo/video/film.ts`.
2. Preview: render stills of one section (see "Deterministic animation rendering" below).
3. `npx tsx demo/video/film.ts --phase post` writes `demo/video/ramp-teach-film.mp4` + `.voiceover.srt`.
4. `npx tsx scripts/guard-artifacts.ts`, `git status`, commit the source change and the two outputs.

Only a change to the **recorded app footage** (the dashboard, the extension, the stage page, the take's clicks
or timing) needs a new take. `--phase post --offline` does the same for a rehearsal (from `work-film/master/` and
`work-film/rehearsal-run/`).

## Phases (`--phase <name>`)

| Phase | What it does | Output (in `demo/video/work-film/`, gitignored) |
|---|---|---|
| `shoot` | Backs up every path a take touches (fresh when they match git; else the earlier backup is reused), `npx next build`, starts `next start` on :3000 (detached, killed by process group) with `RAMP_TEACH_NO_CACHE=1`, `RAMP_TEACH_VIEWPORT=1280x800` and `RAMP_TEACH_ROUTER=deterministic`, resets Bill Pay, then plays the whole take in Playwright on the stage page. At the end it **archives** the take and **restores** the repo (a failed archive in a real take leaves the outputs in place and says so). | `film.webm`, `marks.json`, `film-recording.json`, `evals.log`, `next.log`, `backup/` |
| `archive` | (runs inside `shoot`; standalone only to redo it before a restore) Copies the take's outputs to `film-run/` (real) or `work-film/rehearsal-run/` (rehearsal): see "What a take archives". | `film-run/*` (committed for a real take) |
| `assemble` | Trims pre-roll, cuts the eval wait and fits the other waits so the film lands on `--target` (the six learning stages, the agent in the live view after 4.5 s at real speed, the rest of the run on the run page, the second review; then, only if still too long, the footage holds up to 1.35x). Writes the **master take**: H.264 crf 21, no captions, no screens, plus `take.json`. Then runs `post`. | `demo/video/master/take.{mp4,json}` (real take, committed) or `work-film/master/` (rehearsal) |
| `post` | From the master take + the archive only: renders the eight screens of `diagrams.ts` (intro, the five technical sections, close, outro), burns the footage captions, **composes** intro + (footage part + screen) x 5 + close + outro with 0.5 s crossfades, and writes the `.srt`. Refuses banned wording (`BANNED` in `diagrams.ts`: the owner's banned word, em dash, middle dot, the approximately sign) in any screen, caption or script line. `diagrams` and `captions` are other names for it. | `work-film/post/` (intermediates), then `ramp-teach-film.mp4` + `.voiceover.srt` |
| `restore` | Puts the touched paths back as they were before the take (runs inside `shoot`; standalone after a manual `archive`). | — |

`--phase all` = shoot (with archive + restore) → assemble (master) → post.

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

Edit order (`slotsFor()` in `film.ts`): intro card, footage, `record` (Recording and Transcription) at
`record_end`, footage (Send to Ramp lands in Workflows), `overview` (Architecture) at `learn_start`, footage
(learning, rules, recording page), `learning` (Agent Learning) from `eval_start` to `eval_end` (covers the eval
run, cut out), footage (Evals tab, HSG-1011 to Dispute), `execution` (Agent execution and evaluation, the run) at
`dispute + 2.8`, footage (HSG-1012, Approve), `evaluation` (Agent execution and evaluation, evals, trace, cost) at
`end - 2.9`, close card, outro.

## What a take archives (`film-run/` for a real take)

`receipt-HSG-1011.json`, `receipt-HSG-1012.json`, `calc-<id>.json` (calc's findings with the credit amounts),
`route-<id>.json`, `spans-<id>.jsonl`, `evidence-check-<id>.json`,
`evidence-HSG-1011/` (field crops the evidence check took), `trace.jsonl` (agent, since t0), `learn-trace.jsonl`,
`decisions.jsonl`, `usage.jsonl` (one line per Claude call, with request ids), `skill/` (the learned version: SKILL.md,
skill.json, stages/, checks/), `eval-run.json`, `learned-workflow_spec.json` + `learned-learn_meta.json` (rules/
as synced from the version when it passed the gate), `sent-recording.json` (what Send to Ramp uploaded, with the
word-timed transcript), `film-recording.json`, `marks.json`, `assemble.json`, `eval-replay.txt` + `.json` (the
correction replay, `npm run eval`, as of the take).

Paths a take touches and `restore` puts back: `TRACKED` (committed receipts, decisions, `runs/HSG-1011/{calc,evidence}.json`,
traces, `rules/*`) and `NEW_OUTPUTS` (`receipts/HSG-1012.json`, `runs/HSG-1011/{route.json,spans.jsonl,evidence-check.json,evidence/}`,
`runs/HSG-1012/`, `skills/halcyon-invoice-review/`, `evals/runs/`).

**What a real take leaves in the repo** (owner decision): the learned skill version (`skills/halcyon-invoice-review/`)
and `rules/workflow_spec.json` + `rules/learn_meta.json` as synced from it, so the repo's active workflow is the one
the film shows. The fast eval run is **not** kept in `evals/runs/` (the artifact guard only allows real eval runs);
it is archived as `film-run/eval-run.json`, where the screens read it. With `--evals real|sample:N` the real eval run
is kept too. Everything else is restored. Rehearsals keep nothing. Commit the kept paths (and `demo/video/master/`,
`film-run/`, the film and its `.srt`) before shooting another take, or the next take's backup will not match git.

## Pieces and where they live

| Piece | File(s) | Notes |
|---|---|---|
| Orchestration | `demo/video/film.ts` | All phases. `voiceover()` holds the caption lines, timed off marks; `waitsFor()` the speed-ups; `slotsFor()` the diagram slots. `TRACKED` / `NEW_OUTPUTS` list the paths a take touches. |
| Stage (desktop + Chrome) | `public/stage/index.html`, `public/stage/wallpaper.jpg` | macOS Tahoe wallpaper, no menu bar/dock. Chrome-refresh frame: tab, new-tab button, omnibox, extension icon (Ramp mark on lemon) with REC badge, flat blue "A" avatar, per-site favicon, side panel (388 px, inset card). The app runs in a same-origin iframe. The URL bar shows fake demo domains: `/portal/*` → `portal.halcyonstaffing.demo`, `/bills…`, `/login`, `/agents` → `app.rampteach.demo`. No agent window: the agent's browser is the live view inside the bill page. API on `window.stage`: `go, fadeIn, fadeOut, move, press, say, unsay, openPanel, closePanel, openInMain, rect, back, href, urlChange`. |
| Real extension in the stage | `app/stage-ext/[...path]/route.ts`, `public/stage/chrome-shim.js` | Serves the **real** `extension/sidepanel.*`, `content.js`, `lib/recording.js`. `chrome-shim.js` stands in for `chrome.*` (storage, runtime messages, tabs.create → `stage.openInMain`). Narration reaches the panel through a stand-in `SpeechRecognition` (`window.__ext.speak`), which also drives the panel's voice visualizer; at Stop the panel asks `/api/stt` for the scripted narration transcript (word timings from the narration steps, aligned to the clicks). The panel shows no provider name for it. `window.__RT_OPERATOR="scripted_playwright"` labels the recording honestly. |
| Bill Pay | `app/(dash)/bills/**`, `components/dash/**`, `lib/dash.ts`, `app/api/{dash,runs,teach,learn,stt}/*` | Bill page tabs Overview / Review / Evidence / Activity; Review = routing card + the triggered run + live view (frames from `runs/<id>/live/frame.jpg`, the agent's CDP screencast) + steps. Workflows tab with the learning card; workflow page tabs (Rules, Recordings, Runs, Evals, Versions); run page waterfall; recording page. `POST /api/dash/reset` hides invoices; `POST /api/dash/deliver` makes one arrive and spawns `agent/cli.ts` (route → run). |
| Screens | `demo/video/diagrams.ts` (`SECTIONS`) | Eight HTML/CSS screens rendered frame by frame, reading the take's archive at render time (`setRunDir`). Each section's voice-over lines are its `captions`. |
| Captions | `film.ts` `voiceover()` + `postProduce()` | Caption PNGs in the stage subtitle style (Inter 500 30px, dark pill), alpha-faded overlays on the master take. Screen captions are inside the screen renders. |
| Master take | `demo/video/master/take.mp4`, `take.json` | The assembled footage of the last real take (no captions, no screens). `post` needs only this and `film-run/`. |

## The screens (`diagrams.ts`, `SECTIONS`)

Titles are the only header (no kicker labels). The technical sections carry a corner mini-map (Reviewer's Chrome,
Ramp Teach app, Agent sandbox, Anthropic) with the active groups in lemon. Every number and row is read from the
archive at render time; a field an older archive lacks is left off the screen, never invented.

| Id | Beat | Title | Length | Reads (from `film-run/`) |
|---|---|---|---|---|
| `intro` | 0 | (Ramp Teach lockup) | 6 s | nothing (fixed copy) |
| `record` | 2 | Recording and Transcription | 12.5 s | `sent-recording.json` (else `film-recording.json`): the View timecard click, the approved_hours click, the sentence linked to it (`speech.utterances[].step_refs`, word times), the redacted password input, step and sentence counts; portal card values from `data/` |
| `overview` | 4 | Architecture | 6.5 s | `skill/skill.json` (version, rules, pages), `route-HSG-1011.json` (Jev only when routing was a real Jev call), `usage.jsonl` (model), `trace.jsonl` (a `sign_in` call shows "signs in from the vault") |
| `learning` | 6 | Agent Learning | 12 s | `skill/skill.json` (stages with mode and time, the rule citing the approved_hours click, its quote, `portal_map`), `eval-run.json` (gate), `learn-trace.jsonl`, `learned-*.json`, `usage.jsonl` (request id), `trace.jsonl` (the E-104 page the agent opened) |
| `execution` | 9 | Agent execution and evaluation | 13.5 s | `trace.jsonl` (three laps: the sign-in turn, the turn that opened the failing employee's timecard, the record_evidence turn), `calc-HSG-1011.json` (failing checks with amounts, `credit_total`), `receipt-HSG-1011.json`, `decisions.jsonl`, `route-HSG-1011.json`, HSG-1012's calc results |
| `evaluation` | 11 | Agent execution and evaluation | 12.5 s | `eval-replay.json` (else `npm run eval` logic run at render time), `eval-run.json`, `evidence-check-HSG-1011.json`, `trace.jsonl` rows picked by content, `spans-HSG-1011.jsonl` or `usage.jsonl` for the request id, `usage.jsonl` for calls and cost ($4 / $20 per MTok, cache read $0.20, cache write $5) |
| `close` | 12 | (none) | 7 s | nothing (fixed copy; Teams and Slack logos) |
| `outro` | 13 | (Ramp logo, Teach) | 3.5 s | nothing |

The Claude mark appears only where Claude did the work.

## Assets (all in the repo, except one font)

| Asset | Where | License / source |
|---|---|---|
| Inter (400, 500): captions | `demo/video/assets/fonts/inter/` | SIL OFL 1.1 (license file alongside) |
| JetBrains Mono (400, 500, italic): code and log lines in diagrams | `demo/video/assets/fonts/jetbrains-mono/` | Apache 2.0 / OFL (license file alongside) |
| Lausanne (300, 400, 700): Ramp's typeface | **not committed**; `demo/video/assets/fonts/lausanne/` is a gitignored cache | Commercial typeface licensed to Ramp. `npm run setup` fetches it (or `NODE_USE_ENV_PROXY=1 npx tsx demo/video/fetch-fonts.ts`); without the cache, renderers load it from `assets.ramp.com` (allowed by the environment's network list). The app and extension always load it from there. |
| Claude mark | `demo/video/assets/logos/claude.svg` (also inline in `diagrams.ts`) | Simple Icons `claude`, CC0 |
| Microsoft Teams, Slack (close card) | `demo/video/assets/logos/microsoftteams.svg`, `slack.svg` | Full-color marks from `@iconify-json/logos` 1.2.19 (gilbarbara/logos, CC0 icon data); trademarks of their owners, shown to name a possible next step |
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
and independent of machine speed. To preview without encoding, `renderSection(sectionById("learning"), "", dir, logos, { stills: [4, 12.4] })`
writes `still-<id>-<t>.png` (a tiny tsx script: `setRunDir("demo/video/film-run")`, logos from `RampLogo.tsx`).

Screen style rules the owner signed off on (keep them):
- Plain dark `#121211` background, no pattern.
- The section title is the only header: no eyebrow or kicker labels, no numbering. Short labels with real names,
  IDs and numbers with units. No taglines, no filler, no em dashes, middle dots or the approximately sign.
- Lausanne for text, JetBrains Mono (system font) for code/log lines; lemon `rgb(228,242,34)` only for the one
  thing that matters in a frame; red `rgb(255,122,107)` only for "fail".
- Show the real mechanism with real data (screenshots, selectors, page outline with refs, tool calls, trace lines).
  No generic boxes-and-arrows, no lemon callout pills, no slogans ("every claim needs a source" was rejected).
- Plain words in labels and captions; no jargon. Light motion only: fade-and-rise, rows in order, a few lines
  drawing in.
- Real logos only: Claude mark = Simple Icons `claude` path (CC0, `#D97757`); Ramp mark from `RampLogo.tsx`.

## Changing things

- **Caption text / timing:** edit `voiceover()` in `film.ts` (footage) or a section's `captions` in `diagrams.ts`,
  then `--phase post` (any container: it needs only the master take and `film-run/`).
- **A screen:** edit `diagrams.ts`, preview stills, then `--phase post`.
- **The film's length:** `--target <seconds>` on `--phase assemble` (same container as the take) refits the waits;
  in another container shorten a section's `duration` (and its animation times) and run `--phase post`.
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
   no caption, screen or UI text may use the banned wording (`post` refuses it, see `BANNED` in `diagrams.ts`).
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
- Per take, all of the above is archived in `demo/video/film-run/`; the technical sections show it on screen.
