# Walkthrough video

**[ramp-teach-walkthrough.mp4](ramp-teach-walkthrough.mp4)**: 118 s, 1280x720, H.264, 4.0 MB. It plays in any
browser or video player. Unofficial demo inspired by Ramp's design. All data is synthetic, and no real Ramp
account is connected.

Every frame is real browser pixels from the running app, captured with Playwright `recordVideo`. The captions
are overlays added during capture (presenter clips) or burned in with ffmpeg (agent clip). No terminal, code,
logs or keys appear in frame.

## What is live, saved or scripted (as captioned on screen)

| Step | On screen | Mode |
|---|---|---|
| 1. Overview | Home page, five-stage engine | App UI, synthetic data |
| 2. Record | `/learn`: the capture timeline from `extension/recordings/portal-HSG-1010.json` | Captured by the MV3 extension. **Performed by a scripted Playwright operator, not a human.** |
| 2. Learn | `/learn`: the learned rules, proof sources and open question | **Saved output** of an earlier real claude-opus-5-5 call (2026-11-09 09:43 UTC). Not re-run for the video. |
| 3. Verify | Claude's own browser signing in, opening invoice HSG-1011 and reading 4 timecards | **Live real Claude run** for this video (2026-11-09 21:30 UTC, run `invoice-review:HSG-1011:20261109T213021`). 8 model turns, shown in real time (not sped up), with one caption per turn generated from that run's trace. |
| 4. Receipt | Recommendation banner, 6 checks with evidence links, the evidence viewer, line-item flags | Receipt text from a **live** claude-opus-5-5 call in the same run (model-output cache bypassed, `cache_hit: false`, 8.3 s). **The six checks are hand-written code.** |
| 5. Decide | A name is typed and Dispute is clicked on the receipt page, then the bill in the inbox | **Scripted stand-in for a human** (Playwright), through the real `POST /api/decisions`. The bill shows Disputed with the receipt attached. |

The video run's outputs are archived in [`run/`](run/): the receipt as decided on camera, calc, evidence, the
run's trace lines, the decision line, and the caption timeline. After capture, the repo's committed real-run
artifacts (`receipts/`, `runs/HSG-1011/`, `agent/trace.jsonl`) were restored unchanged, so they still match the
`npm run demo` report.

**Cost of the video's live run:** 9 API calls (8 browser turns + 1 synthesis), about $0.20 at Opus 5.5 list prices.

## Re-create it

```bash
npm run build && npm run start
```

```bash
npx tsx demo/video/record-video.ts --phase all
```

The phases are `agent` (one live real-mode run, about $0.20), `present` (UI clips, no API), `assemble` (ffmpeg)
and `restore` (archive the run, restore the committed artifacts). `present` and `assemble` can be retaken without
another API run. Raw clips and backups go to `demo/video/work/`, which is gitignored.

The script needs `RAMP_ANTHROPIC_API_KEY` for the `agent` phase, plus `ffmpeg` with libx264. It records the
agent's browser through two opt-in env switches: `RAMP_TEACH_RECORD_VIDEO_DIR` in `agent/browser/playwright-driver.ts`
and `RAMP_TEACH_VIEWPORT` in `config/engine.ts`. Neither changes what the model sees or can do.
