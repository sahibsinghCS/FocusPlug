# Session faces — ownership and retire list

Immersive timer **faces** replace a blank session hero. They are atmosphere / progress instruments. Decision, sensors, Start / Stop / Demo Kill stay load-bearing.

Selected face persists as `AppSettings.faceId` on the existing settings blob (`Store.loadSettings` / `saveSettings`). No second store.

Default: **`flight`**. `FACE_READY.flight` is true — `FlightFace.tsx` is the cheap low-poly map + session remaining clock. Route persists as `AppSettings.flightDep` / `flightArr` (default DUB→EDI).

## Contract

- Union: `src/shared/faces.ts` (`FaceId`)
- Props: `src/renderer/src/features/faces/types.ts` (`FaceProps`)
- Host / picker: `FaceHost.tsx`, `FacePicker.tsx`
- Session wiring: `src/renderer/src/pages/SessionPage.tsx`
- Settings picker: `src/renderer/src/pages/SettingsPage.tsx`

`FaceProps` (frozen for parallel streams):

```ts
{
  progress: number; // 0..1
  phase: "focus" | "break" | "idle";
  elapsedMs: number;
  remainingMs: number;
  estimateMinutes?: number;
  sessionId: string;
  events: Array<{ ts: number; kind: string; detail?: string; severity?: number }>;
  killCount: number;
  now: Date;
  width: number;
  height: number;
}
```

## File ownership

Replace the listed file. Do not fork `FaceHost` or invent a second picker.

| Face | Stream | File | This foundation |
| --- | --- | --- | --- |
| `flight` | `agent/faces-flight` | `src/renderer/src/features/faces/FlightFace.tsx` | ready — low-poly map + session clock |
| `hourglass` | `agent/faces-hourglass-v2` | `src/renderer/src/features/faces/HourglassFace.tsx` | ready — curved glass, sand transfer |
| `readout` | `agent/faces-foundation` | `src/renderer/src/features/faces/ReadoutFace.tsx` | ready — honest digits |
| `movement` | `agent/faces-mid` | `src/renderer/src/features/faces/MovementFace.tsx` | ready — exposed calibre |
| `line` | `agent/faces-mid` | `src/renderer/src/features/faces/LineFace.tsx` | ready — transit map |
| `growth` | `agent/faces-growth` | `src/renderer/src/features/faces/GrowthFace.tsx` | ready — bonsai + wilt stakes |
| `flask` | `agent/faces-flask` | `src/renderer/src/features/faces/FlaskFace.tsx` | ready — glass vessel + visible leak |
| `garden` | `agent/faces-garden` | `src/renderer/src/features/faces/GardenFace.tsx` | ready — sunrise garden (replaces retired Eclipse) |
| `candle` | `agent/faces-candle` | `src/renderer/src/features/faces/CandleFace.tsx` | ready — melting beeswax timer |

Shared (foundation only, unless a merge needs a one-line registry hook):

- `src/shared/faces.ts`
- `src/renderer/src/features/faces/FaceHost.tsx`
- `src/renderer/src/features/faces/FacePicker.tsx`
- `src/renderer/src/features/faces/PendingFace.tsx`
- `src/renderer/src/features/faces/registry.ts`
- `src/renderer/src/features/faces/props.ts`

Registry already maps every `FaceId`. A landing stream swaps the component body in its file; keep the export name.

## Retired — do not build

**Column / Grid / Eclipse / Field** are retired, and **Descent / Record / Circuit / Orbit** were removed on 2026-09-13. They are not `FaceId`s. Persistence maps those strings back to the default face. Do not add them to the catalog, picker, or stubs. Garden (`garden`) is the colorful sunrise face — do not revive `eclipse`. Candle (`candle`) is the melting-wax face — do not revive `field`.

## Preview stills

```bash
npx vite --config scripts/renderer-preview.vite.ts
# #/?scene=live
# #/?scene=live&face=hourglass&freeze=1
# #/?scene=live&face=hourglass&progress=0.62&freeze=1
# #/?scene=live&face=readout
# #/?scene=distracted&countdown=8&freeze=1&face=hourglass
# #/?scene=live&face=flight
# #/?scene=live&face=growth&progress=0.74&session=gauntlet-growth-01
# #/?scene=live&face=growth&progress=0.74&session=gauntlet-growth-01&kills=3
# #/?scene=live&face=flask&progress=0.62
# #/?scene=live&face=garden&progress=0&session=gauntlet-garden-01&freeze=1
# #/?scene=live&face=garden&progress=0.48&session=gauntlet-garden-01&freeze=1
# #/?scene=live&face=garden&progress=1&session=gauntlet-garden-01&freeze=1
# #/?scene=live&face=candle&progress=0.04&freeze=1
# #/?scene=live&face=candle&progress=0.5&freeze=1
# #/?scene=live&face=candle&progress=0.92&freeze=1
```
