# Faces foundation gauntlet

Bar: at **1280×800**, a fresh harsh critic does a blind before/after of the Session page and **selects the new screen**. The face must read as an instrument (hourglass sand or readout digits), not a blank hero. Switching faces must not crash. Decision + sensors + Start / Stop / Demo Kill stay usable.

## Owns

- `src/shared/faces.ts`
- `src/renderer/src/features/faces/**`
- Session / Settings wiring for `faceId`
- `docs/FACES.md`

Does **not** own Decision/sensor IPC. Does **not** build Column / Grid / Eclipse / Field.

## Must read on the page

1. FaceHost is the visual centerpiece (atmosphere / progress)
2. Hourglass: dark room, flipped sand, progress = transfer
3. Readout: monospace honest digits + linear progress (no decorative ring)
4. Other FaceIds: "stream not merged" or a static silhouette — not a crash
5. Picker on Session and Settings; choice persists
6. Default `readout` until Flight lands

## Linux / CI

```bash
npm test
npm run typecheck
```

Renderer stills (mock IPC):

```bash
npx vite --config scripts/renderer-preview.vite.ts
# #/?scene=live&face=readout
# #/?scene=live&face=hourglass
# #/?scene=live&face=flight
```

## Hard fail

- Critic prefers a blank session hero
- Face switch crashes
- Hourglass / Readout look like unfinished placeholders at 1280×800
- Start / Stop / Demo Kill no longer call `AppState` IPC wrappers
