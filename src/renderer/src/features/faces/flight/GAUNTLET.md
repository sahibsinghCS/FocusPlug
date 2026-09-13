# Flight face — simple map gauntlet

Bar: at **1280×800**, a fresh harsh critic does a blind before/after of the Flight face and **selects the new still**. WIN only if AFTER is the simple in-flight plate Timmy asked for — low-poly terrain, centered plane, huge session remaining clock, cheap draw — and beats the laggy globe.

## Owns

- `src/renderer/src/features/faces/FlightFace.tsx` (FaceHost registry slot)
- `src/renderer/src/features/faces/flight/**`
- Settings route picker stays on Settings. Lock never shows Origin/Arrival boxes.

Does **not** fork FaceHost or FacePicker. Does **not** touch `src/main`, `src/shared/types.ts`, `docs/CONTRACTS.md`.

## Must read without zoom

1. **Session remaining** — the big clock is the sit they chose (`remainingMs` / session remaining), not a fake 10h flight.
2. **Close map** — low-poly / flat geometric terrain + river, centered plane silhouette, IN FLIGHT + phase.
3. **Whole-map toggle** — zoomed-out route so you can see how far you have gone.
4. **Bottom strip** — progress, distance left, ground speed (plausible, **< 1000 kph**), studied, arrives.
5. **Butter-smooth** — canvas 2D, cached terrain, no per-pixel globe / terminator / city lights.

## Linux / CI

```bash
npm test -- src/renderer/src/features/faces/flight src/shared/flightRoute.test.ts
npx tsc --noEmit -p tsconfig.web.json
```

Stills:

```bash
npx vite --config scripts/renderer-preview.vite.ts
node scripts/flight-stills.mjs
```

## Hard fail

- Critic prefers the laggy globe / bezel instrument
- Remaining clock is a decorative 10h hop instead of the session
- No way to switch close vs whole-map
- Ground speed ≥ 1000 kph
- Lock shows Origin/Arrival picker boxes
