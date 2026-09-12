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

  const estimateMinutes =
    extras.estimateMinutes !== undefined && Number.isFinite(extras.estimateMinutes)
      ? Math.max(1, extras.estimateMinutes)
      : props.estimateMinutes !== undefined && Number.isFinite(props.estimateMinutes)
        ? Math.max(1, props.estimateMinutes)
        : DEFAULT_ESTIMATE_MINUTES;

  const totalMs = estimateMinutes * 60_000;
  const progress =
    props.phase === "idle" ? 0 : Math.min(1, Math.max(0, props.progress));

  const sessionRemainingMs =
    extras.estimateMinutes !== undefined
      ? Math.max(0, (1 - progress) * totalMs)
      : props.phase === "break"
        ? Math.max(0, totalMs - Math.max(0, props.elapsedMs))
        : Math.max(0, props.remainingMs);

  const complete = props.phase !== "idle" && progress >= 0.995;

  return {
    remaining: complete ? 0 : sessionRemainingMs / 1000,
    estimateMinutes,
    now: props.now.getTime(),
    paused: extras.paused ?? props.phase !== "focus",
    complete,
    reducedMotion: extras.reducedMotion ?? false,
    settings: extras.settings,
  };
}
