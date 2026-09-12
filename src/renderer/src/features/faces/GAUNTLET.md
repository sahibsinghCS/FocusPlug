# Faces mid pack — Movement + Line + The Record

Bar (1280×800 stills, blind critic, no builder rationale):

1. **The Record** is chosen over a competent progress bar as the thing you would show in a demo.
2. **Movement** reads as an exposed mechanical watch (materials, train, 4 Hz escapement with overshoot-and-settle) — not a cartoon clock.
3. **Line** makes rounds and breaks obvious (break color, filled vs next station). No-rounds collapses to one line, two stops.

Registered on the foundation host (`FaceHost` + `FACE_COMPONENTS`). Do not fork the picker. Do not regress Descent / Orbit / Circuit / Growth.

## Owns

- `src/renderer/src/features/faces/MovementFace.tsx`
- `src/renderer/src/features/faces/LineFace.tsx`
- `src/renderer/src/features/faces/RecordFace.tsx`
- `src/renderer/src/features/faces/{movement,line,record}/**`
- Session-log kinds → Record bursts (`countdown` / `kill` / `drift`)

## Stills

```bash
npx vite --config scripts/renderer-preview.vite.ts
# 1280×800
# #/?face=record&solo=1&faceScene=artifact&freeze=1
# #/?face=bar&solo=1&faceScene=artifact&freeze=1
# #/?face=movement&solo=1&faceScene=live&freeze=1
# #/?face=line&solo=1&faceScene=rounds&freeze=1
# #/?face=line&solo=1&faceScene=plain&freeze=1
```

## Linux / CI

```bash
npm test
npm run typecheck
```

## Hard fail

- Record looks like a pie / ring / progress bar
- Movement escapement is a linear tick
- Line cannot distinguish a break from a focus segment
