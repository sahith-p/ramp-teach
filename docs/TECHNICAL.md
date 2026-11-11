# Ramp Teach: how it works

Ramp Teach turns one narrated walkthrough of an AP review into a versioned, tested, observable workflow agent inside Bill
Pay. Three technical pillars do the work, and every step leaves a trace:

```
 VOICE + RECORDING           SKILL + EVALS                       EXECUTION
 ─────────────────           ─────────────                       ─────────
 Chrome extension            6-stage learner (Claude)            Jev routes to a workflow       
 ElevenLabs Scribe v2  ──►   citations to words + clicks   ──►   Workflow agent (Claude + browser tools)
 words ↔ clicks              Agent Skill package (Skills API)    Evidence re-checked by code
                             8 eval cases, gate → active         Receipt → a person decides
                     └──────────── OBSERVABILITY: traces, spans, request IDs, usage ──────────┘
```

Models and services: **claude-opus-5-5** (learning, browser agent, receipt, eval judge), TypeSafe **Jev** (routing), Anthropic **Skills
API**, **code execution** sandbox, **Files API**, **citations**, **structured outputs**, **Message Batches**,
**ElevenLabs Scribe v2** (batch) and **Scribe v2 Realtime** (live preview). Contracts for everything below:
`contracts/pillars.ts`; shared paths and readers: `lib/pillars.ts`.

---

## 1. Voice and recording

**Capture (extension/, MV3).** The content script listens in the capture phase for clicks, inputs, submits and page
changes, and describes each target element (tag, key attributes, text, nth-of-type, a few ancestors). The service
worker turns that into a stable selector. Passwords are redacted in the page, before anything is sent. The side panel
records the microphone with `MediaRecorder` (a one-time permission page, because side panels cannot show Chrome's
prompt), shows a 28-bar level visualizer, and a live preview of the words.

**Live preview.** When the app holds an ElevenLabs key, the panel gets a single-use token from `GET /api/stt/token`
and streams 16 kHz PCM to Scribe v2 Realtime over WebSocket (partial and committed transcripts). Without one it falls
back to the browser's dictation. The key never reaches the extension.

**Final transcript (`POST /api/stt`, `lib/speech/`).** On Stop the panel uploads the audio and the recording. The
server calls Scribe v2 (`POST /v1/speech-to-text`, `model_id=scribe_v2`, `timestamps_granularity=word`) with
**page-aware key terms**: IDs, names, headings and field labels the content script saw on the recorded pages (up to
100), so "HSG-1011", "Maya Chen" and "approved hours" come out right. Confidence per word is `exp(logprob)`.

**Speech ↔ click alignment (`lib/speech/align.ts`, deterministic).** Words become sentences (punctuation, pauses of
1.2 s or more), and each sentence is linked to the DOM steps it is about: steps from 6 s before to 1.5 s after that
share a token with it (numbers, IDs like E-104, names, the clicked element's text or field name, the URL), else the
nearest click. Words under 0.6 confidence are flagged for one-click correction. The result is stored on the
recording as `speech` (`SpeechTranscript`: utterances with word timings and `step_refs`), plus the audio and a
waveform peaks file.

**Demo path.** The product film drives the real side panel with a scripted narrator; its transcript is built with the
same word-timing and alignment code (`lib/speech/simulated.ts`, provider recorded in the data, mode `scripted`).

## 2. Learning the skill

**Pipeline (`learn/skill/`).** `learnSkill(recording)` produces `skills/<id>/v<n>/`. Each stage is saved with its
timing, mode, model, request ID and token usage:

| Stage | How | Output |
|---|---|---|
| segment | code | episodes by page, with the utterances and clicks in each |
| claims | Claude with **citations** on two documents (transcript, step list) | claims, each citing exact spoken words; citation offsets mapped back to utterance IDs and linked clicks |
| synthesize | Claude with **structured output** | rules (check / decision / procedure; said, shown or both), portal map (pages, fields, selectors), vendor, open questions; every quote verified against the transcript in code |
| critique | Claude, structured | unsupported or invented rules dropped; gaps become open questions |
| checks | Claude writes Python checks, run in Anthropic's **code execution** sandbox (inputs uploaded with the **Files API**) | agreement of each learned check with the hand-written `calc/` checks on past invoices. `calc/` stays authoritative |
| package | code + **Skills API** | `SKILL.md` (Agent Skills format), `skill.json` (`SkillVersion`), `checks/*.py`; uploaded with `skills.create` / `skills.versions.create` |

A rule that was **shown, not said** (the reviewer clicked the approved-hours field but never mentioned it) is kept
with a citation to the click instead of words. Versions are diffed rule by rule (`lib/skills/diff.ts`).

**Evals of the learned skill (`evals/`, `lib/evals/`).** They answer one question: did Ramp Teach learn the right
workflow from the recording? Eight hand-authored recording variants of the primary capture, each with a gold answer:

| Case | Tests |
|---|---|
| baseline | the narration word for word |
| paraphrase | casual wording (paired with baseline for consistency) |
| reordered | decision rule first |
| shown-not-said | hours limit never spoken, only clicked |
| said-not-shown | hours rule spoken, timecards never opened |
| filler | small talk and non-rules that sound like rules |
| step-skipped | a check never mentioned: adding it counts as invented |
| stt-noise | planted speech-to-text errors; rules must come out clean |

Graders: **rule recall and precision** (Claude judge with structured output matching learned rules to gold rules one
by one; code computes the scores), **citation validity** (code: every quote exists, every linked click happened),
**coverage** (code: pages and fields vs what the reviewer visited), **replay** (code: the skill's checks run through
`calc/` on 10 past invoices vs the reviewer's past outcomes), **consistency** (judge: paired recordings give the same
skill), **voice accuracy** (word error rate and key-term accuracy). `npm run eval:skill` prints a cost estimate and
stops before any paid call unless `--yes`; `--batch` sends judge calls through the Message Batches API at half
price.

**Promotion gate.** A version goes live only if recall, precision, citations and replay are 100% and coverage is at
least 90% (`GATE`). On pass it becomes the active version and `rules/` is synced from it so the engine uses it; on
failure it is marked blocked with the failing cases listed.

## 3. Execution

**Routing (`agent/router.ts`, `agent/jev.ts`).** When an invoice arrives in Bill Pay, TypeSafe's **Jev** (a System
One decision model) decides which workflow handles it. One request to `POST https://api.typesafe.ai/v1/systemone`
carries the invoice and the catalog of active workflows as state, and two typed questions: a **Choice** across the
workflows (a probability per workflow plus confidence) and a companion **Noul**, "does any workflow cover this vendor
and kind of invoice?" (TypeSafe's recommended alternative to a "none of the above" option). The invoice routes to
the chosen workflow when the fit is at least 50%; otherwise it goes to manual review and no agent runs (example:
OFS-2201 from an office-supply vendor). Without a TypeSafe key the same decision is made by Claude (structured output,
low effort), and offline or with `RAMP_TEACH_ROUTER=deterministic` by a code path (vendor match plus document shape).
The decision, model and request ID are saved to `runs/<id>/route.json` and a span.

