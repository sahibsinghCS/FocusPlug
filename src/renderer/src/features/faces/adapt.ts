import type { SessionEvent } from "@shared/ipc";
import { faceEventsFromLog } from "./events";
import type { FaceRound, InstrumentPhase, InstrumentProps, LineStationMode } from "./instrument";
import type { FaceProps } from "./types";
import { readFaceUrl } from "./urlFace";
import { DEMO_ROUNDS } from "./fixtures";

export function toInstrumentProps(
  props: FaceProps,
  extras?: {
    freeze?: boolean;
    rounds?: readonly FaceRound[];
    lineMode?: LineStationMode;
    paused?: boolean;
  },
): InstrumentProps {
  const durationMs = Math.max(
    1,
    props.estimateMinutes && props.estimateMinutes > 0
      ? props.estimateMinutes * 60_000
      : props.elapsedMs + props.remainingMs || 1,
  );
  const nowMs = props.now instanceof Date ? props.now.getTime() : 0;
  const startedAt = nowMs - props.elapsedMs;
  const log: SessionEvent[] = props.events.map((event) => ({
    ts: event.ts,
    kind: event.kind,
    detail: event.detail ?? "",
  }));
  let phase: InstrumentPhase = props.phase;
  if (props.phase === "idle" && props.progress >= 0.999) {
    phase = "ended";
  }
  return {
    progress: props.progress,
    phase,
    events: faceEventsFromLog(log, startedAt, durationMs),
    sessionId: props.sessionId,
    remainingMs: props.remainingMs,
    elapsedMs: props.elapsedMs,
    durationMs,
    nowMs,
    startedAt,
    rounds: extras?.rounds,
    freeze: extras?.freeze,
    paused: extras?.paused === true || extras?.freeze === true || props.paused === true,
    lineMode: extras?.lineMode,
  };
}

export function stillsExtras(): {
  freeze: boolean;
  rounds: readonly FaceRound[] | undefined;
  lineMode: LineStationMode;
} {
  if (typeof window === "undefined") {
    return { freeze: false, rounds: undefined, lineMode: "auto" };
  }
  const url = readFaceUrl();
  const rounds =
    url.scene === "rounds" || url.scene === "break" || url.scene === "artifact"
      ? DEMO_ROUNDS
      : undefined;
  const lineMode: LineStationMode =
    url.scene === "plain" ? "plain" : url.scene === "thirds" ? "thirds" : "auto";
  return { freeze: url.freeze, rounds, lineMode };
}
