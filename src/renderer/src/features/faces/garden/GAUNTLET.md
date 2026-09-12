# Garden face gauntlet

Bar: a fresh harsh critic compares **Garden** (night / mid-dawn / full day) against a competent plain progress bar at 1280×800. Garden must win as the thing you would show in a demo. Eclipse stays retired — do not score a moon-disk sticker as a revival.

WIN / LOSE only.

## Owns

- `src/renderer/src/features/faces/GardenFace.tsx` (FaceHost registry slot)
- `src/renderer/src/features/faces/garden/**`
- `FACE_READY.garden` in `src/shared/faces.ts`

Does **not** fork FaceHost or FacePicker. Does **not** add `eclipse` to `FaceId`.

## Must read without zoom

1. Session start is **night**: deep indigo/violet sky, soft moon, dim garden silhouettes.
2. Mid progress is **dawn**: warm horizon, sun disk above the line, flowers starting to read color.
3. End is **day**: sun high, saturated blooms, apple-tree canopies, grass that is not a flat green slab.
4. Progress **is** sun elevation (dawn → day). A faint path may hint the arc; this is not a linear bar in a garden costume.
5. Grass uses layered strips / blades with phase-offset sine sway.

## Linux / CI

```bash
npx vitest run src/renderer/src/features/faces/garden src/shared/faces.test.ts src/renderer/src/features/faces/registry.test.ts
npm run typecheck
```

Host-mounted stills (FaceHost on Session):

```bash
npx vite --config scripts/renderer-preview.vite.ts
node src/renderer/src/features/faces/garden/stills.mjs
```

| Still | URL |
| --- | --- |
| night start | `#/?scene=live&face=garden&progress=0&session=gauntlet-garden-01&freeze=1` |
| mid dawn | `#/?scene=live&face=garden&progress=0.48&session=gauntlet-garden-01&freeze=1` |
| full day | `#/?scene=live&face=garden&progress=1&session=gauntlet-garden-01&freeze=1` |
| bar control | `#/?face=bar&solo=1&faceScene=artifact&freeze=1` |

## Hard fail

- Critic prefers the plain bar
- Night/dawn/day do not read as three lighting states
- Emoji collage / sticker flowers with no atmosphere
- Sun does not rise (progress is a fill bar, not elevation)
- Eclipse is reintroduced as a FaceId