**Workflow agent (`agent/`).** Claude drives a real Chromium through Anthropic's `browser_toolset_20260801`, served
by a Playwright driver:
- Each page reaches the model as a short outline; every usable element gets a `data-agent-ref` written into the page,
  so the model acts by reference, not by pixel.
- Progress notes between tool calls (thinking display `updates`) are shown live in the bill page.
- A **task budget** lets the agent pace itself; turns are streamed.
- Facts are saved only through `record_evidence`, each with the page it came from.
- Guardrails: localhost pages only (checked in the toolset and again in the driver), no scripts, no uploads, a 25-turn
  cap. The agent never approves, pays or attaches; people decide through `POST /api/decisions`.

**Evidence re-check (`agent/evidence-check.ts`, code).** After the run, every recorded fact is re-read from its source
page (`[data-field=…]`) and compared; mismatches and missing fields are flagged, with a crop of the field.

**Checks and receipt.** The six checks are plain code (`calc/`, never a model). Claude writes the receipt from the
check results and evidence; a post-pass makes the numbers match the code.

## 4. Observability

| What | Where |
|---|---|
| Routing decision | `runs/<id>/route.json` |
| Spans: run → route → each model turn (model, request ID, message ID, tokens, cost, note) → each tool call (input, result, page, screenshot) → checks → evidence re-check → receipt | `runs/<id>/spans.jsonl` |
| Live view of the agent's browser (CDP screencast, about 5 fps) | `runs/<id>/live/` |
| Step screenshots, field crops | `runs/<id>/screenshots/`, `runs/<id>/evidence/` |
| Evidence re-check | `runs/<id>/evidence-check.json` |
| Learning stages with request IDs and usage | `skills/<id>/v<n>/stages/` |
| Traces with a mode on every line (`real`, `scripted`, `mock`, `deterministic`) | `agent/trace.jsonl`, `learn/trace.jsonl` |
| Every Claude call with tokens, Anthropic request ID and message ID | `runtime/usage.jsonl` (`npx tsx scripts/usage.ts` for cost) |
| Eval runs | `evals/runs/` |

Request IDs match Anthropic's own logs, so each step can be checked outside this app.

## 5. In the app (Bill Pay)

- **Bills → bill page** (`/bills/[billId]`): Overview, **Review** (routing card, the triggered workflow agent linking to
  its run, the agent's browser live inside the page, steps with progress notes), **Evidence** (facts per timecard with
  the re-check result), Activity.
- **Workflows tab** (`/bills/workflows`): every workflow with its active version, last run and eval status; live
  learning stages after Send to Ramp.
- **Workflow page**: Rules (each rule with its quote; expand to see the linked click and play that sentence's audio),
  Recordings (waveform, transcript lined up with clicks), Runs (span waterfall with tokens, cost and request IDs),
  Evals (gate, metrics, misses per case, trend), Versions (rule diff).

## 6. Run it

```bash
npm run setup
```

```bash
npm run skill:learn -- --recording extension/recordings/portal-HSG-1010.json
```

```bash
npm run eval:skill -- --yes
```

```bash
npm run agent -- HSG-1011
```

Keys: `RAMP_ANTHROPIC_API_KEY` (required for real mode), `TYPESAFE_API_KEY` (routing with Jev) and `ELEVENLABS_API_KEY` (voice). Without them everything runs
in labeled offline modes. See `docs/HANDOFF.md` for configuration and `demo/video/PIPELINE.md` for the film.
