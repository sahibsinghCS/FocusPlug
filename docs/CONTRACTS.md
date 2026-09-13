# FocusPlug shared contracts (freeze for parallel work)

All workstreams MUST implement / consume these. Do not invent parallel APIs.

**Phase 2 (frozen):** smart-plug types + `DeskModel` factory seam. Types, docs, and IPC channel names only. No Kasa driver, plug UI, or extra ML in this freeze. Never power off the study PC.

## Stack
- TypeScript + Electron (Windows-first)
- Vite + React + Tailwind for renderer
- Monorepo layout under repo root (see prompt-pack/00-overview.md)
- Local JSON persistence in `userData`

## Types (`src/shared/types.ts`)
```ts
export type DeskLabel = "at_desk" | "away" | "uncertain";
export type AttentionLabel = "focused" | "unfocused" | "phone";
export type Decision = "ON_TASK" | "DISTRACTED" | "AWAY" | "IDLE";
export type DeskModelId = "stub" | "blazeface" | "custom";
export type PlugProtocol = "kasa" | "http" | "mock";

export interface AppEntry {
  id: string;
  name: string;          // display
  match: string[];       // process names and/or title substrings (case-insensitive)
  enabled: boolean;
}

export interface FocusSnapshot {
  ts: number;
  processName: string;
  windowTitle: string;
  matchedAllow: boolean;
  matchedBlock: boolean;
  blockEntryId?: string;
}

export interface DeskAttention {
  label: AttentionLabel;
  confidence: number; // 0..1
}

export interface DeskSnapshot {
  ts: number;
  label: DeskLabel;
  confidence: number; // 0..1
  webcamEnabled: boolean;
  /** only while at_desk, and only from a model with an attention head */
  attention?: DeskAttention;
}

/** RGB frame — same shape as src/main/desk `RgbFrame`, plus Float32 tensors. */
export interface DeskFrame {
  width: number;
  height: number;
  data: Uint8Array | Float32Array;
}

/** Timmy drops his model behind this. No training in this phase. */
export interface DeskModelOutput {
  label: DeskLabel;
  confidence: number; // 0..1
  /** optional: focused / unfocused / phone, only when label is at_desk */
  attention?: DeskAttention;
  /** optional debug faces */
  faces?: Array<{ probability: number; box: { x0: number; y0: number; x1: number; y1: number } }>;
}

export interface DeskModel {
  readonly id: string;
  init(): Promise<void>;
  /** RGB frame bytes + width/height — match existing desk/frame types if present */
  infer(frame: DeskFrame): Promise<DeskModelOutput>;
  dispose?(): Promise<void>;
}

export interface PlugDevice {
  id: string;
  name: string;
  protocol: PlugProtocol;
  /** host/ip or unique device id */
  address: string;
  enabled: boolean;
  /** NEVER true for study PC — fun/secondary devices only */
  isStudyPc: false;
}

export interface PlugSnapshot {
  ts: number;
  deviceId: string;
  online: boolean;
  powerOn: boolean | null;
  error?: string;
}

export interface PolicyInput {
  sessionActive: boolean;
  focus: FocusSnapshot | null;
  desk: DeskSnapshot | null;
  countdownSec: number;
  deskThreshold: number;
  strictMode: boolean; // on-task requires allowlist focus AND at_desk
}

export type PolicyEvent =
  | { type: "start_countdown"; reason: string; seconds: number }
  | { type: "cancel_countdown" }
  | { type: "kill"; targets: string[]; reason: string }
  | { type: "unlock" }
  | { type: "status"; decision: Decision; detail: string }
  | { type: "plug_off"; deviceIds: string[]; reason: string }
  | { type: "plug_on"; deviceIds: string[]; reason: string };

export interface SessionEvent {
  ts: number;
  kind: string;
  detail: string;
}
```

## Settings (`AppSettings` in `src/shared/ipc.ts`)
Persisted by `Store.loadSettings` / `saveSettings` — one settings blob, not a second store.

- `countdownSec`, `deskThreshold`, `strictMode`, `webcamEnabled` (Phase 1)
- `deskModelId`: `"stub" | "blazeface" | "custom"` (default `"blazeface"` so a later factory wiring keeps today’s Desk AI)
- `faceId`: immersive session face (`flight` | `hourglass` | `readout` | `movement` | `line` | `growth` | `flask` | `garden` | `candle`). Default `flight`. Union lives in `src/shared/faces.ts` — not in the frozen Types block. Retired: Column / Grid / Eclipse / Field, and Descent / Record / Circuit / Orbit (removed 2026-09-13); a saved retired id falls back to `flight`. Do not revive Eclipse or Field; Garden is the sunrise face; Candle is the melting-wax face.
- `flightDep` / `flightArr`: curated IATA codes for the Flight face origin and arrival. Default `DUB` → `EDI`. Same settings blob — not a second store.
- `plugMode`: `"nudge" | "cut"` (default `"nudge"`). `nudge`: when you drift (phone, looking away, blocked app) enabled plugs switch **on** — a lamp that pulls you back — and the policy's `plug_off` / `plug_on` are not executed. `cut`: the original enforcer, `plug_off` on kill and `plug_on` on unlock. Union lives in `src/shared/nudge.ts`.
- `plugs`: `PlugDevice[]` (default `[]`)

