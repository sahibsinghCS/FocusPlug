import {
  DEFAULT_ESTIMATE_MINUTES,
  type FaceId,
  type FacePhase,
  normalizeFaceId,
} from "@shared/faces";
import type { Decision, SessionEvent } from "@shared/ipc";
import { clamp01 } from "./clock";
import type { FaceEvent, FaceProps } from "./types";

export interface BuildFacePropsInput {
  sessionActive: boolean;
  decision: Decision;
  elapsedSec: number | null;
  countdownSec: number;
  fuseArmedSec: number;
  startedAt: number | null;
  log: readonly SessionEvent[];
  now: Date;
  width: number;
  height: number;
  estimateMinutes?: number;
}

export function facePhase(input: {
  sessionActive: boolean;
  countdownSec: number;
}): FacePhase {
  if (!input.sessionActive) {
    return "idle";
  }
  if (input.countdownSec > 0) {
    return "break";
  }
  return "focus";
}

export function toFaceEvents(log: readonly SessionEvent[]): FaceEvent[] {
  return log.map((event) => {
    const kind = event.kind.toLowerCase();
    const kill = kind === "kill" || kind === "demo";
    return {
      ts: event.ts,
      kind: event.kind,
      detail: event.detail,
      severity: kill ? 1 : undefined,
    };
  });
}

export function countKills(events: readonly FaceEvent[]): number {
  return events.filter((event) => {
    const kind = event.kind.toLowerCase();
    return kind === "kill" || kind === "demo";
  }).length;
}

export function faceSessionId(startedAt: number | null, sessionActive: boolean): string {
  if (!sessionActive || startedAt === null) {
    return "idle";
  }
  return `sess-${startedAt}`;
}

export function faceProgress(input: {
  phase: FacePhase;
  elapsedMs: number;
  estimateMinutes: number;
  countdownSec: number;
  fuseArmedSec: number;
}): number {
  if (input.phase === "idle") {
    return 0;
  }
  if (input.phase === "break" && input.fuseArmedSec > 0) {
    return clamp01(1 - input.countdownSec / input.fuseArmedSec);
  }
  const estimateMs = input.estimateMinutes * 60_000;
  if (estimateMs <= 0) {
    return 0;
  }
  return clamp01(input.elapsedMs / estimateMs);
}

export function remainingMs(input: {
  phase: FacePhase;
  elapsedMs: number;
  estimateMinutes: number;
  countdownSec: number;
}): number {
  if (input.phase === "break") {
    return Math.max(0, input.countdownSec * 1000);
  }
  return Math.max(0, input.estimateMinutes * 60_000 - input.elapsedMs);
}

export function buildFaceProps(input: BuildFacePropsInput): FaceProps {
  const estimateMinutes =
    input.estimateMinutes !== undefined && Number.isFinite(input.estimateMinutes)
      ? Math.max(1, input.estimateMinutes)
      : DEFAULT_ESTIMATE_MINUTES;
  const elapsedMs = input.sessionActive ? Math.max(0, (input.elapsedSec ?? 0) * 1000) : 0;
  const phase = facePhase({
    sessionActive: input.sessionActive,
    countdownSec: input.countdownSec,
  });
  const events = toFaceEvents(input.log);
  return {
    progress: faceProgress({
      phase,
      elapsedMs,
      estimateMinutes,
      countdownSec: input.countdownSec,
      fuseArmedSec: input.fuseArmedSec,
    }),
    phase,
    elapsedMs,
    remainingMs: remainingMs({
      phase,
      elapsedMs,
      estimateMinutes,
      countdownSec: input.countdownSec,
    }),
    estimateMinutes,
    sessionId: faceSessionId(input.startedAt, input.sessionActive),
    events,
    killCount: countKills(events),
    now: input.now,
    width: input.width,
    height: input.height,
  };
}

export function selectedFaceId(value: unknown): FaceId {
  return normalizeFaceId(value);
}
