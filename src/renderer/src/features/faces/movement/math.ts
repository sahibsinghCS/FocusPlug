import { clamp, lerp } from "../canvas";

/** ~4 Hz escape — 14,400 bph visual rate. Charm is the settle, not the count. */
export const BEAT_HZ = 4;

export const TRAIN = {
  escapeTeeth: 15,
  escapePinion: 8,
  fourthTeeth: 80,
  fourthPinion: 10,
  thirdTeeth: 75,
  thirdPinion: 10,
  centerTeeth: 80,
  centerPinion: 12,
  barrelTeeth: 72,
} as const;

export interface GearAngles {
  beats: number;
  beatFrac: number;
  easedBeats: number;
  escape: number;
  fourth: number;
  third: number;
  center: number;
  barrel: number;
  balance: number;
  pallet: number;
}

/**
 * Overshoot-and-settle for one escape impulse. Not a linear step — the wheel
 * jumps past the rest tooth and eases back, like pallet friction + oil.
 */
export function overshootSettle(t: number): number {
  const x = clamp(t, 0, 1);
  const overshoot = 0.2;
  if (x < 0.3) {
    const u = x / 0.3;
    const eased = 1 - (1 - u) ** 3;
    return eased * (1 + overshoot);
  }
  const u = (x - 0.3) / 0.7;
  const decay = Math.exp(-5.4 * u) * Math.cos(u * Math.PI * 1.05);
  const raw = 1 + overshoot * decay;
  return lerp(raw, 1, u * u * u);
}

export function gearAngles(elapsedSec: number): GearAngles {
  const safe = Number.isFinite(elapsedSec) ? Math.max(0, elapsedSec) : 0;
  const beats = safe * BEAT_HZ;
  const i = Math.floor(beats);
  const beatFrac = beats - i;
  const easedBeats = i + overshootSettle(beatFrac);
  const escape = (easedBeats / TRAIN.escapeTeeth) * Math.PI * 2;
  const fourth = -escape * (TRAIN.escapePinion / TRAIN.fourthTeeth);
  const third = -fourth * (TRAIN.fourthPinion / TRAIN.thirdTeeth);
  const center = -third * (TRAIN.thirdPinion / TRAIN.centerTeeth);
  const barrel = -center * (TRAIN.centerPinion / TRAIN.barrelTeeth);
  const dir = i % 2 === 0 ? 1 : -1;
  const amp = (46 * Math.PI) / 180;
  const travel = Math.min(overshootSettle(beatFrac), 1.16);
  const balance = -dir * amp + dir * amp * 2 * travel;
  const pallet = -dir * 0.22 * Math.min(travel, 1);
  return {
    beats,
    beatFrac,
    easedBeats,
    escape,
    fourth,
    third,
    center,
    barrel,
    balance,
    pallet,
  };
}

/** Remaining wind (horological): dense coils at session start, relaxing as time elapses. */
export function springTurns(progress: number): number {
  const wind = 1 - clamp(progress, 0, 1);
  return lerp(3.4, 11.6, wind);
}

export function springDensity(progress: number): number {
  return springTurns(progress) / 11.6;
}

export function elapsedFromBeats(beats: number): number {
  return beats / BEAT_HZ;
}