`isStudyPc` is the literal `false`. Persistence MUST drop any device that is not explicitly `isStudyPc: false`. Never persist a study-PC plug.

## Module seams
- `WindowMonitor.start(cb)` / `stop()` → FocusSnapshot
- `DeskMonitor.start(cb)` / `stop()` / `setEnabled(bool)` → DeskSnapshot
- `DeskModelFactory.create(id: DeskModelId) → DeskModel` — interchangeable infer backend. Do **not** hard-code BlazeFace. No training in this phase. `DeskMonitor` stays the runtime presence seam; `DeskModel` is the model Timmy drops behind it. Do not add a second monitor.
- `DeskModel.init()` / `infer(frame: DeskFrame)` / optional `dispose()` → `DeskModelOutput`
- `PolicyEngine.step(input) → PolicyEvent[]` (pure). May emit `plug_off` / `plug_on` alongside `kill`. Existing kill/unlock/countdown/status events stay. Never power off the study PC.
- `ProcessKiller.kill(matchers: string[]) → { killed: string[]; errors: string[] }`
- `PlugController.off(ids)` / `on(ids)` / `list()` / `discover()` → `PlugSnapshot[]` / `PlugDevice[]`. Fun/secondary devices only. No Kasa/HTTP driver in this freeze (`plugs:test` returns a not-implemented snapshot).
- `Store` load/save allowlist, blocklist, settings (including `deskModelId` + `plugs`), append session log
- IPC: main↔renderer typed channels in `src/shared/ipc.ts`

## IPC (Phase 2 additions)
Same `focusplug:<area>:<verb>` style as Phase 1. Dedicated channels are the operational API for plugs and desk-model id — the same pattern as `webcamEnabled` + `focusplug:desk:setEnabled`, not a second settings store.

Invoke:

- `focusplug:plugs:list` → `PlugDevice[]`
- `focusplug:plugs:add` (`PlugDevice`) → `PlugDevice[]`
- `focusplug:plugs:remove` (`deviceId`) → `PlugDevice[]`
- `focusplug:plugs:test` (`deviceId`) → `PlugSnapshot` (stub: `online: false`, `powerOn: null`, `error: "plug driver not implemented"`)
- `focusplug:desk:getModelId` → `DeskModelId`
- `focusplug:desk:setModelId` (`DeskModelId`) → `DeskModelId`

No `plugs:discover` channel in this freeze — `PlugController.discover()` is the later driver seam.

## Default lists
Allow: chrome, msedge, firefox, Code, notion, WINWORD, Google Docs titles  
Block: Discord, steam, EpicGamesLauncher, common game exes

## UI must always show
Window status · Desk AI status · Decision · Countdown overlay · Start/Stop · Demo Kill

## Focus Forecast (Phase 4)
Additive only. `src/shared/types.ts` receives ZERO changes (byte-locked against the Types fence above). New shared types live in `src/shared/forecast/types.ts` and are re-exported from `src/shared/ipc.ts` (`ForecastSnapshot`, `ForecastEvent`, `ForecastBand`). Full frozen appendix: `docs/FORECAST-CONTRACTS.md`; design: `docs/FORECAST-DESIGN.md`.

### IPC (Phase 4 additions)
Invoke:

- `focusplug:forecast:getState` → `ForecastSnapshot | null` (null when no session is active or the forecast is off)

Push:

- `focusplug:forecast:snapshot` → `ForecastSnapshot` (1 Hz + band changes)
- `focusplug:forecast:event` → `ForecastEvent`

`FocusPlugApi` gains `forecastGetState()`, `onForecastSnapshot(cb)`, `onForecastEvent(cb)`. There is no forecast settings invoke — settings flow through the existing `focusplug:settings:set` patch.

### Settings (Phase 4 additions to `AppSettings`)
Five flat keys (house `requirePatch`/`normalizeSettings` style — no nested block):

| key | type | default | `normalizeSettings` clamp |
|---|---|---|---|
| `forecastEnabled` | boolean | `true` | boolean else default |
| `forecastPrearmEnabled` | boolean | `true` | boolean else default |
| `forecastNudgeRisk` | number | `0.50` | finite → clamp [0.05, 0.90] else default |
| `forecastPrearmRisk` | number | `0.65` | finite → clamp [0.10, 0.95] else default; then raised to ≥ `forecastNudgeRisk` + 0.05 |
| `forecastPrearmFuseSec` | number | `5` | finite → `Math.round`, clamp [3, 600] else default (runtime additionally caps at `countdownSec`) |

