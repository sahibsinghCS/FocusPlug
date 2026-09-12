import type { Decision, SessionEvent } from "@shared/ipc";

/** Internal view model for Movement / Line / Record. Host still uses FaceProps. */
export type InstrumentPhase = "idle" | "focus" | "break" | "countdown" | "ended";

export type FaceEventSeverity = "low" | "medium" | "high";

export type FaceEventKind =
  | "start"
  | "stop"
  | "countdown"
  | "kill"
  | "drift"
  | "unlock"
  | "other";

export interface InstrumentEvent {
  ts: number;
  kind: FaceEventKind;
  sourceKind: string;
  detail: string;
  severity: FaceEventSeverity;
  at: number;
}

/** @deprecated alias — prefer InstrumentEvent */
export type FaceEvent = InstrumentEvent;
export type FacePhase = InstrumentPhase;
export type FaceProps = InstrumentProps;
export type FaceId = MidFaceId;

export interface FaceRound {
  id: string;
  label: string;
  start: number;
  end: number;
  kind: "focus" | "break";
}

export type MidFaceId = "movement" | "line" | "record";

export type LineStationMode = "auto" | "thirds" | "plain";

export interface InstrumentProps {
  progress: number;
  phase: InstrumentPhase;
  events: readonly InstrumentEvent[];
  sessionId: string;
  remainingMs: number;
  elapsedMs: number;
  durationMs: number;
  nowMs: number;
  startedAt: number | null;
  decision?: Decision;
  rounds?: readonly FaceRound[];
  paused?: boolean;
  freeze?: boolean;
  lineMode?: LineStationMode;
}

export interface FaceSource {
  sessionActive: boolean;
  decision: Decision;
  countdownSec: number;
  log: readonly SessionEvent[];
  nowMs: number;
  elapsedMs: number | null;
  durationMs?: number;
  sessionId?: string;
  rounds?: readonly FaceRound[];
  freeze?: boolean;
  paused?: boolean;
  lineMode?: LineStationMode;
}

export const DEFAULT_FACE_DURATION_MS = 25 * 60 * 1000;

export const MID_FACE_IDS: readonly MidFaceId[] = ["movement", "line", "record"];
