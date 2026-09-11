# FocusPlug MVP

## Status (2026-09-11T12:35Z)
- **Foundation** merged to `main` (PR #1).
- **window-monitor** merged to `main` (PR #4). Critic WIN.
- **process-kill** merged to `main` (PR #2). Critic WIN (25/25).
- **desk-ai** merged to `main` (PR #6). Critic WIN.
- **policy-engine** merged to `main` (PR #5). Critic WIN.
- **ui-shell** merged to `main` (PR #3). Critic WIN.
- **session-wiring** merged to `main` (PR #7). Critic WIN.
- **polish-hyperbloom** merged to `main` (PR #9). Critic WIN.
- **Phase 2 contracts frozen** (`cursor/contracts-hw-916c`): `DeskModel` factory seam, `PlugDevice` / `PlugSnapshot`, `PolicyEvent` `plug_off` / `plug_on`, Store settings `deskModelId` + `plugs`, IPC `plugs:list|add|remove|test` and `desk:getModelId|setModelId`. Types + docs + channel names only — no Kasa driver, plug UI, or extra ML. Never power off the study PC. Independent contracts critic **WIN** (round 1). `npm run typecheck` + `npm test` (106) green.
