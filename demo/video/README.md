# Demo videos

## Product film (for voice-over): [ramp-teach-film.mp4](ramp-teach-film.mp4)

192.4 s · 1920×1080 · H.264 · 8.1 MB · no audio. Made for a voice-over. Captions run throughout: the voice-over
script for each scene, plus the narrator's lines while recording. The script with timings is in
[ramp-teach-film.voiceover.srt](ramp-teach-film.voiceover.srt). The captions are added in post (`--phase captions`)
from the take's timestamps, in the same style as the recorded subtitles.
Four technical diagrams are cut in (`--phase diagrams`): what the recorder saves, how the agent works a page, how
facts become a decision, and the take's own trace with every Claude call and its Anthropic request ID. It ends on a dark
Ramp-style outro (`--phase outro`): the Ramp logo, a divider and "Teach" in Lausanne, rendered frame by frame and
crossfaded from the last shot.

**What happens**
1. **Record:** a reviewer checks past invoice HSG-1010 on the vendor's portal with the Ramp Teach Recorder side panel
   open. The panel captures each click, typed field and page, and each spoken sentence arrives through the panel's
   dictation as a narration step.
2. **Send to Ramp:** the panel's **Send to Ramp** uploads the recording. Ramp's sign-in appears, and the
   **Ramp Teach** page inside Ramp learns the rules from that recording.
3. **Bill Pay:** invoice HSG-1011 arrives in the inbox. The agent starts on its own, and its browser works through the
   vendor portal in a second window while the bill drawer lists each step. Result: **Needs a second look**
   (3 issues, $3,448.00 to credit). The reviewer clicks **Dispute**.
4. Invoice HSG-1012 arrives. The wait is sped up 5×. Result: **Looks good** (all 6 checks passed). The reviewer
   clicks **Approve**, and the bill moves to Payment required.

**Live vs staged**

| Part | How it was made |
|---|---|
| Learning the rules | **Live** claude-opus-5-5 call (cache bypassed) on the recording made in this take → `film-run/learned-workflow_spec.json` (4 rules; provenance in `film-run/learned-learn_meta.json`), `film-run/sent-recording.json` |
| Agent review of HSG-1011 and HSG-1012 | **Live** runs: Claude chose every browser action (8 turns, 12 facts each) and wrote each receipt (`film-run/receipt-*.json`, `film-run/trace.jsonl`). It used the rules learned seconds earlier. |
| Diagram 04 (observability) | Rendered from this take's own `film-run/` traces and `film-run/usage.jsonl`: all 19 Claude calls with their Anthropic `request_id` |
| Diagrams 01–03 | Real screenshots, selectors, recording and trace data from an earlier live take (`diagram-assets/`) |
| Agent window | The agent's **own** browser, recorded during the run and composited into the second window frame-by-frame by wall clock |
| The six checks | Hand-written code (deterministic) |
| Cursor, typing, clicks, narration | **Scripted** (Playwright). The narration reaches the real Recorder through a stand-in speech recognizer, not a microphone. The recording is labeled "scripted test run" in the app. |
| Dispute / Approve | Scripted stand-in for a person, through the real decision API. The agent never approves. |
| Recorder side panel + content script | The **real** extension code (`extension/`), with `public/stage/chrome-shim.js` standing in for Chrome's extension APIs |
| Desktop + browser frame | A stage page (`public/stage/index.html`): macOS Tahoe wallpaper, Chrome-style frame, fake demo domains |
| Ramp dashboard | Mirrors Ramp's UI and uses the Ramp logo and font, with Ramp's approval for the Ramp hackathon (per the project owner). Synthetic data; no real Ramp account is connected. |

All the take's outputs are in [`film-run/`](film-run/). The repo's committed run artifacts were restored afterwards
(`npx tsx scripts/guard-artifacts.ts` checks this).

**Cost of the final take:** 19 API calls, about $0.36 (all 19 logged with their request IDs in `film-run/usage.jsonl`). Rehearsals run with `--offline` and cost nothing.

**Re-make it** (needs `RAMP_ANTHROPIC_API_KEY`, ffmpeg with libx264, and port 3000 free):

```bash
npx tsx demo/video/film.ts --phase all
```

Rehearse for free first:

```bash
npx tsx demo/video/film.ts --phase shoot --offline
```

## Earlier walkthrough: [ramp-teach-walkthrough.mp4](ramp-teach-walkthrough.mp4)

118 s, 1280×720, with honesty captions on screen. Made with `record-video.ts`; details in that file's header.
Its run outputs are in [`run/`](run/).
