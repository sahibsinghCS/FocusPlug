# Prompt — agent/session-wiring

Repo: https://github.com/sahibsinghCS/FocusPlug · branch `agent/session-wiring`.
Depends on foundation + ideally other modules merged; otherwise wire adapters to existing seams.

## Goal
Wire session lifecycle: monitors → policy → countdown IPC → killer → unlock. Implement **Demo Kill**. Session event log. Main↔renderer IPC complete for golden path.

## Owns
`src/main/session/**`, IPC handlers in main, glue only (don't rewrite UI/policy).

## Gauntlet bar
Golden path proof (scripted or manual checklist with screenshots/log): Docs→Discord→countdown→kill→return→unlock. Demo Kill instant path. Critic requires evidence artifact in PR.

## Gauntlet
Loop until WIN. Commit often.

## Done
PR `session-wiring: golden path + Demo Kill`.

