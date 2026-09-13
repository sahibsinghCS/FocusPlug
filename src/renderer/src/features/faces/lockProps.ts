import type { FacePhase } from "@shared/faces";
import type { SessionEvent } from "@shared/ipc";
import type { RunPosition, RunStatus } from "../timer/runtime";
import { countKills, faceSessionId, toFaceEvents } from "./props";
import type { FaceProps } from "./types";

export interface BuildLockFacePropsInput {
  status: RunStatus;
  position: RunPosition | null;
  elapsedSec: number;
  remainingSec: number;
  planFocusMin: number;
  log: readonly SessionEvent[];
  /** Wall-clock from `useSessionTimer.start()`. Older persisted events stay out. */
  startedAtMs: number | null;
  now: Date;
  width: number;
  height: number;
}

/** Only events at or after this session's start. Earlier kills belong to last time. */
export function sessionLogSince(
  log: readonly SessionEvent[],
  startedAtMs: number | null,
): SessionEvent[] {
  if (startedAtMs === null) {
    return [];
  }
  return log.filter((event) => event.ts >= startedAtMs);
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
  const sessionElapsedMs = Math.max(0, input.elapsedSec) * 1000;
  const sessionRemainingMs = Math.max(0, input.remainingSec) * 1000;
  const sessionTotalMs = sessionElapsedMs + sessionRemainingMs;
  const sessionProgress =
    input.position?.planProgress ??
    (sessionTotalMs > 0 ? sessionElapsedMs / sessionTotalMs : 0);
  const sessionEstimateMinutes = Math.max(1, sessionTotalMs / 60_000);
  const events = toFaceEvents(sessionLogSince(input.log, input.startedAtMs));
  return {
    progress,
    phase,
    elapsedMs,
    remainingMs,
    estimateMinutes,
    sessionProgress,
    sessionElapsedMs,
    sessionRemainingMs,
    sessionEstimateMinutes,
    sessionId: faceSessionId(input.startedAtMs, input.startedAtMs !== null),
    events,
    killCount: countKills(events),
    now: input.now,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    // Live lock must keep painting (sand, flame, globe, leak). Catalog
    // previews freeze via previewFaceProps — never this mapper.
    paused: false,
  };
}
