# FocusPlug MVP

## Status (2026-09-11T08:45Z)
- **Foundation** merged to `main` (PR #1): Electron + Vite + React + Tailwind + TypeScript scaffold, shared contracts in `src/shared/`.
- **window-monitor** merged to `main` (PR #4): FocusSnapshots + allow/block list matching + JSON list store. Critic WIN.
- **process-kill** merged to `main` (PR #2): Windows blocklist terminator with allowlist safety. Critic WIN (25/25).
- **desk-ai** merged to `main` (PR #6): on-device MediaPipe BlazeFace desk presence (`src/main/desk/**`). Critic WIN; fixture gauntlet PASS.
- **policy-engine** merged to `main` (PR #5): pure `PolicyEngine.step` + table-driven tests. Critic WIN.
- **ui-shell** ready for review (PR #3 `agent/ui-shell`): polished dark session UI + kill overlay in `src/renderer/**`. Rebased onto latest main. Visual gauntlet critic **WIN** (Linear/Raycast bar; overlay unmistakable).
- Next: `agent/session-wiring`, then `agent/polish-hyperbloom`.
