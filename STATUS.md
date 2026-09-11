# FocusPlug MVP

## Status (2026-09-11T12:40Z)
- **Foundation** merged to `main` (PR #1).
- **window-monitor** merged to `main` (PR #4). Critic WIN.
- **process-kill** merged to `main` (PR #2). Critic WIN (25/25).
- **desk-ai** merged to `main` (PR #6). Critic WIN.
- **policy-engine** merged to `main` (PR #5). Critic WIN.
- **ui-shell** merged to `main` (PR #3). Critic WIN.
- **session-wiring** merged to `main` (PR #7). Critic WIN.
- **polish-hyperbloom** merged to `main` (PR #9). Critic WIN.
- **Phase 2 contracts frozen** (`cursor/contracts-hw-916c`): `DeskModel` factory seam, `PlugDevice` / `PlugSnapshot`, `PolicyEvent` `plug_off` / `plug_on`, Store settings `deskModelId` + `plugs`, IPC `plugs:list|add|remove|test` and `desk:getModelId|setModelId`. Types + docs + channel names only — no Kasa driver, plug UI, or extra ML. Never power off the study PC. Independent contracts critic **WIN** (round 1). `npm run typecheck` + `npm test` (106) green.
- **policy-plugs** (PR #10): rebasing onto frozen contracts — `PolicyInput` stays frozen; plug ids/arming are policy-local. Kill/unlock emit `plug_off`/`plug_on` for enabled fun plugs. No PlugController/UI.
- **smart-plug-core** (`cursor/smart-plug-core-2e44`, PR #15): Kasa/HTTP/mock drivers on the frozen `PlugController` seam, hard protect (never study PC), settings `plugs` default `[]`, Demo Kill cuts secondary plugs. Docs: `docs/SMART-PLUGS.md`. Independent critic **WIN** (round 2 after rebase).
