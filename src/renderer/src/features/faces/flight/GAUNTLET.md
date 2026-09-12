# Flight face gauntlet

Bar: at **1280×800**, a fresh harsh critic does a blind before/after of the Flight face and **selects the new still**. WIN only if the after reads as a **photographed flight instrument at a real local time** — not a flat arc sticker on a sphere.

## Owns

- `src/renderer/src/features/faces/FlightFace.tsx` (FaceHost registry slot)
- `src/renderer/src/features/faces/flight/**`
- `FACE_READY.flight` in `src/shared/faces.ts`
- `src/renderer/face.html` / `src/renderer/src/face-main.tsx` (stills harness that mounts the registry `FlightFace`)

Does **not** fork FaceHost or FacePicker. Session already maps `faceId: "flight"` through `FACE_COMPONENTS`.

## Must read without zoom

1. **Terminator from real UTC** — day = warm pale gold, night = deep indigo, thin cyan twilight. Subsolar lat≈declination, lon≈(12−utcHours)×15.
2. **City lights** only on the night side (1px, alpha ∝ night depth).
3. **Banked aircraft** into the great-circle heading change, clamp ±25°.
4. **Decaying contrail** (~90s), taper width/alpha; thinner at cruise.
5. **Slow globe, plane near center** — no 6× zoom crop.
6. **Monospace strip**: dep/arr, km remaining, ETA clock, ground speed from `estimateMinutes` / `remaining`.
7. **Climb / cruise / descent** (first 8% / last 12%); complete pulls back and sets the destination name.

## Linux / CI

```bash
npm test -- src/renderer/src/features/faces
npm run typecheck
```

Stills (browser preview, frozen UTC):

```bash
npx vite --config scripts/renderer-preview.vite.ts
node scripts/flight-stills.mjs
```

## Hard fail

- Critic prefers the sticker / flat-arc still
- Terminator ignores UTC or is a hard cartoon split
- Strip numbers are decorative (fake 850 km/h, fake ETA)
- Plane is a sticker on a zoomed disc
- `faceComponent("flight")` is still the pending stub
