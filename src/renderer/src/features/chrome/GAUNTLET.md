# Phase 3 final visual integration gauntlet

Bar: at **1280×800**, a fresh harsh critic does a blind before/after of the enforcement console and **selects the new screens**. WIN only if Session, Allow/Block, Plugs, Settings, and Log read as **one product** — not four Phase 3 streams taped together. Overlay must stay cinematic; Demo Kill and plugs consequence must stay readable on video.

## Owns

Renderer chrome and page surfaces only. No new product features. Frozen IPC stays.

- `src/renderer/src/components/**`
- `src/renderer/src/pages/**`
- `src/renderer/src/features/session/**` (tokens / empty / hierarchy only)
- `src/renderer/src/features/config/**` (shared chrome only)
- `src/renderer/src/features/logs/**` (shared chrome only)
- `src/renderer/src/lib/tone.ts`

## Must read without zoom

1. Same titlebar + sidebar identity on every route (labels match the page)
2. Shared page header / panel / empty / error language
3. Status colors (lime / red / amber / mute) mean the same thing everywhere
4. Kill overlay: huge fuse, **Demo Kill**, App kill + Plugs cut
5. Useful empty and error states — no invented sensor readings

## Linux / CI

```bash
npm test
npm run typecheck
```

Stills (mock IPC):

```bash
npx vite --config scripts/renderer-preview.vite.ts
node scripts/console-stills.mjs src/renderer/src/features/chrome/evidence after
```

## Hard fail

- Critic prefers the fragmented pre-integration console
- Overlay is a toast or loses Demo Kill / plug consequence
- Fake window / desk / plug values
- Start / Stop / Demo Kill no longer call `AppState` IPC wrappers
- Duplicate page titles or clashing tokens that read as two apps
