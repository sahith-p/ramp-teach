# Ramp Teach Recorder (demo) — Manifest V3 extension

**Unofficial demo inspired by Ramp's design. Synthetic data only. Records localhost fixture pages only.**

This is the RECORD stage of the Ramp Teach engine. It records a reviewer working through the fixture
vendor portal (clicks, field inputs, form submits, page navigations) plus their narration, and exports a
`Recording` (`src/contracts/core.ts` → `RecordingSchema`) that the LEARN stage distills into rules.

Plain JS with no build step: load the folder unpacked.

## Load it (Chrome / Chromium 116+)
1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and pick this `extension/` folder.
3. Pin "Ramp Teach Recorder (demo)". Clicking its icon opens the **side panel**.

## Use it
1. Start the fixture app (`npm run dev`, http://localhost:3000) and open `/portal/login`.
2. In the side panel, click **Start recording**. It refuses unless the active tab is `http://localhost` or `http://127.0.0.1`.
3. Work as usual: sign in (`ap.reviewer` / `demo-only`), open an invoice, open each **View timecard** link.
   Every step appears live in the panel. Recording carries on across page loads, because state lives in `chrome.storage.local`.
4. Press the **mic** to talk as you go (press it again to pause). The panel records the audio with
   `MediaRecorder`, shows the level on the visualizer, and shows a live preview: ElevenLabs Scribe v2
   Realtime when the app has `ELEVENLABS_API_KEY` (a single-use token from `GET /api/stt/token`), else the
   browser's dictation (labeled "Browser dictation"). Each final phrase also becomes a narration step, as
   before. Side panels cannot show Chrome's mic prompt: the first time, the panel opens `permission.html`
   in a tab to ask once. You can also type a note in **Add a note**.
5. **Stop** uploads the audio takes and the recording to `POST /api/stt`, which returns the word-timed
   transcript aligned to your clicks (`recording.speech`). Each sentence lists the steps it is about
   (`#16 approved_hours`); hover it to highlight them. Words the model was unsure of (confidence < 0.6) are
   underlined: click any word to correct it.
6. **Send to Ramp** posts the recording (with its transcript) to `/api/learn` and opens
   Bill Pay > Workflows (`/bills/workflows?recording=<session_id>`). **Export** downloads
   `recording-<session_id>.json`. **Clear** deletes the session. **Resume** after Stop continues the same session.

### Voice: providers and labels
| Path | When | `speech.provider` / `mode` | Label in the panel |
|---|---|---|---|
| ElevenLabs Scribe v2 (batch) | audio + `ELEVENLABS_API_KEY` on the app | `elevenlabs` / `real` | ElevenLabs Scribe v2 |
| Live preview, Realtime | while talking, key set | (preview only) | ElevenLabs Scribe v2 Realtime |
| Live preview, browser | while talking, no key | (preview only) | Browser dictation |
| Demo voice (film) | `window.__RT_VOICE = "simulated"` or a scripted operator | `simulated` / `scripted` | none |
| No key, a person's audio | | 503, audio saved | error message |

The film's stage (`public/stage/chrome-shim.js`) has no mic: the narrator's lines drive the visualizer and
arrive through the dictation code path, and Stop asks `/api/stt` for the transcript built from the narration
steps' timestamps (`src/lib/speech/simulated.ts`, ~2.6 words/s, confidence 1). Server side: `src/lib/speech/`.

### Export format (exactly `RecordingSchema`)
```json
{
  "session_id": "rec_20261109T083708Z_7ze3",
  "started_at": "2026-11-09T08:37:08.000Z",
  "steps": [
    { "ts": "…", "kind": "dom", "detail": { "event": "input", "url": "…/portal/login", "title": "…", "selector": "input[name=\"password\"]", "value": "[redacted]" } },
    { "ts": "…", "kind": "dom", "detail": { "event": "click", "url": "…", "title": "…", "selector": "a[href=\"/portal/employees/E-104?week=2026-10-11\"]", "text": "View timecard" } },
    { "ts": "…", "kind": "narration", "detail": { "event": "narration", "text": "Billed hours must not exceed approved hours.", "url": "…", "title": "…" } }
  ],
  "transcript": ["Billed hours must not exceed approved hours."]
}
```
- DOM `event` values: `navigate` (page load, back/forward cache restore, pushState URL change),
  `click`, `input` (consecutive keystrokes in one field collapse to the final value), `change`
  (selects, checkboxes, radios), and `submit`.
- Selector priority: `[data-field="…"]`, then `tag[name="…"]`, then `#id`, then `a[href="…"]`, then a short
  CSS path of 4 segments or fewer. A click on a child element (a `<span>` inside a link, say) resolves to the nearest
  link, button, field or `[data-field]` element. Click `text` is the visible text, cut to 120 characters.
- `transcript` holds the narration texts in order.

## Privacy
- **Passwords are never stored.** Any `type=password` field, and any field whose name or id looks
  like a password, token or secret, is saved as `[redacted]`. The content script redacts before
  sending, and the background redacts again in `lib/recording.js`. Unit tests and the
  `record:session` script both check that the plaintext never shows up.
- **Localhost only.** Host permissions and content-script matches cover only `http://localhost/*` and
  `http://127.0.0.1/*`. The background refuses to start on any other tab and drops captures from
  any other URL.
- Network calls go only to the localhost app the page was recorded on (`/api/stt`, `/api/stt/token`,
  `/api/learn`), plus, when the app hands out a Realtime token, the ElevenLabs Realtime WebSocket for the live
  preview. The ElevenLabs API key stays on the server. Audio is saved to `runtime/recordings/` (gitignored).
- Page terms (names, IDs, field labels visible on recorded pages) are collected as speech keyterms only while recording.

## Files
| File | Role |
|---|---|
| `manifest.json` | MV3 manifest: side panel, module service worker, localhost content script |
| `background.js` | State in `chrome.storage.local`, the message API (`rt:start/stop/capture/narrate/terms/status/export/clear`), the localhost guard |
| `content.js` | DOM capture (event target to a plain element descriptor, passwords redacted) and the page-term collector |
| `sidepanel.html/.css/.js` | Panel UI: Start/Stop, mic + visualizer, live and final transcript, steps, Send, Export, Clear |
| `permission.html/.js` | One-time mic grant in a tab (side panels cannot prompt) |
| `lib/recording.js` (+ `.d.ts`) | Pure helpers: `buildStep`, `buildNarrationStep`, `appendStep`, `selectorFor`, `redact`, `toRecording`, `isAllowedUrl`, `mergeTerms`, `shortStepLabel`, `applyWordEdit`, `clock` |
| `recording.test.ts` | Vitest: schema validity, redaction, selector logic (fake element descriptors), manifest, smoke recording, voice helpers |
| `scripts/record-session.ts` | Scripted Playwright driver that runs the real extension (below) |
| `scripts/fixture-test-server.ts` | Small self-contained portal look-alike on :3013, for the smoke run |
| `recordings/smoke.json` | Sample recording captured by the real extension against the smoke fixture |

## `npm run record:session`
**Modes:** the DRIVER is **scripted** (fixed Playwright steps, no AI). The CAPTURE is **real**: this
unpacked extension's content script, background and side panel record the session.

The script launches Playwright's full Chromium build (`channel: "chromium"`, new headless mode;
`chrome-headless-shell` cannot load extensions) with `--load-extension=extension/`. It then opens
`/portal/login`, opens the side panel page in a tab and clicks **Start recording**, signs in, opens
`/portal/invoices`, opens the invoice, clicks every **View timecard** link and reads
`[data-field="approved_hours"]`, and types narration lines into the panel. Finally it clicks
**Stop** and **Export**. It validates the export with `RecordingSchema`, confirms the password is
redacted, and writes the JSON.

```bash
# Against the real fixture portal (start `npm run dev` first):
npm run record:session -- --base-url http://localhost:3000 --invoice HSG-1010
#   → extension/recordings/<session_id>.json   (or pass --out <path>)

# Self-contained smoke run (starts scripts/fixture-test-server.ts on :3013, invoice TEST):
npm run record:session -- --smoke            # → extension/recordings/smoke.json
```
Flags: `--base-url` (default `$BASE_URL` or http://localhost:3000; must be localhost), `--invoice`
(default `HSG-1010`), `--out` (output path), `--smoke`, `--headed`.
