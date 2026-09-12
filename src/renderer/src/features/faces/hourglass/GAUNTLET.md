# Hourglass face gauntlet

Bar: at **1280×800**, a fresh harsh critic does a blind before/after of the Hourglass face and **selects AFTER**. WIN only if AFTER reads as a **beautiful dark-room instrument** — curved glass, continuous sand transfer — not two triangles and a 1px laser.

## Owns

- `src/renderer/src/features/faces/HourglassFace.tsx` (FaceHost registry slot)
- `src/renderer/src/features/faces/hourglass/**`

Does **not** fork FaceHost or FacePicker. `FaceId` stays `hourglass`.

## Must read without zoom

1. **Shape** — real hourglass silhouette: curved bulbs, visible neck, brass caps. Not two triangles meeting at a point.
2. **Sand** — progress is transfer. Top empties / bottom fills. Bottom pile is a natural cone. Stream has width (ribbon + grains), not a 1px line.
3. **Luxury dark room** — glass edge highlights, warm sand, soft neck glow. Still FocusPlug dark.
4. **Stall-proof** — fill levels from `progress` only. Frame clock may move grains, never the pile.

## Linux / CI

```bash
npx vitest run src/renderer/src/features/faces/hourglass src/shared/faces.test.ts src/renderer/src/features/faces/registry.test.ts
npm run typecheck
```

Stills (renderer preview, frozen):

```bash
npx vite --config scripts/renderer-preview.vite.ts
node src/renderer/src/features/faces/hourglass/stills.mjs
```

```
#/?face=hourglass&freeze=1
#/?scene=live&face=hourglass&freeze=1
#/?scene=live&face=hourglass&progress=0.62&freeze=1
#/?scene=live&face=hourglass&progress=1&freeze=1
```

## Hard fail

- Critic prefers the triangle / laser still
- Silhouette is still two polygons
- Stream is a 1px line
- Sand level is driven by frame count
- Top is not empty (or bottom not full) at progress=1
