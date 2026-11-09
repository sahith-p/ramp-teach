# Tickets — single writer: orchestrator

| Ticket | Lane | Status | Depends on | Notes |
|---|---|---|---|---|
| T-00 | orchestrator | DONE | — | Phase 0 scaffold, contracts, board, agents, design doc |
| T-10 | data-builder | TODO | T-00 | corpus, test invoice w/ 3 planted errors, answer key, sample recording |
| T-11 | calc-builder | TODO | T-00 | deterministic checks + vitest |
| T-12 | fixture-builder | TODO | T-10 (spec pinned in docs/lane-spec.md) | vendor timecard portal + bill inbox |
| T-13 | ui-builder | TODO | T-00 | receipt review page + decision API |
| T-14 | recorder-builder | TODO | T-00 | MV3 recorder extension |
| T-20 | learn-builder | TODO | T-10, T-11 | workflow spec + evals |
| T-21 | agent-builder | TODO | T-12 | engine worker: calc → browser evidence → receipt |
| T-30 | orchestrator | TODO | all | npm run demo end to end |
| T-31 | orchestrator | TODO | T-20 | npm run eval |
| T-32 | orchestrator | TODO | all | README + docs/workflow.md |

## Log
[2026-11-09T08:50:00Z] orchestrator | STATUS | T-00 | Phase 0 PARTIAL, pushed for session handoff. DONE: package.json + deps installed (lockfile committed), configs, contracts/ (core, supporting, evidence, engine — frozen), config/engine.ts (provider boundary), agent/providers/{index,anthropic}.ts (generateStructured implemented, runBrowserTask stub), lib/ (paths, data loaders, stores, trace, money), components/ui/*, app/layout + globals.css tokens, docs/design.md, docs/claude-api-notes.md, CLAUDE.md, board seeded, workflows/invoice-review/learn.ts stub.
[2026-11-09T08:50:00Z] orchestrator | STATUS | T-00 | NOT YET DONE: .claude/agents/*.md (7 lane agent files with isolation: worktree), README stub expansion, `next build` smoke check. No lane subagents spawned yet; T-10..T-21 all TODO.
[2026-11-09T08:50:00Z] orchestrator | STATUS | T-00 | Env note: ANTHROPIC_API_KEY is configured on the cloud environment but was NOT visible to the previous session's process (env vars apply at session start). Next session should re-check presence (never print it) and prefer real mode.
[2026-11-09T09:20:00Z] orchestrator | STATUS | T-00 | Continuation session. Phase 0 completed: .claude/agents/*.md (7 lanes, isolation: worktree), docs/lane-spec.md (pinned synthetic world, fixture routes + data-field markers, module entry points), lib/cache.ts (model-output disk cache), browser maxTurns capped at 25, README stub, `next build` smoke OK, typecheck OK.
[2026-11-09T09:20:00Z] orchestrator | STATUS | T-00 | Env: ANTHROPIC_API_KEY is listed on the cloud environment but is NOT present in this session's shell (`test -n "$ANTHROPIC_API_KEY"` fails). Real-mode code paths will be built and gated on the key; runs tonight use labeled offline modes unless that changes.
[2026-11-09T09:20:00Z] orchestrator | DONE | T-00 | Phase 0 committed. Wave 1: T-10, T-11, T-13, T-14 in parallel.
