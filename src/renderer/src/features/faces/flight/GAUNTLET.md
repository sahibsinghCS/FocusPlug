# Flight face v2 gauntlet

Bar: at **1280×800**, a fresh harsh critic does a blind before/after of the Flight face and **selects the new still**. WIN only if AFTER reads as a **real flight instrument** — zoomed in on the hop, globe actually rotating, no lat/lon grid, origin and arrival user-choosable.

BEFORE evidence is the Timmy-hated plate (tiny DUB→EDI sticker on a gridded globe). AFTER must beat that.

## Owns

- `src/renderer/src/features/faces/FlightFace.tsx` (FaceHost registry slot)
- `src/renderer/src/features/faces/flight/**`
- `FACE_READY.flight` in `src/shared/faces.ts`
- `AppSettings.flightDep` / `flightArr` on the existing settings blob
- `src/renderer/face.html` / `src/renderer/src/face-main.tsx` (stills harness that mounts the registry `FlightFace`)

Does **not** fork FaceHost or FacePicker. Session already maps `faceId: "flight"` through `FACE_COMPONENTS`.

## Must read without zoom

1. **User-choosable route** — Settings + session IATA pickers. Persist `flightDep` / `flightArr`. Default DUB→EDI. Both ends changeable.
2. **Tight camera** — track the arc so landforms and the plane read large. Short hops still feel alive.
3. **Continuous orbit** — globe/camera rotates during a sit; plane stays near center.
4. **No lat/lon grid** — coasts and land shading only.
5. **Terminator from real UTC** — day = warm pale gold, night = deep indigo, thin cyan twilight.
6. **City lights** only on the night side.
7. **Banked aircraft** into the great-circle heading change, clamp ±25°.
8. **Decaying contrail** (~90s), taper width/alpha; thinner at cruise.
9. **Monospace strip**: dep/arr, km remaining, ETA clock, ground speed from `estimateMinutes` / `remaining`.
10. **Climb / cruise / descent** (first 8% / last 12%); complete pulls back and sets the destination name.

## Linux / CI

```bash
npm test -- src/renderer/src/features/faces src/shared/flightRoute.test.ts src/main/session/controller.test.ts
npm run typecheck
```

Stills (browser preview, frozen UTC):

```bash
npx vite --config scripts/renderer-preview.vite.ts
node scripts/flight-stills.mjs
```

## Hard fail

- Critic prefers the tiny-hop / gridded sticker
- Route is hardcoded; user cannot change origin or arrival
- Framing is still a global disc with a postage-stamp hop
- Globe is a static map sticker (no orbit between paired stills)
- Lat/lon graticule is visible
- Terminator ignores UTC or is a hard cartoon split
- Strip numbers are decorative
