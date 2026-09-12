# FocusPlug MVP

## Status (2026-09-11T17:32Z)
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
- **Phase 3 frontend complete.** Session command center (#18), config UX (#19), logs timeline (#20), and denser shell (#21) are unified into one enforcement console: shared page chrome, status tokens, matching nav titles, and the same empty/error language. Kill overlay + Demo Kill + plug consequence stay intact. No new product features.
- **faces cheap-wow pack** on `cursor/faces-cheap-30ea` (PR #28). Rebased onto foundation (#26). Descent + Orbit + Circuit replace host stubs, `FACE_READY` flipped, catalog blurbs match the instruments. Critic WIN vs a plain bar at 1280×800; Circuit is the session fuse plate.
- **faces flask** on `cursor/faces-flask-eb27` (PR #32). New `FaceId` `flask` — glass water vessel, remaining time is the water, visible leak. Column stays retired. Critic WIN vs the attached COLUMN still at 1280×800.
- **Garden sunrise** on `agent/faces-garden`. FaceId `garden` replaces retired Eclipse conceptually (Eclipse stays retired). Night moon → dawn sun-rise → saturated orchard day. `FACE_READY.garden` is true.
- **faces candle** on `agent/faces-candle` (PR #35). New `FaceId` `candle` — melting beeswax timer. Elapsed burns the pillar down. Field stays retired. Critic WIN vs a plain bar at 1280×800.
