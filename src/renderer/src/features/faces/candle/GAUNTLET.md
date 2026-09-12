# Candle face gauntlet

Bar: a fresh harsh critic compares **start / mid / near-end** stills at **1280×800**. AFTER must clearly read as a **melting candle timer** (not a flat yellow stick) and must **WIN** vs a plain progress bar and vs any leftover Field aesthetic. WIN / LOSE only.

## Owns

- `src/renderer/src/features/faces/CandleFace.tsx` (FaceHost registry slot)
- `src/renderer/src/features/faces/candle/**`
- `FACE_READY.candle` in `src/shared/faces.ts`

Does **not** fork FaceHost or FacePicker. Does **not** revive Field / Column / Grid / Eclipse.

## Must hold

1. Silhouette is a **real candle** — tapered pillar, melted meniscus, wick, layered flame, holder. Not a yellow rectangle.
2. Wax height is **remaining** session (`1 − progress`). Elapsed ↑ → wax ↓. Geometry from progress, not only rAF.
3. **Visible melting** — drips grow with progress; a pool of wax spreads at the base.
4. Flame: soft layered glow, slight sway, brighter on focus; optional sputter when `killCount > 0` without looking broken.
5. Dark FocusPlug room. Beeswax / cream wax. Canvas / SVG / CSS only.
6. Wired as `faceId: "candle"` through `FACE_COMPONENTS` / `FACE_READY` / FacePicker / settings blob.

## Linux / CI

```bash
npx vitest run src/renderer/src/features/faces/candle src/shared/faces.test.ts
npm run typecheck
```

Stills (isolated preview, 1280×800):

```bash
npx vite --config scripts/candle-preview.vite.ts
node src/renderer/src/features/faces/candle/stills.mjs
```

Host-mounted (FaceHost on Session):

```bash
npx vite --config scripts/renderer-preview.vite.ts
# #/?scene=live&face=candle&progress=0.04&freeze=1
# #/?scene=live&face=candle&progress=0.5&freeze=1
# #/?scene=live&face=candle&progress=0.92&freeze=1
```

Scenes: `?scene=start|mid|end|stakes|idle` plus `&still=1`.

## Hard fail

- Critic still reads a yellow stick / Field plate / progress bar
- Start / mid / end stills do not change wax height
- No drips or pool in the mid / end stills
- Geometry rebuilt from rAF (stall changes the melt)
- `faceId` is `field` or any retired name
