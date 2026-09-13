import { DEFAULT_ESTIMATE_MINUTES } from "@shared/faces";
import type { FaceProps } from "../types";
import type { FaceSettings } from "./airports";

/** Session clock Flight reads from frozen FaceProps. */
export interface FlightClock {
  remaining: number;
  estimateMinutes: number;
  now: number;
  paused: boolean;
  complete: boolean;
  reducedMotion: boolean;
  settings?: FaceSettings;
}

export interface FlightClockExtras {
  paused?: boolean;
  reducedMotion?: boolean;
  settings?: FaceSettings;
  /** Stills-only override so a 7h JFK–LHR block can be injected without forking FaceHost. */
  estimateMinutes?: number;
}

function finiteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Whole-session Flight clock.
 *
 * Lock FaceProps are still per-segment (`progress` / `estimateMinutes` reset
 * each round). Feeding those to km / ETA / GS made a 5-minute DUB–EDI break
 * read 4,032 kph — each rest was a new hop. When `session*` is present, Flight
 * treats the sit as one flight: remaining and estimate come from the whole
 * plan, so cruise GS is session-average in focus and break. A cruise cap in
 * `groundSpeedKmh` keeps a short sit on a long pair under 1,000 kph.
 */
export function toFlightClock(props: FaceProps, extras: FlightClockExtras = {}): FlightClock {
  if (!(props.now instanceof Date) || Number.isNaN(props.now.getTime())) {
    throw new Error("toFlightClock requires FaceProps.now as a valid Date");
  }
  if (!Number.isFinite(props.remainingMs) || !Number.isFinite(props.elapsedMs)) {
    throw new Error("toFlightClock requires finite remainingMs and elapsedMs");
  }
  if (!Number.isFinite(props.progress)) {
    throw new Error("toFlightClock requires a finite progress");
  }

  const stillsEstimate =
    extras.estimateMinutes !== undefined && Number.isFinite(extras.estimateMinutes)
      ? Math.max(1, extras.estimateMinutes)
      : undefined;
  const sessionEstimate = sessionEstimateMinutes(props);
  const estimateMinutes =
    stillsEstimate ??
    sessionEstimate ??
    (finiteNumber(props.estimateMinutes) ? Math.max(1, props.estimateMinutes) : DEFAULT_ESTIMATE_MINUTES);

  const totalMs = estimateMinutes * 60_000;
  const progress = flightMetricProgress(props, estimateMinutes, stillsEstimate !== undefined);

  const sessionRemainingMs = stillsEstimate !== undefined
    ? Math.max(0, (1 - progress) * totalMs)
    : finiteNumber(props.sessionRemainingMs)
      ? Math.max(0, props.sessionRemainingMs)
      : props.phase === "break"
        ? Math.max(0, totalMs - Math.max(0, props.elapsedMs))
        : Math.max(0, props.remainingMs);

  const complete = props.phase !== "idle" && (progress >= 0.995 || sessionRemainingMs <= 0);

  return {
    remaining: complete ? 0 : sessionRemainingMs / 1000,
    estimateMinutes,
    now: props.now.getTime(),
    paused: extras.paused ?? props.paused ?? props.phase !== "focus",
    complete,
    reducedMotion: extras.reducedMotion ?? false,
    settings: extras.settings,
  };
}

function sessionEstimateMinutes(props: FaceProps): number | undefined {
  if (finiteNumber(props.sessionEstimateMinutes)) {
    return Math.max(1, props.sessionEstimateMinutes);
  }
  if (finiteNumber(props.sessionElapsedMs) && finiteNumber(props.sessionRemainingMs)) {
    const total = Math.max(0, props.sessionElapsedMs) + Math.max(0, props.sessionRemainingMs);
    if (total > 0) {
      return Math.max(1, total / 60_000);
    }
  }
  return undefined;
}

function flightMetricProgress(
  props: FaceProps,
  estimateMinutes: number,
  stillsEstimate: boolean,
): number {
  if (props.phase === "idle") {
    return 0;
  }
  if (stillsEstimate) {
    return clamp01(props.progress);
  }
  if (finiteNumber(props.sessionProgress)) {
    return clamp01(props.sessionProgress);
  }
  if (finiteNumber(props.sessionElapsedMs)) {
    return clamp01(props.sessionElapsedMs / (estimateMinutes * 60_000));
  }
  return clamp01(props.progress);
}
