/**
 * The feature vector the adaptive fuse learns on.
 *
 * One vector is extracted at the moment a countdown starts — the instant the
 * policy commits to a bet about whether you will fix this yourself. Everything
 * here is already computed by the session loop; nothing new is observed, and
 * nothing leaves the machine.
 *
 * Features are scaled into roughly [0, 1] so a linear model stays well
 * conditioned on the handful of samples a real student will produce in a week.
 */

import type { DeskSnapshot, FocusSnapshot } from "../types";

/** Stable order. The UI reads these to show what the model learned. */
export const FEATURE_NAMES = [
  "bias",
  "blockedWindow",
  "deskAway",
  "deskConfidence",
  "minutesIn",
  "freshSwitch",
  "switchRate",
  "priorDrifts",
  "priorKills",
  "lateNight",
  "sessionLeft",
  "fuseLength",
  // A single linear fuse term can only tilt the curve, never place a step in
  // it — so it cannot say "this person comes back at six seconds". These
  // thresholds let the model learn the shape of someone's recovery time
  // instead of assuming it.
  "fuseOver5",
  "fuseOver8",
  "fuseOver12",
  "fuseOver18",
  "fuseOver25",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export const FEATURE_COUNT = FEATURE_NAMES.length;

/** Plain-language labels, for the panel that shows the learned weights. */
export const FEATURE_LABELS: Record<FeatureName, string> = {
  bias: "Baseline",
  blockedWindow: "Tabbed to a blocked app",
  deskAway: "Left the desk",
  deskConfidence: "Desk AI confidence",
  minutesIn: "Deep into the session",
  freshSwitch: "Just switched windows",
  switchRate: "Switching a lot",
  priorDrifts: "Already drifted today",
  priorKills: "Already been killed today",
  lateNight: "Late at night",
  sessionLeft: "Lots of session left",
  fuseLength: "Fuse it was given",
  fuseOver5: "Given at least 5s",
  fuseOver8: "Given at least 8s",
  fuseOver12: "Given at least 12s",
  fuseOver18: "Given at least 18s",
  fuseOver25: "Given at least 25s",
};

/** Where the step basis places its thresholds, in seconds. */
export const FUSE_STEPS = [5, 8, 12, 18, 25] as const;

export interface DriftMoment {
  /** When the countdown started. */
  ts: number;
  sessionStartedAt: number;
  /** Planned end of the session, for the "how much is left" feature. */
  sessionEndsAt: number;
  focus: FocusSnapshot | null;
  desk: DeskSnapshot | null;
  /** Why the policy started a countdown. */
  violation: "blocked" | "away";
  /** How long the current window had been focused when it started. */
  dwellMs: number;
  /** Foreground-window changes in the last two minutes. */
  switchesLastTwoMin: number;
  /** Countdowns already started this session, before this one. */
  priorDrifts: number;
  /** Kills already carried out this session. */
  priorKills: number;
  /** The fuse this countdown was actually given, in seconds. */
  fuseSec: number;
  /** Local hour 0-23. Injectable so tests do not depend on the wall clock. */
  hour: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function extractFeatures(moment: DriftMoment): number[] {
  const elapsedMin = Math.max(0, moment.ts - moment.sessionStartedAt) / 60_000;
  const plannedMin = Math.max(1, moment.sessionEndsAt - moment.sessionStartedAt) / 60_000;
  const dwellSec = Math.max(0, moment.dwellMs) / 1000;

  const deskAway = moment.desk?.label === "away" ? 1 : 0;
  const deskConfidence =
    moment.desk && moment.desk.webcamEnabled && moment.desk.label !== "uncertain"
      ? clamp01(moment.desk.confidence)
      : 0;

  const vector = [
    1,
    moment.violation === "blocked" ? 1 : 0,
    deskAway,
    deskConfidence,
    // Two hours in is as "deep" as this feature gets.
    clamp01(elapsedMin / 120),
    // A switch seconds ago reads very differently from one ten minutes ago.
    clamp01(Math.exp(-dwellSec / 30)),
    clamp01(moment.switchesLastTwoMin / 12),
    clamp01(moment.priorDrifts / 4),
    clamp01(moment.priorKills / 2),
    moment.hour >= 22 || moment.hour < 5 ? 1 : 0,
    clamp01(1 - elapsedMin / plannedMin),
    // The fuse is a feature because it causes the outcome: more seconds is
    // more chance to recover. Leaving it out would let the model read its own
    // past choices as if they were properties of the person.
    clamp01(moment.fuseSec / 30),
    ...FUSE_STEPS.map((step) => (moment.fuseSec >= step ? 1 : 0)),
  ];

  if (vector.length !== FEATURE_COUNT) {
    throw new Error(
      `Feature vector is ${vector.length} long, FEATURE_NAMES has ${FEATURE_COUNT}`,
    );
  }
  return vector;
}

/** The same moment with a different fuse, for sweeping candidate fuse lengths. */
export function withFuse(moment: DriftMoment, fuseSec: number): DriftMoment {
  return { ...moment, fuseSec };
}
