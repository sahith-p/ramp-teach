# Tickets — single writer: orchestrator

| Ticket | Lane | Status | Depends on | Notes |
|---|---|---|---|---|
| T-00 | orchestrator | DONE | — | Phase 0 scaffold, contracts, board, agents, design doc |
| T-10 | data-builder | DONE (merged) | T-00 | corpus, test invoice w/ 3 planted errors, answer key, sample recording |
| T-11 | calc-builder | DONE (merged) | T-00 | deterministic checks + vitest |
| T-12 | fixture-builder | TODO | T-10 (spec pinned in docs/lane-spec.md) | vendor timecard portal + bill inbox |
| T-13 | ui-builder | IN PROGRESS (WIP merged) | T-00 | receipt review page + decision API |
| T-14 | recorder-builder | DONE (merged; real-portal recording pending T-12) | T-00 | MV3 recorder extension |
| T-20 | learn-builder | TODO | T-10, T-11 | workflow spec + evals |
| T-21 | agent-builder | TODO | T-12 | engine worker: calc → browser evidence → receipt |
| T-30 | orchestrator | IN PROGRESS (scripts/demo.ts drafted) | all | npm run demo end to end |
| T-31 | orchestrator | TODO | T-20 | npm run eval |
| T-32 | orchestrator | TODO | all | README + docs/workflow.md |

## Log
[2026-11-09T08:50:00Z] orchestrator | STATUS | T-00 | Phase 0 PARTIAL, pushed for session handoff. DONE: package.json + deps installed (lockfile committed), configs, contracts/ (core, supporting, evidence, engine — frozen), config/engine.ts (provider boundary), agent/providers/{index,anthropic}.ts (generateStructured implemented, runBrowserTask stub), lib/ (paths, data loaders, stores, trace, money), components/ui/*, app/layout + globals.css tokens, docs/design.md, docs/claude-api-notes.md, CLAUDE.md, board seeded, workflows/invoice-review/learn.ts stub.
[2026-11-09T08:50:00Z] orchestrator | STATUS | T-00 | NOT YET DONE: .claude/agents/*.md (7 lane agent files with isolation: worktree), README stub expansion, `next build` smoke check. No lane subagents spawned yet; T-10..T-21 all TODO.
[2026-11-09T08:50:00Z] orchestrator | STATUS | T-00 | Env note: ANTHROPIC_API_KEY is configured on the cloud environment but was NOT visible to the previous session's process (env vars apply at session start). Next session should re-check presence (never print it) and prefer real mode.
[2026-11-09T09:20:00Z] orchestrator | STATUS | T-00 | Continuation session. Phase 0 completed: .claude/agents/*.md (7 lanes, isolation: worktree), docs/lane-spec.md (pinned synthetic world, fixture routes + data-field markers, module entry points), lib/cache.ts (model-output disk cache), browser maxTurns capped at 25, README stub, `next build` smoke OK, typecheck OK.
[2026-11-09T09:20:00Z] orchestrator | STATUS | T-00 | Env: ANTHROPIC_API_KEY is listed on the cloud environment but is NOT present in this session's shell (`test -n "$ANTHROPIC_API_KEY"` fails). Real-mode code paths will be built and gated on the key; runs tonight use labeled offline modes unless that changes.
[2026-11-09T09:20:00Z] orchestrator | DONE | T-00 | Phase 0 committed. Wave 1: T-10, T-11, T-13, T-14 in parallel.
[2026-11-09T09:45:00Z] orchestrator | DONE | T-11 | calc merged: runCalc + 6 checks, 30/30 vitest, tsc clean. Integration check on real data: HSG-1011 → rate/duplicate fail, hours unverified without timecards and fail with them, arithmetic/total/unknown pass; calc catches 7/7 corrections.
[2026-11-09T09:45:00Z] orchestrator | STATUS | T-10 | WIP merged (9ddbf1b): all data/** present and schema-valid; 2 of 11 recording-sample tests still failing (timestamps/URLs) — lane was fixing at handoff.
[2026-11-09T09:45:00Z] orchestrator | STATUS | T-13 | WIP merged (c28c810): samples + receipt format helpers. Pages, decision API, tests NOT yet built.
[2026-11-09T09:45:00Z] orchestrator | STATUS | T-14 | WIP merged (554978b): extension/lib/recording.js helpers; unpacked extension loads headless via channel:'chromium'. Manifest/content/sidepanel/record-session NOT yet built.
[2026-11-09T09:45:00Z] orchestrator | STATUS | T-00 | Provider key order implemented (config/engine.ts resolveAnthropicKey): RAMP_ANTHROPIC_API_KEY → ANTHROPIC_API_KEY → $HOME/ramp-teach.env; client gets explicit apiKey + baseURL https://api.anthropic.com (session's ANTHROPIC_BASE_URL is for Claude Code). In this session: no key visible (curl 401 with empty header; node: unset).
[2026-11-09T09:45:00Z] orchestrator | STATUS | handoff | Session handoff for key provisioning. Next session: re-run unfinished lanes from their committed state — T-10 (fix 2 recording tests), T-13 (pages/API/tests), T-14 (extension + record-session); then wave 2 T-12, T-20, T-21 (briefs: docs/lane-spec.md + .claude/agents/*.md); then T-30..T-32. Lane worktrees under .claude/worktrees/ are local to this container and not pushed; everything they committed is merged here.
[2026-11-09T09:55:00Z] orchestrator | DONE | T-10 | data merged (f66e8e5): HSG-1011 total 15677.00; planted errors line 0 rate 105 vs 95, line 3 Sam 44h vs 38h approved, line 4 duplicate of line 2 (Priya); 7 corrections C-001..C-007 cover all six checks; 45 timecards, 11 bills, 40-step recording. data tests 11/11. Wave 2 (T-12, T-20, T-21) is unblocked.
[2026-11-09T10:00:00Z] orchestrator | DONE | T-14 | recorder merged (36a381a): MV3 extension (manifest, background, content, side panel w/ narration + Web Speech, export), loads in headless Chromium via channel:'chromium'; smoke recording extension/recordings/smoke.json (23 steps, schema-valid, password redacted; driver scripted, capture real); 28/28 tests. Remaining: run `npm run record:session -- --base-url http://localhost:3000 --invoice HSG-1010` once T-12 portal is merged.
