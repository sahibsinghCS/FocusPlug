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
