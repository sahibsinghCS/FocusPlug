# FocusPlug MVP

## Status (2026-09-11T08:09Z)
- **Foundation** merged to `main` (PR #1): Electron + Vite + React + Tailwind + TypeScript scaffold, shared contracts in `src/shared/`.
- **window-monitor** merged to `main` (PR #4): FocusSnapshots + allow/block list matching + JSON list store. Critic WIN.
- **process-kill** merged to `main` (PR #2): Windows blocklist terminator with allowlist safety. Critic WIN (25/25).
- **desk-ai** merged to `main` (PR #6): on-device MediaPipe BlazeFace desk presence (`src/main/desk/**`). Critic WIN; fixture gauntlet PASS.
- **Still open (parallel):**
  - PR #3 `agent/ui-shell` — draft; visual gauntlet / screenshots in progress (rebase onto main after desk-ai)
  - PR #5 `cursor/policy-engine-d332` — draft; critic in progress (rebase onto main; union package.json for vitest + desk deps)
- Next (after remaining parallel merges): `agent/session-wiring`, then `agent/polish-hyperbloom`.
