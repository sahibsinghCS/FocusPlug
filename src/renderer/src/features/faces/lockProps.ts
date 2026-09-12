import type { FacePhase } from "@shared/faces";
import type { SessionEvent } from "@shared/ipc";
import type { RunPosition, RunStatus } from "../timer/runtime";
import { countKills, toFaceEvents } from "./props";
import type { FaceProps } from "./types";

export interface BuildLockFacePropsInput {
  status: RunStatus;
  position: RunPosition | null;
  elapsedSec: number;
  remainingSec: number;
  planFocusMin: number;
  log: readonly SessionEvent[];
  now: Date;
  width: number;
  height: number;
  paused?: boolean;
}

/**
 * Lock-timer "break" is a scheduled rest between rounds.
 *
 * `facePhase()` in props.ts maps the kill COUNTDOWN (`countdownSec > 0`) to
 * FacePhase "break" — that is a fuse, not a rest. Lock mode must not feed
 * that mapper. The kill overlay already owns the countdown. Scheduled rest
 * is the only time a lock face gets phase "break".
 */
export function lockFacePhase(status: RunStatus, position: RunPosition | null): FacePhase {
  if (status === "setup" || status === "done" || !position) {
    return "idle";
  }
  if (position.segment.kind === "break") {
    return "break";
  }
  return "focus";
}

export function buildLockFaceProps(input: BuildLockFacePropsInput): FaceProps {
  const phase = lockFacePhase(input.status, input.position);
  const segmentSec = input.position?.segment.seconds ?? Math.max(1, input.planFocusMin) * 60;
  const estimateMinutes = Math.max(1, segmentSec / 60);
  const progress = input.position?.segmentProgress ?? 0;
  const remainingMs = Math.max(0, (input.position?.remainingSec ?? input.remainingSec) * 1000);
  const elapsedMs = Math.max(0, progress * segmentSec * 1000);
  const events = toFaceEvents(input.log);
  return {
    progress,
    phase,
    elapsedMs,
    remainingMs,
    estimateMinutes,
    sessionId: "lock",
    events,
    killCount: countKills(events),
    now: input.now,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    paused: input.paused === true || input.status === "paused",
  };
}
