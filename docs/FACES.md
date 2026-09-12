# Session faces — ownership and retire list

Immersive timer **faces** replace a blank session hero. They are atmosphere / progress instruments. Decision, sensors, Start / Stop / Demo Kill stay load-bearing.

Selected face persists as `AppSettings.faceId` on the existing settings blob (`Store.loadSettings` / `saveSettings`). No second store.

Default: **`readout`** until Flight lands, then **`flight`**. Flip `FACE_READY.flight` in `src/shared/faces.ts` when `FlightFace.tsx` is a real instrument.

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
| `flight` | `agent/faces-flight` | `src/renderer/src/features/faces/FlightFace.tsx` | stub (stream not merged) |
| `hourglass` | `agent/faces-foundation` | `src/renderer/src/features/faces/HourglassFace.tsx` | ready — flipped sand |
| `readout` | `agent/faces-foundation` | `src/renderer/src/features/faces/ReadoutFace.tsx` | ready — honest digits |
| `descent` | `agent/faces-descent` | `src/renderer/src/features/faces/DescentFace.tsx` | ready — deep-sea zones |
| `movement` | `agent/faces-movement` | `src/renderer/src/features/faces/MovementFace.tsx` | stub |
| `record` | `agent/faces-record` | `src/renderer/src/features/faces/RecordFace.tsx` | stub |
| `circuit` | `agent/faces-circuit` | `src/renderer/src/features/faces/CircuitFace.tsx` | ready — session fuse plate |
| `line` | `agent/faces-line` | `src/renderer/src/features/faces/LineFace.tsx` | stub |
| `orbit` | `agent/faces-orbit` | `src/renderer/src/features/faces/OrbitFace.tsx` | ready — alignment lock |
| `growth` | `agent/faces-growth` | `src/renderer/src/features/faces/GrowthFace.tsx` | stub |

Shared (foundation only, unless a merge needs a one-line registry hook):

- `src/shared/faces.ts`
- `src/renderer/src/features/faces/FaceHost.tsx`
- `src/renderer/src/features/faces/FacePicker.tsx`
- `src/renderer/src/features/faces/PendingFace.tsx`
- `src/renderer/src/features/faces/registry.ts`
- `src/renderer/src/features/faces/props.ts`

Registry already maps every `FaceId`. A landing stream swaps the component body in its file; keep the export name.

## Retired — do not build

**Column / Grid / Eclipse / Field** are retired. They are not `FaceId`s. Persistence maps those strings back to the default face. Do not add them to the catalog, picker, or stubs.

## Preview stills

```bash
npx vite --config scripts/renderer-preview.vite.ts
# #/?scene=live
# #/?scene=live&face=hourglass
# #/?scene=live&face=readout
# #/?scene=distracted&countdown=8&freeze=1&face=hourglass
# #/?scene=live&face=flight
# #/?scene=live&face=descent&progress=0.62
# #/?scene=live&face=orbit&progress=0.62
# #/?scene=live&face=circuit&progress=0.62
```
