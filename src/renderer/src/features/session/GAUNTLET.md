# Session command-center gauntlet

Bar: at **1280×800**, a fresh harsh critic does a blind before/after of the Session page and **selects the new screen**. Overlay must be cinematic, readable on video, and name **app kill + plugs cut**. No fake sensor data. Existing Start / Stop / Demo Kill IPC stays.

## Owns

- `src/renderer/src/pages/SessionPage.tsx`
- `src/renderer/src/components/CountdownOverlay.tsx`
- `src/renderer/src/features/session/**`

## Must read on the page

1. Dominant **ON TASK / DISTRACTED / AWAY / IDLE** hero (color + icon + copy)
2. Elapsed / fuse hierarchy, Start/Stop primary, Demo Kill secondary-danger
3. Live sensors: foreground app, Desk AI label/confidence/model, enabled plugs
4. Timeline preview: cause → countdown → consequence → recovery
5. Useful empty / error / loading — no invented readings
6. Keyboard: real buttons, overlay `alertdialog`, focus cycle, Esc does not dismiss

## Linux / CI

```bash
npm test
npm run typecheck
```

Renderer stills (mock IPC, same Start/Stop/Demo Kill):

```bash
npx vite --config scripts/renderer-preview.vite.ts
# #/?scene=live
# #/?scene=away
# #/?scene=recovered
# #/?scene=distracted&countdown=8&freeze=1
```

## Hard fail

- Critic prefers the old Session home at 1280×800
- Overlay is a toast or does not name app kill + plug cut
- Fake window / desk / plug values when snapshots are missing
- Start / Stop / Demo Kill no longer call `AppState` IPC wrappers
