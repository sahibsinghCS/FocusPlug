# FocusPlug shared contracts (freeze for parallel work)

All workstreams MUST implement / consume these. Do not invent parallel APIs.

## Stack
- TypeScript + Electron (Windows-first)
- Vite + React + Tailwind for renderer
- Monorepo layout under repo root (see prompt-pack/00-overview.md)
- Local JSON persistence in `userData`

## Types (`src/shared/types.ts`)
```ts
export type DeskLabel = "at_desk" | "away" | "uncertain";
export type Decision = "ON_TASK" | "DISTRACTED" | "AWAY" | "IDLE";

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
  | { type: "status"; decision: Decision; detail: string };

export interface SessionEvent {
  ts: number;
  kind: string;
  detail: string;
}
```

## Module seams
- `WindowMonitor.start(cb)` / `stop()` → FocusSnapshot
- `DeskMonitor.start(cb)` / `stop()` / `setEnabled(bool)` → DeskSnapshot
- `PolicyEngine.step(input) → PolicyEvent[]` (pure)
- `ProcessKiller.kill(matchers: string[]) → { killed: string[]; errors: string[] }`
- `Store` load/save allowlist, blocklist, settings, append session log
- IPC: main↔renderer typed channels in `src/shared/ipc.ts`

## Default lists
Allow: chrome, msedge, firefox, Code, notion, WINWORD, Google Docs titles  
Block: Discord, steam, EpicGamesLauncher, common game exes

## UI must always show
Window status · Desk AI status · Decision · Countdown overlay · Start/Stop · Demo Kill
