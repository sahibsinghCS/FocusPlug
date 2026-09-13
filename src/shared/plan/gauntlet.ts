/**
 * Does planning to the measurement beat planning to a constant?
 *
 *   npm run gauntlet:plan
 *
 * This is a SIMULATION, not a user study. It invents students with a true
 * limit and a spread, replays rounds against them, and compares Focus Plan's
 * recommendation with the shipped pomodoro constant. Quote it as a simulation
 * or not at all: the per-install measurement is the real claim, and it has no
 * number until it has watched you work.
 *
 * It reuses `rng()` from `src/shared/adapt/population.ts` rather than writing a
 * second sampler, and it touches no clock and no disk, so it stays inside the
 * purity fence with the rest of this module.
 *
 * The point of the script is the last section. A trend detector that finds
 * trends in noise is worse than no trend detector, so the build fails if the
 * seven gates report `clear` on a stationary population more often than
 * `PLAN_GAUNTLET_MAX_FALSE_TREND`.
 */

import { rng } from "../adapt/population";
import {
  PLAN_DEFAULT_FOCUS_MIN,
  PLAN_GAUNTLET_MAX_FALSE_TREND,
  PLAN_GAUNTLET_SEED,
  PLAN_WINDOW_DAYS,
} from "./constants";
import { civilDayUtc, samplesFrom, selectWindow } from "./ledger";
import { recommend } from "./progression";
import { kaplanMeier } from "./survival";
import { median, planTrend } from "./trend";
import type { HoldSample, PlanRound } from "./types";

const STUDENTS = 400;
const ROUNDS_EACH = 24;
const ROUNDS_PER_DAY = 2;
const FIXED_PLAN_MIN = PLAN_DEFAULT_FOCUS_MIN;
const WITHIN_MIN = 3;
const T0 = 1_788_253_200_000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Student {
  /** Minutes they can hold before drifting, on a typical night. */
  limitMin: number;
  /** Night-to-night spread, in minutes. */
  spreadMin: number;
  /** Minutes per round of true improvement. Zero for the stationary arm. */
  driftPerRound: number;
}

/** Box-Muller off the shared sampler, so every figure is reproducible. */
function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
}

function sampleStudent(random: () => number, driftPerRound: number): Student {
  return {
    limitMin: 12 + random() * 26,
    spreadMin: 2 + random() * 6,
    driftPerRound,
  };
}

/** What this student would have done tonight, before any plan censors it. */
function trueHoldMin(student: Student, index: number, random: () => number): number {
  return Math.max(1, student.limitMin + student.driftPerRound * index + gaussian(random) * student.spreadMin);
}

function roundFrom(index: number, plannedFocusMin: number, holdMin: number): PlanRound {
  const day = Math.floor(index / ROUNDS_PER_DAY);
  const startedAt = T0 + day * DAY_MS + (index % ROUNDS_PER_DAY) * 3 * 60 * 60 * 1000;
  const drifted = holdMin < plannedFocusMin;
  const servedMin = drifted ? Math.min(plannedFocusMin, holdMin + 2) : plannedFocusMin;
  const stamped = civilDayUtc(startedAt);
  return {
    v: 1,
    roundKey: `${startedAt}-1`,
    startedAt,
    endedAt: startedAt + servedMin * 60_000,
    day: stamped.day,
    hour: stamped.hour,
    status: "completed",
    servedSec: servedMin * 60,
    plannedFocusSec: plannedFocusMin * 60,
    round: 1,
    roundsTotal: 1,
    recommendedFocusSec: plannedFocusMin * 60,
    acceptedRecommendation: true,
    firstDriftSec: drifted ? holdMin * 60 : null,
    firstDriftType: drifted ? "tab_out" : null,
    driftsSec: drifted ? [holdMin * 60] : [],
    firstWobbleSec: null,
    wobbles: 0,
    standDowns: 0,
    peakRisk: null,
    peakRiskSec: null,
    firstDriftLeadSec: null,
    countdowns: drifted ? 1 : 0,
    kills: 0,
    startedDrifted: false,
    forecastOn: true,
  };
}

interface Arm {
  cleanRounds: number;
  servedMin: number;
  drifts: number;
}

function emptyArm(): Arm {
  return { cleanRounds: 0, servedMin: 0, drifts: 0 };
}

/**
 * The naive estimator this design exists to avoid: treat a clean round as a
 * hold of exactly its length. It is the single easiest way to lie with this
 * metric, and it biases downward exactly on the good rounds.
 */
function naiveMedian(samples: readonly HoldSample[]): number | null {
  return median(samples.map((sample) => sample.minutes));
}

interface Run {
  planned: Arm;
  fixed: Arm;
  /** Rounds before the KM median first landed within WITHIN_MIN of the truth. */
  roundsToConverge: number | null;
  kmError: number | null;
  naiveError: number | null;
  trendClear: boolean;
}

