import { useEffect, useState } from "react";

/**
 * How often lock faces receive a new wall-clock `now`.
 *
 * Canvas faces (flight, hourglass, flask, candle, garden, movement, record)
 * already self-animate via their own `requestAnimationFrame` loops. Publishing
 * `now` on every frame re-rendered the whole lock stage for the session.
 */
export const LIVE_FACE_NOW_MS = 250;

/**
 * Tick the lock-face wall clock on a throttled cadence. Independent of pause —
 * live lock must keep painting even when the timer is held.
 */
export function startLiveFaceNowClock(
  publish: (now: Date) => void,
  intervalMs: number = LIVE_FACE_NOW_MS,
): () => void {
  if (typeof publish !== "function") {
    throw new Error("startLiveFaceNowClock requires a publish function");
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("live face now interval must be a positive finite number");
  }
  const id = setInterval(() => {
    publish(new Date());
  }, intervalMs);
  return () => {
    clearInterval(id);
  };
}

/** Wall clock for faces that paint from `now`, independent of pause. */
export function useLiveFaceNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => startLiveFaceNowClock(setNow), []);
  return now;
}
