import { classify } from "../../../../src/shared/policy";
import type { DeskSnapshot, FocusSnapshot } from "../../../../src/shared/types";
import { extractFeatures } from "../../../../src/shared/forecast/features";
import { TelemetryRing, type TelemetryFrame } from "../../../../src/shared/forecast/ring";
import type { DecisionFrame } from "../../../../src/shared/forecast/labels";
import {
  REPLAY_DESK_THRESHOLD,
  REPLAY_STRICT_MODE,
  type RawDeskEvent,
  type RawFocusEvent,
  type RawSession,
} from "../../lib";

/**
 * hybrid candidate — SEVEN extra features, every one of them read off the
 * SHIPPED `TelemetryRing` public API at inference time (frames ring: 600 s of
 * 1 Hz frames; transition list: last 128 focus/title transitions; session
 * scalars). No new telemetry, no new capture, no new plumbing: a runtime
 * implementation would be `extractFeatures` with seven more lines.
 *
 * They exist to close the two documented recall holes (GAUNTLET round 7:
 * wanderer 7/22 hits, burst 14/24):
 *
 *  - the shipped grey-occupancy features are 30 s / 60 s windows, and a
 *    wanderer's loiter runs 120–200 s — they SATURATE long before the hazard
 *    turns on, so the model cannot tell a 40 s loiter (safe) from a 160 s one
 *    (about to tab out). `otherFrac180` + `greyLeaky120` restore episode age.
 *  - the simulator makes imminence observable through a *crescendo*: dwells
 *    shrink and title flips speed up as the loiter deepens. The shipped
 *    `switchAccel` (15 s vs 60 s) is too short-baselined to see the ramp and
 *    there is no title-churn analogue at all. `dwellShrink30v90` +
 *    `titleChurnAccel` read it directly.
 *  - `deskSagSlope30` / `absenceRun60` give the walk_away head the *shape* of
 *    a desk departure (a sag ramp, a lengthening absence) instead of the
 *    shipped mean/σ/flicker-count summary.
 *  - `repeatRatio60` (switches per distinct app) separates cycling inside a
 *    small known set (research_churn: 4 allow apps, no drift) from exploring
 *    new ones — the discriminator that buys FPR headroom, which is what pays
 *    for a lower nudge threshold.
 */

export const HYBRID_EXTRA_KEYS = [
  "otherFrac180",
  "greyLeaky120",
  "dwellShrink30v90",
  "titleChurnAccel",
  "deskSagSlope30",
  "absenceRun60",
  "repeatRatio60",
] as const;

export type HybridExtraKey = (typeof HYBRID_EXTRA_KEYS)[number];

export const HYBRID_EXTRA_DIM = HYBRID_EXTRA_KEYS.length;

/** ε in rate ratios — same role as features.ts's SWITCH_ACCEL_EPS. */
const RATE_EPS = 0.01;
/** Leaky grey-occupancy time constant (s) — the generator's own hazard driver. */
const GREY_TAU_SEC = 120;
/** Desk sag saturating slope: 0.02 confidence/s ⇒ 0.6 lost over 30 s. */
const SAG_FULL_SCALE = 0.02;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Extra encoded features in `HYBRID_EXTRA_KEYS` order, all in [0,1], all
 * NaN-free, all neutral-valued when the evidence is missing (webcam off ⇒
 * desk extras 0, empty ring ⇒ ratio extras at their quiet-ring value).
 */
