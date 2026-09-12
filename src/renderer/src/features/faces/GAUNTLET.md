# Faces gauntlet

Foundation host plus cheap-wow pack (Descent / Orbit / Circuit).

Bar: at **1280×800**, a fresh harsh critic does a blind before/after of the Session page and **selects the new screen**. Hourglass / readout stay instruments. Descent, Orbit, and Circuit must each beat a plain progress bar. Circuit must look FocusPlug-native (fuse / plug / kill rail).

## Owns

- `src/shared/faces.ts` readiness bits for descent / orbit / circuit
- `src/renderer/src/features/faces/{Descent,Orbit,Circuit}Face.tsx`
- `src/renderer/src/features/faces/{descent,orbit,circuit}/**`

Does **not** own Decision/sensor IPC. Does **not** build Column / Grid / Eclipse / Field.

## Must read

1. FaceHost is the visual centerpiece
2. Descent: four ocean zones with real meter labels; gauge sinks; three speck layers
3. Orbit: 5 bodies, integer turns 1/2/3/5/8, align at progress=1
4. Circuit: hand-authored 90°/45° fuse plate, `--circuit-progress`, red→lime LED
5. Picker on Session and Settings; choice persists
6. Decision + sensors + Start / Stop / Demo Kill stay usable

## Linux / CI

```bash
npm test
npm run typecheck
npx vite --config scripts/renderer-preview.vite.ts
# #/?scene=live&face=descent&progress=0.62
# #/?scene=live&face=orbit&progress=0.62
# #/?scene=live&face=circuit&progress=0.62
```

## Hard fail

- Critic prefers a blank hero or a plain bar
- Circuit looks like a stock demo or autorouter
- Face switch crashes
- Start / Stop / Demo Kill no longer call `AppState` IPC wrappers
