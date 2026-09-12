/**
 * The simulated population, shared by the eval and the dataset export.
 *
 * Everything in here is invented. It is a stand-in for a user study that does
 * not exist yet, and its job is to be a hard, varied test — not evidence about
 * real students. Two honest limits, stated here so they are not discovered
 * later as if they were findings:
 *
 *   - The four habits and the covariate effects below are hand-written. A prior
 *     fitted on this data recovers *these assumptions*, not human behaviour.
 *   - `priorDrifts` and `priorKills` are recorded but given no causal effect,
 *     because recovery times are drawn before any policy runs so that every
 *     policy faces the identical person. A prior fitted on this data will
 *     correctly learn ~0 for those two features. That is a property of the
 *     simulator, not a claim about them.
 *
 * Replacing this generator with real logged drifts — or with a dataset shaped by
 * something better than a hand-written sampler — is the upgrade path, and the
 * reason the export exists.
 */

import type { DriftMoment } from "./features";

export interface Habit {
  name: string;
  /** Chance they come back at all, rather than sinking into it. */
  returns: number;
  /** Typical seconds to notice and come back. */
  medianSec: number;
  spread: number;
}

export const HABITS: readonly Habit[] = [
  { name: "snaps back", returns: 0.92, medianSec: 4, spread: 1.8 },
  { name: "drifts, then returns", returns: 0.78, medianSec: 13, spread: 5 },
  { name: "slow to notice", returns: 0.6, medianSec: 22, spread: 7 },
  { name: "gone once gone", returns: 0.08, medianSec: 26, spread: 8 },
];

/** Deterministic so the printed numbers and the exported file are reproducible. */
export function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

const BLOCKED_APPS = ["discord", "steam", "chrome", "spotify", "roblox", "valorant"];
const SESSION_LENGTHS = [25, 50, 90];
/** Evening-weighted, with a few genuinely late nights. */
const HOURS = [14, 15, 16, 17, 18, 19, 20, 20, 21, 21, 22, 23, 0, 1];

/** The observable situation at the instant a countdown starts. */
export interface Covariates {
  hour: number;
  plannedMin: number;
  elapsedMin: number;
  dwellMs: number;
  switchesLastTwoMin: number;
  violation: "blocked" | "away";
  focusProcess: string;
  deskLabel: "at_desk" | "away" | "uncertain" | "";
  deskConfidence: number;
  webcamEnabled: boolean;
}

export function drawCovariates(random: () => number): Covariates {
  const plannedMin = pick(SESSION_LENGTHS, random);
  const violation: "blocked" | "away" = random() < 0.7 ? "blocked" : "away";
  const webcamEnabled = random() < 0.85;

  let deskLabel: Covariates["deskLabel"] = "";
  let deskConfidence = 0;
  if (webcamEnabled) {
    if (violation === "away") {
      deskLabel = random() < 0.85 ? "away" : "uncertain";
    } else {
      deskLabel = random() < 0.9 ? "at_desk" : "uncertain";
    }
    deskConfidence = deskLabel === "uncertain" ? 0.4 + random() * 0.2 : 0.6 + random() * 0.38;
  }

  return {
    hour: pick(HOURS, random),
    plannedMin,
    elapsedMin: 1 + random() * (plannedMin - 1),
    // Mostly a fresh switch, sometimes a long sit in the wrong window.
    dwellMs: Math.round(400 + random() * random() * 90_000),
    switchesLastTwoMin: Math.floor(random() * 12),
    violation,
    focusProcess: violation === "blocked" ? pick(BLOCKED_APPS, random) : "",
    deskLabel,
    deskConfidence,
    webcamEnabled,
  };
}

/**
 * How the situation nudges self-correction, on top of the habit. Deliberately
 * small — the habit is meant to dominate — and signed the way the hand-set prior
 * guessed, so the eval is not quietly rigged to agree with it in magnitude.
 */
function modifiers(covariates: Covariates): { returns: number; medianSec: number } {
  const lateNight = covariates.hour >= 22 || covariates.hour < 5 ? 1 : 0;
  const switchRate = Math.min(1, covariates.switchesLastTwoMin / 12);
  const deep = Math.min(1, covariates.elapsedMin / 120);

  const returns =
    (1 - 0.15 * lateNight) *
    (1 - 0.15 * switchRate) *
    (1 - 0.1 * deep) *
    (covariates.violation === "blocked" ? 0.95 : 1);
  const medianSec = 3 * lateNight + 4 * switchRate + 3 * deep;

  return { returns, medianSec };
}

/** How long this drift would have taken to fix on their own, or null if never. */
export function drawRecovery(
  habit: Habit,
  covariates: Covariates,
  random: () => number,
): number | null {
  const nudge = modifiers(covariates);
  if (random() > habit.returns * nudge.returns) {
    return null;
  }
  // Two uniforms make a rough bell without pulling in a normal sampler.
  const noise = (random() + random() - 1) * habit.spread;
  return Math.max(1, habit.medianSec + nudge.medianSec + noise);
}

export interface SimDrift {
  covariates: Covariates;
  /** What they would do, independent of the fuse they are about to be given. */
  latentRecoverySec: number | null;
}

export interface Student {
  habit: Habit;
  /** Drawn up front so every policy faces the same person on the same drifts. */
  drifts: SimDrift[];
}

export interface PopulationOptions {
  students: number;
  driftsEach: number;
  seed?: number;
}

export function population(options: PopulationOptions): Student[] {
  const random = rng(options.seed ?? 20260911);
  const students: Student[] = [];

  for (let index = 0; index < options.students; index += 1) {
    const habit = HABITS[index % HABITS.length]!;
    const drifts: SimDrift[] = [];
    for (let drift = 0; drift < options.driftsEach; drift += 1) {
      const covariates = drawCovariates(random);
      drifts.push({ covariates, latentRecoverySec: drawRecovery(habit, covariates, random) });
    }
    students.push({ habit, drifts });
  }

  return students;
}

/** The covariates as the policy would have seen them, at a given fuse. */
export function momentFor(
  drift: SimDrift,
  at: number,
  fuseSec: number,
  history: { priorDrifts: number; priorKills: number },
): DriftMoment {
  const { covariates } = drift;
  const sessionStartedAt = at - covariates.elapsedMin * 60_000;

  return {
    ts: at,
    sessionStartedAt,
    sessionEndsAt: sessionStartedAt + covariates.plannedMin * 60_000,
    focus: {
      ts: at,
      processName: covariates.focusProcess,
      windowTitle: covariates.focusProcess,
      matchedAllow: false,
      matchedBlock: covariates.violation === "blocked",
    },
    desk:
      covariates.deskLabel === ""
        ? null
        : {
            ts: at,
            label: covariates.deskLabel,
            confidence: covariates.deskConfidence,
            webcamEnabled: covariates.webcamEnabled,
          },
    violation: covariates.violation,
    dwellMs: covariates.dwellMs,
    switchesLastTwoMin: covariates.switchesLastTwoMin,
    priorDrifts: history.priorDrifts,
    priorKills: history.priorKills,
    fuseSec,
    hour: covariates.hour,
  };
}