export function extractExtended(ring: TelemetryRing, ts: number): number[] {
  const frames600 = ring.framesInRange(ts - 600_000, ts);

  // --- grey-occupancy depth: 180 s window + a τ=120 s leaky tracker --------
  let other180 = 0;
  let n180 = 0;
  let leakyNum = 0;
  let leakyDen = 0;
  for (const frame of frames600) {
    const ageSec = (ts - frame.ts) / 1000;
    const isOther = frame.focusKind === "other";
    if (ageSec <= 180) {
      n180 += 1;
      if (isOther) {
        other180 += 1;
      }
    }
    const weight = Math.exp(-ageSec / GREY_TAU_SEC);
    leakyDen += weight;
    if (isOther) {
      leakyNum += weight;
    }
  }
  const otherFrac180 = n180 > 0 ? other180 / n180 : 0;
  const greyLeaky120 = leakyDen > 0 ? leakyNum / leakyDen : 0;

  // --- dwell shrink: 30 s switch rate against a 90 s baseline --------------
  const proc30 = ring.transitionsInRange(ts - 30_000, ts, "proc").length;
  const proc90 = ring.transitionsInRange(ts - 90_000, ts, "proc").length;
  const dwellShrink = (proc30 / 30 + RATE_EPS) / (proc90 / 90 + RATE_EPS);

  // --- title-churn crescendo: 30 s rate against the 60 s rate --------------
  const title30 = ring.transitionsInRange(ts - 30_000, ts, "title").length;
  const title60 = ring.transitionsInRange(ts - 60_000, ts, "title").length;
  const titleAccel = (title30 / 30 + RATE_EPS) / (title60 / 60 + RATE_EPS);

  // --- desk departure shape: sag slope + longest absence run ---------------
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const desk30: TelemetryFrame[] = [];
  for (const frame of frames600) {
    if (!frame.webcamEnabled || frame.ts <= ts - 30_000) {
      continue;
    }
    desk30.push(frame);
    sumX += (frame.ts - ts) / 1000;
    sumY += frame.deskConfidence;
    count += 1;
  }
  let sag = 0;
  if (count >= 5) {
    const meanX = sumX / count;
    const meanY = sumY / count;
    let num = 0;
    let den = 0;
    for (const frame of desk30) {
      const dx = (frame.ts - ts) / 1000 - meanX;
      num += dx * (frame.deskConfidence - meanY);
      den += dx * dx;
    }
    if (den > 1e-9) {
      // Slope in confidence per second; a NEGATIVE slope is a sag.
      sag = Math.max(0, -(num / den));
    }
  }
  let absenceRun = 0;
  let run = 0;
  for (const frame of frames600) {
    if (frame.ts <= ts - 60_000 || !frame.webcamEnabled) {
      continue;
    }
    if (frame.deskPresence === "present") {
      run = 0;
    } else {
      run += 1;
      if (run > absenceRun) {
        absenceRun = run;
      }
    }
  }

  // --- churn shape: switches per distinct app over 60 s --------------------
  const procTransitions60 = ring.transitionsInRange(ts - 60_000, ts, "proc");
  const distinct = new Set<string>();
  for (const frame of frames600) {
    if (frame.ts > ts - 60_000 && frame.processKey !== "") {
      distinct.add(frame.processKey);
    }
  }
  for (const transition of procTransitions60) {
    if (transition.fromKey !== "") {
      distinct.add(transition.fromKey);
    }
    if (transition.toKey !== "") {
      distinct.add(transition.toKey);
    }
  }
  if (ring.currentProcessKey !== "") {
    distinct.add(ring.currentProcessKey);
  }
  const repeatRatio = procTransitions60.length / Math.max(1, distinct.size);

  const encoded: Record<HybridExtraKey, number> = {
    otherFrac180: clamp01(otherFrac180),
    greyLeaky120: clamp01(greyLeaky120),
    dwellShrink30v90: clamp01(dwellShrink / 4),
    titleChurnAccel: clamp01(titleAccel / 4),
    deskSagSlope30: clamp01(sag / SAG_FULL_SCALE),
    absenceRun60: clamp01(absenceRun / 20),
    repeatRatio60: clamp01(repeatRatio / 5),
  };
  return HYBRID_EXTRA_KEYS.map((key) => encoded[key]);
}

export interface ExtendedFrame {
  /** Seconds since session start (1-based), matching dataset rows' `t`. */
  t: number;
  /** The SHIPPED 18 encoded features (used to self-check the join). */
  base: number[];
  /** The 7 extras above. */
  extra: number[];
  decision: DecisionFrame["decision"];
  countdownActive: boolean;
}

/**
 * Byte-for-byte the replay loop of `lib.replaySession` (shared ring →
 * `classify` → `extractFeatures`), with `extractExtended` called on the same
 * ring at the same instant. Cloned rather than imported because lib.ts is
 * shared code this candidate may not edit; the base-18 output is asserted
 * against dataset.jsonl's own columns in hybrid.ts, so any drift is caught.
 */
export function replaySessionExtended(session: RawSession): ExtendedFrame[] {
  const ring = new TelemetryRing(0);
  ring.reset(0);
  const frames: ExtendedFrame[] = [];
  let focusIndex = 0;
  let deskIndex = 0;
  let lastFocus: FocusSnapshot | null = null;
  let lastDesk: DeskSnapshot | null = null;

  for (let t = 1; t <= session.durationSec; t += 1) {
    const ts = t * 1000;
    while (
      focusIndex < session.focus.length &&
      (session.focus[focusIndex] as RawFocusEvent).ts <= ts
    ) {
      const event = session.focus[focusIndex] as RawFocusEvent;
      lastFocus = {
        ts: event.ts,
        processName: event.proc,
        windowTitle: event.title,
        matchedAllow: event.allow,
        matchedBlock: event.block,
      };
      ring.noteFocus(lastFocus);
      focusIndex += 1;
    }
    while (deskIndex < session.desk.length && (session.desk[deskIndex] as RawDeskEvent).ts <= ts) {
      const event = session.desk[deskIndex] as RawDeskEvent;
      lastDesk = {
        ts: event.ts,
        label: event.label,
        confidence: event.conf,
        webcamEnabled: event.on,
      };
      ring.noteDesk(lastDesk, REPLAY_DESK_THRESHOLD);
      deskIndex += 1;
    }
    const classified = classify({
      sessionActive: true,
      focus: lastFocus,
      desk: lastDesk,
      countdownSec: 10,
      deskThreshold: REPLAY_DESK_THRESHOLD,
      strictMode: REPLAY_STRICT_MODE,
    });
    ring.noteStatus(classified.decision);
    ring.commit(ts);
    frames.push({
      t,
      base: extractFeatures(ring, ts).values,
      extra: extractExtended(ring, ts),
      decision: classified.decision,
      countdownActive:
        classified.decision === "DISTRACTED" || classified.decision === "AWAY",
    });
  }
  return frames;
}