The two risk defaults are operating points re-derived with the model, not free constants. Code-side parity is enforced: `scripts/forecast/eval.ts` asserts `weights.thresholds.nudge/prearm` equal `DEFAULT_SETTINGS.forecastNudgeRisk/forecastPrearmRisk` (`nudge` 0.50 / `prearm` 0.65 today). This *table* is not machine-guarded — `npm run check:contracts` byte-compares source fences only, never prose tables — so re-check it by hand after any threshold re-derivation, against `src/shared/defaults.ts` and `docs/FORECAST-CONTRACTS.md § 3`.

`forecastEnabled: false` (or any load/inference failure) reproduces today's behavior event-for-event. The forecast's only authority over enforcement is `PolicyInput.countdownSec`, bounded to `[3, countdownSec]`, never lengthened. `src/shared/policy/**` and `SessionPush` (`src/main/session/push.ts`) stay untouched.

---

## Focus Plan (Phase 5)
Additive only. `src/shared/types.ts` receives ZERO changes (byte-locked against the Types fence above). New shared types live in `src/shared/plan/types.ts` and are re-exported from `src/shared/ipc.ts` (`FocusPlanState`, `FocusPlanLedger`, `PlanRound`, `PlanEstimate`, `PlanRecommendation`, `PlanDebrief`, `PlanRevision`, `PlanTrend`, `SessionArmContext`, `SessionPlanContext`). Design: `docs/FOCUS-PLAN.md`.

Focus Plan is a coaching layer, and the contract is written so it cannot become anything else. It **never** locks, blocks or kills: the process kill stays the only enforcement in this product. Its one authority over the running session is **none** — `SessionControllerOptions` gains no plan-shaped key, `src/main/session/adaptiveFuse.ts` and `fuseAuthority.ts` are untouched, and `src/main/focusplan/integration.test.ts` fails the build if a plan-shaped option is ever added.

### IPC (Phase 5 additions)
Invoke:

- `focusplug:plan:getState` → `FocusPlanState` (closed rounds only; the live round is assembled renderer-side)
- `focusplug:plan:reset` → `FocusPlanState` (forgets the ledger; touches neither the adaptive model, the log, nor settings)

Push:

- `focusplug:plan:round` → `PlanRound` (on round close only, roughly once per focus block)

Widened:

- `focusplug:session:start` gains **one optional argument**, `SessionPlanContext`. It is consumed in `src/main/index.ts` by `FocusPlan.declareRound` and handed to `controller.start()` **never** — the session controller does not see it. Every pre-Phase-5 caller (`probe.ts`, the smoke script, `mockApi`) still typechecks and still works, and a missing or malformed context costs a labelled round and nothing else.

`FocusPlugApi` gains `planGetState()`, `planReset()`, `onPlanRound(cb)`, and the optional argument on `sessionStart(context?)`. There is no plan settings invoke — settings flow through the existing `focusplug:settings:set` patch.

### Settings (Phase 5 additions to `AppSettings`)
Two flat keys (house `requirePatch`/`normalizeSettings` style — no nested block):

| key | type | default | `normalizeSettings` clamp |
|---|---|---|---|
| `focusPlanEnabled` | boolean | `true` | boolean else default |
| `focusPlanStretchEnabled` | boolean | `true` | boolean else default |

`focusPlanEnabled: false` reproduces today's screens exactly: `PlanCard` and `DebriefCard` render `null`, `PLAN_GET_STATE` returns an empty window, and nothing is recorded. `focusPlanStretchEnabled: false` keeps the measurement and the debrief and plans to the estimate with no progression step. `FOCUSPLUG_NO_PLAN=1` is a different thing from that switch, and mirrors `FOCUSPLUG_NO_ADAPT=1`: for one run the feature stays on and `PLAN_GET_STATE` reports `enabled: true` with an empty window and `lifetimeRounds: 0`, so the cards stay on screen at the `no-history` rung, while `focus-plan.json` is not read, not written and not cleared — `PLAN_RESET` is refused under the pin. Settings are untouched either way.

### Storage
`<userData>/focus-plan.json`, a sibling of `adaptive-model.json`, written through the existing `writeJsonAtomic` on round close only. Wrong version, wrong shape or unreadable ⇒ an empty ledger, never a throw. It holds round durations, drift offsets and risk peaks — **no process name, no window title and no frame**, which is structural rather than promised: `src/main/focusplan/tap.ts` observes `sessionState`, `policyEvent`, `forecastSnapshot` and `forecastEvent` only, and never subscribes to `focusSnapshot`, `deskSnapshot`, `sessionEvent` or `nudge`.

### Uncoupling
Both taps forward to the base push **first** and only then mirror, and `swallow()` catches anything that escapes the recorder's own `guard()`, so a coaching layer can never delay, reorder or drop an enforcement message. `src/main/focusplan/integration.test.ts` deep-equals the push trace of a scripted session with Focus Plan attached against the same session without it. This table is not machine-guarded — `npm run check:contracts` byte-compares source fences only: the Types fence above, plus the two "complete source" fences for `src/shared/plan/types.ts` and `src/shared/plan/constants.ts` in `docs/FOCUS-PLAN.md`.
