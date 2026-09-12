# Growth face gauntlet

Bar: a fresh harsh critic compares **healthy mid-growth** vs **wilted-after-kills** stills of the **same** session-seeded bonsai. Wilt must read as intentional stakes (droop + desaturation), not a rendering bug. WIN / LOSE only.

## Owns

- `src/renderer/src/features/faces/growth/**`

Does not own SessionPage, IPC, or other faces.

## Must hold

1. Full L-system skeleton generated once from `sessionId` — identical after stall
2. `progress` reveals a fraction of **total branch length**. Geometry is not rebuilt from progress
3. Leaves are two quadratic curves, scaled by that branch's reveal
4. One blossom opens at completion
5. `killCount` / kill events droop + desaturate; wilt persists for the session
6. Palette: dark soil, green-grey bark, two greens, pale blossom

## Linux / CI

```bash
npx vitest run src/renderer/src/features/faces/growth
npm run typecheck
```

Stills (isolated preview, mock-free):

```bash
npx vite --config scripts/growth-preview.vite.ts
node src/renderer/src/features/faces/growth/stills.mjs
```

Scenes: `?scene=healthy|wilted|complete|sprout|stall|diptych` plus `&still=1`.

Healthy and wilted share `gauntlet-growth-01` so topology matches.

## Hard fail

- Wilt looks like a glitch, clipped mesh, or a different random tree
- Tree shape changes when progress or a stall remounts the face
- Blossom appears before completion, or more than one blossom
- Geometry rebuilt from progress
