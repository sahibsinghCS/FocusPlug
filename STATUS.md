# FocusPlug MVP

## Status (2026-09-11T08:55Z)
- **Foundation** merged to `main` (PR #1): Electron + Vite + React + Tailwind + TypeScript scaffold, shared contracts in `src/shared/`.
- **window-monitor** merged to `main` (PR #4): FocusSnapshots + allow/block list matching + JSON list store. Critic WIN.
- **process-kill** merged to `main` (PR #2): Windows blocklist terminator with allowlist safety. Critic WIN (25/25).
- **desk-ai** merged to `main` (PR #6): on-device MediaPipe BlazeFace desk presence (`src/main/desk/**`). Critic WIN; fixture gauntlet PASS.
- **policy-engine** merged to `main` (PR #5): pure `PolicyEngine.step` + table-driven tests. Critic WIN.
- **ui-shell** merged to `main` (PR #3): polished dark session UI + kill overlay in `src/renderer/**`. Visual gauntlet critic WIN.
- **session-wiring** in progress (branch `cursor/session-wiring-7843`): real session controller, Demo Kill, persisted session log, main↔renderer IPC for the golden path. Critic not yet run.
- Next: critic WIN on session-wiring, then `agent/polish-hyperbloom`.
