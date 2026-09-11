# FocusPlug MVP

## Status (2026-09-11T12:52Z)
- **Foundation** merged to `main` (PR #1).
- **window-monitor** merged to `main` (PR #4). Critic WIN.
- **process-kill** merged to `main` (PR #2). Critic WIN (25/25).
- **desk-ai** merged to `main` (PR #6). Critic WIN.
- **policy-engine** merged to `main` (PR #5). Critic WIN.
- **ui-shell** merged to `main` (PR #3). Critic WIN.
- **session-wiring** merged to `main` (PR #7). Critic WIN.
- **polish-hyperbloom** merged to `main` (PR #9). Critic WIN.
- **Phase 2 contracts frozen** (PR #12): `DeskModel` factory seam, `PlugDevice` / `PlugSnapshot`, `PolicyEvent` `plug_off` / `plug_on`, settings `deskModelId` + `plugs`, IPC `plugs:*` + `desk:*ModelId`. Never power off the study PC.
- **policy-plugs** merged to `main` (PR #10). Critic WIN. Kill/unlock emit `plug_off`/`plug_on` for enabled fun plugs.
- **smart-plug-core** merged to `main` (PR #15). Critic WIN. Kasa/HTTP/mock `PlugController`, hard protect, settings `plugs` default `[]`.
- **model-seam** merged to `main` (PR #13). Critic WIN. `DeskModel.infer(frame)` factory (stub / blazeface / custom).
- **session-plugs** merged to `main` (PR #11). Critic WIN. Consumes frozen `deviceIds` / `PlugSnapshot[]` from policy; Demo Kill cuts enabled plugs; study-PC never commanded.
- **ui-plugs** in progress: renderer Plugs panel + Settings `deskModelId` selector on frozen IPC (`plugs:*`, `desk:*ModelId`). No parallel channels.
