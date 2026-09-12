import type { FacePhase, FaceProps, FaceRound, FaceSource } from "./instrument";
import { DEFAULT_FACE_DURATION_MS } from "./instrument";
import { clamp01, faceEventsFromLog, findSessionStartedAt } from "./events";

function hashId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function roundAtProgress(
  rounds: readonly FaceRound[] | undefined,
  progress: number,
): FaceRound | null {
  if (!rounds || rounds.length === 0) {
    return null;
  }
  const p = clamp01(progress, true);
  for (const round of rounds) {
    if (p >= round.start && p < round.end) {
      return round;
    }
  }
  const last = rounds[rounds.length - 1];
  return last ?? null;
}

export function derivePhase(source: FaceSource, progress: number): FacePhase {
  if (source.countdownSec > 0 && source.sessionActive) {
    return "countdown";
  }
  if (!source.sessionActive) {
    if (progress >= 0.999) {
      return "ended";
    }
    return "idle";
  }
  const current = roundAtProgress(source.rounds, progress);
  if (current?.kind === "break") {
    return "break";
  }
  return "focus";
}

export function deriveFaceProps(source: FaceSource): FaceProps {
  const durationMs =
    source.durationMs && source.durationMs > 0 ? source.durationMs : DEFAULT_FACE_DURATION_MS;
  const fromLog = findSessionStartedAt(source.log, source.sessionActive);
  const elapsedMs = Math.max(0, source.elapsedMs ?? 0);
  const startedAt =
    fromLog ??
    (source.sessionActive || elapsedMs > 0 ? source.nowMs - elapsedMs : null);
  const origin = startedAt ?? source.nowMs;
  const progress = durationMs > 0 ? elapsedMs / durationMs : 0;
  const sessionId = source.sessionId ?? (startedAt ? hashId(String(startedAt)) : "fp-idle");
  const events = faceEventsFromLog(source.log, origin, durationMs);
  const phase = derivePhase(source, progress);

  return {
    progress,
    phase,
    events,
    sessionId,
    remainingMs: Math.max(0, durationMs - elapsedMs),
    elapsedMs,
    durationMs,
    nowMs: source.nowMs,
    startedAt,
    decision: source.decision,
    rounds: source.rounds,
    paused: source.paused,
    freeze: source.freeze,
    lineMode: source.lineMode,
  };
}

export function formatRemain(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