function runStudent(student: Student, seed: number): Run {
  const random = rng(seed);
  const planned = emptyArm();
  const fixed = emptyArm();
  const plannedRounds: PlanRound[] = [];
  let nextFocusMin = PLAN_DEFAULT_FOCUS_MIN;
  let roundsToConverge: number | null = null;

  for (let index = 0; index < ROUNDS_EACH; index += 1) {
    // The same night for both arms: only the plan differs.
    const hold = trueHoldMin(student, index, random);

    const plannedRound = roundFrom(index, nextFocusMin, hold);
    plannedRounds.push(plannedRound);
    planned.servedMin += plannedRound.servedSec / 60;
    if (plannedRound.firstDriftSec === null) {
      planned.cleanRounds += 1;
    } else {
      planned.drifts += 1;
    }

    const fixedRound = roundFrom(index, FIXED_PLAN_MIN, hold);
    fixed.servedMin += fixedRound.servedSec / 60;
    if (fixedRound.firstDriftSec === null) {
      fixed.cleanRounds += 1;
    } else {
      fixed.drifts += 1;
    }

    const scope = selectWindow(plannedRounds, { includeDiscarded: true });
    const next = recommend({ rounds: scope, live: null, forecastEnabled: true, stretchEnabled: true });
    nextFocusMin = next.focusMin;

    const trueLimit = student.limitMin + student.driftPerRound * index;
    if (
      roundsToConverge === null &&
      next.estimate.medianMin !== null &&
      Math.abs(next.estimate.medianMin - trueLimit) <= WITHIN_MIN
    ) {
      roundsToConverge = index + 1;
    }
  }

  const samples = samplesFrom(selectWindow(plannedRounds, { includeDiscarded: true }));
  const km = kaplanMeier(samples).medianMin;
  const naive = naiveMedian(samples);
  const finalTruth = student.limitMin + student.driftPerRound * (ROUNDS_EACH - 1);

  return {
    planned,
    fixed,
    roundsToConverge,
    kmError: km === null ? null : Math.abs(km - finalTruth),
    naiveError: naive === null ? null : Math.abs(naive - finalTruth),
    trendClear: planTrend(samples).confidence === "clear",
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function report(label: string, driftPerRound: number): Run[] {
  const seeds = rng(PLAN_GAUNTLET_SEED + Math.round(driftPerRound * 1000));
  const runs: Run[] = [];
  for (let i = 0; i < STUDENTS; i += 1) {
    const student = sampleStudent(seeds, driftPerRound);
    runs.push(runStudent(student, PLAN_GAUNTLET_SEED + i * 7919));
  }
  const cleanPlanned = mean(runs.map((r) => r.planned.cleanRounds));
  const cleanFixed = mean(runs.map((r) => r.fixed.cleanRounds));
  const servedPlanned = mean(runs.map((r) => r.planned.servedMin));
  const servedFixed = mean(runs.map((r) => r.fixed.servedMin));
  const converged = runs.map((r) => r.roundsToConverge).filter((v): v is number => v !== null);

  console.log(`\n${label} — ${STUDENTS} students, ${ROUNDS_EACH} rounds each`);
  console.log(
    `  rounds finished without a drift   Focus Plan ${cleanPlanned.toFixed(1)} / ${ROUNDS_EACH}` +
      `   fixed ${FIXED_PLAN_MIN}/5 ${cleanFixed.toFixed(1)} / ${ROUNDS_EACH}`,
  );
  console.log(
    `  focus minutes served              Focus Plan ${servedPlanned.toFixed(0)}` +
      `   fixed ${FIXED_PLAN_MIN}/5 ${servedFixed.toFixed(0)}`,
  );
  console.log(
    `  rounds until the median landed within ${WITHIN_MIN} min of the truth: ` +
      `median ${median(converged) ?? "never"} (${converged.length} of ${STUDENTS} ever did)`,
  );
  return runs;
}

const stationary = report("STATIONARY (no true improvement)", 0);
report("IMPROVING (+0.5 min per round)", 0.5);

/*
 * Is Kaplan-Meier earning its place, or decorating the doc? The naive
 * estimator gets the same rounds and treats a clean round as a hold of exactly
 * its length. If its error is not visibly worse, the censoring machinery is
 * ceremony and should be cut.
 */
const kmErrors = stationary.map((r) => r.kmError).filter((v): v is number => v !== null);
const naiveErrors = stationary.map((r) => r.naiveError).filter((v): v is number => v !== null);
const kmMae = median(kmErrors) ?? Number.NaN;
const naiveMae = median(naiveErrors) ?? Number.NaN;

console.log("\nIs the censoring handling earning its place?");
console.log(`  median absolute error, Kaplan-Meier            ${kmMae.toFixed(2)} min`);
console.log(`  median absolute error, clean rounds as drifts  ${naiveMae.toFixed(2)} min`);
console.log(
  naiveMae > kmMae
    ? `  the naive estimator is ${(naiveMae - kmMae).toFixed(2)} min worse — KM is doing work`
    : "  the naive estimator is NOT worse here, which is an argument for cutting KM",
);

/* The CI gate, and the point of the whole script. */
const falseTrend = stationary.filter((run) => run.trendClear).length / stationary.length;
console.log("\nThe gate: does the trend find trends in noise?");
console.log(
  `  stationary students reported "clear": ${pct(falseTrend)} ` +
    `(bar: under ${pct(PLAN_GAUNTLET_MAX_FALSE_TREND)})`,
);
console.log(
  `  window: the last ${PLAN_WINDOW_DAYS} days, ${ROUNDS_PER_DAY} rounds a night. ` +
    "A student who runs one round a night gets no benefit from the day sweep in gate 7 " +
    "and sits at a higher rate — that residual is real and is not hidden here.",
);

console.log(
  "\nThis is a simulation against simulated students. The per-install measurement is the " +
    "real claim, and it has no number until it has watched you work.",
);

if (falseTrend < PLAN_GAUNTLET_MAX_FALSE_TREND) {
  console.log(`\nPASS: the trend refused ${pct(1 - falseTrend)} of stationary histories`);
} else {
  console.error(
    `\nFAIL: the trend claimed a direction on ${pct(falseTrend)} of stationary histories`,
  );
  process.exitCode = 1;
}
