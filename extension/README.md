# Ramp Teach Recorder (demo) — Manifest V3 extension

**Unofficial demo inspired by Ramp's design. Synthetic data only. Records localhost fixture pages only.**

This is the RECORD stage of the Ramp Teach engine. It records a reviewer working through the fixture
vendor portal (clicks, field inputs, form submits, page navigations) plus their narration, and exports a
`Recording` (`contracts/core.ts` → `RecordingSchema`) that the LEARN stage distills into rules.

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
4. Narrate as you go. Type in the box and click **Add narration** (Ctrl/Cmd+Enter works too), or click
   **Dictate (mic)** to use the Web Speech API. Each final phrase becomes a narration step. The button
   is hidden when the browser has no speech API. A side panel may be refused mic access; if so, open
   `chrome-extension://<id>/sidepanel.html` in a tab once to grant it, or just type.
5. **Stop**, then **Export JSON**. This downloads `recording-<session_id>.json`. **Clear** deletes the session.
   **Start** after Stop resumes the same session.

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
- Nothing leaves the browser until you click Export. The extension makes no network calls.

## Files
| File | Role |
|---|---|
| `manifest.json` | MV3 manifest: side panel, module service worker, localhost content script |
| `background.js` | State in `chrome.storage.local`, the message API (`rt:start/stop/capture/narrate/status/export/clear`), the localhost guard |
| `content.js` | DOM capture. It turns the event target into a plain element descriptor and redacts passwords |
| `sidepanel.html/.css/.js` | Panel UI: Start/Stop, live steps, narration, mic, Export, Clear |
| `lib/recording.js` (+ `.d.ts`) | Pure helpers: `buildStep`, `buildNarrationStep`, `appendStep`, `selectorFor`, `redact`, `toRecording`, `isAllowedUrl` |
| `recording.test.ts` | Vitest: schema validity, redaction, selector logic (fake element descriptors), manifest, smoke recording |
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
