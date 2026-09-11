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

export interface DeskSnapshot {
  ts: number;
  label: DeskLabel;
  confidence: number; // 0..1
  webcamEnabled: boolean;
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
