/**
 * Does a fuse that learns you beat the best fuse that does not?
 *
 *   npm run gauntlet:adapt
 *
 * This is a SIMULATION, not a user study. It invents a population of students
 * with different self-correction habits, replays drifts against them, and
 * compares three policies. Quote it as a simulation or not at all.
 *
 * The baseline is deliberately strong: not the shipped 10 seconds, but the
 * single best constant fuse found by sweeping every value against the whole
 * population — the fairest possible one-size-fits-all. If personalisation only
 * beat a badly chosen constant it would prove nothing.
 *
 * Each student's first `TRAIN_DRIFTS` drifts train their model; the numbers
 * below are from the drifts after that, which the model never learned on.
 */

import { type DriftMoment } from "./features";
import { chooseFuse, FUSE_CANDIDATES, MAX_FUSE_SEC } from "./fuse";
import { createModel, type AdaptiveModel } from "./model";
import { observeDrift } from "./train";

const STUDENTS = 120;
const DRIFTS_EACH = 40;
const TRAIN_DRIFTS = 12;
const SHIPPED_FUSE = 10;
/** Past this, nobody was coming back on their own anyway. */
const PATIENCE_SEC = MAX_FUSE_SEC;

/** Deterministic so the printed numbers are reproducible. */
function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };
}

interface Habit {
  name: string;
  /** Chance they come back at all, rather than sinking into it. */
  returns: number;
  /** Typical seconds to notice and come back. */
  medianSec: number;
  spread: number;
}

const HABITS: readonly Habit[] = [
  { name: "snaps back", returns: 0.92, medianSec: 4, spread: 1.8 },
  { name: "drifts, then returns", returns: 0.78, medianSec: 13, spread: 5 },
  { name: "slow to notice", returns: 0.6, medianSec: 22, spread: 7 },
  { name: "gone once gone", returns: 0.08, medianSec: 26, spread: 8 },
];

/** How long this drift would have taken to fix, or null if never. */
function drawRecovery(habit: Habit, random: () => number): number | null {
  if (random() > habit.returns) {
    return null;
  }
  // Two uniforms make a rough bell without pulling in a normal sampler.
  const noise = (random() + random() - 1) * habit.spread;
  return Math.max(1, habit.medianSec + noise);
}

interface Cost {
  /** Decisions that matched what the student would actually have done. */
  right: number;
  /** Seconds spent waiting, whatever the outcome. Dead session time. */
  waitedSec: number;
  fuseSum: number;
  drifts: number;
}

function emptyCost(): Cost {
  return { right: 0, waitedSec: 0, fuseSum: 0, drifts: 0 };
}

/**
 * The fuse makes one call: spare them, or kill them. It is right when it
 * spares someone who was coming back and kills someone who was not.
 * `PATIENCE_SEC` is where we stop calling it "coming back on their own".
 */
function score(cost: Cost, fuseSec: number, recoverySec: number | null): void {
  cost.drifts += 1;
  cost.fuseSum += fuseSec;
  const wouldReturn = recoverySec !== null && recoverySec <= PATIENCE_SEC;
  const spared = recoverySec !== null && recoverySec <= fuseSec;
  if (wouldReturn === spared) {
    cost.right += 1;
  }
  // Waiting costs the session whether or not they came back.
  cost.waitedSec += spared ? recoverySec! : fuseSec;
}

function per100(cost: Cost): { accuracy: number; waitedSec: number; meanFuse: number } {
  const drifts = Math.max(1, cost.drifts);
  return {
    accuracy: (cost.right / drifts) * 100,
    waitedSec: cost.waitedSec / drifts,
    meanFuse: cost.fuseSum / drifts,
  };
}

function moment(ts: number): DriftMoment {
  return {
    ts,
    sessionStartedAt: ts - 10 * 60_000,
    sessionEndsAt: ts + 40 * 60_000,
    focus: {
      ts,
      processName: "discord",
      windowTitle: "Discord",
      matchedAllow: false,
      matchedBlock: true,
    },
    desk: { ts, label: "at_desk", confidence: 0.93, webcamEnabled: true },
    violation: "blocked",
    dwellMs: 5_000,
    switchesLastTwoMin: 3,
    priorDrifts: 0,
    priorKills: 0,
    fuseSec: SHIPPED_FUSE,
    hour: 21,
  };
}

interface Student {
  habit: Habit;
  /** Recovery times drawn up front so every policy faces the same person. */
  drifts: Array<number | null>;
}

function population(): Student[] {
  const random = rng(20260911);
  const students: Student[] = [];
  for (let i = 0; i < STUDENTS; i += 1) {
    const habit = HABITS[i % HABITS.length]!;
    const drifts: Array<number | null> = [];
    for (let d = 0; d < DRIFTS_EACH; d += 1) {
      drifts.push(drawRecovery(habit, random));
    }
    students.push({ habit, drifts });
  }
  return students;
}

/**
 * Every constant fuse, scored. There is no single "best" without an exchange
 * rate between a wrong call and a wasted second, and inventing one is how you
 * rig a benchmark — so the whole curve is printed and the comparison below is
 * made at a matched budget instead.
 */
function constantSweep(students: readonly Student[]): Array<{ fuseSec: number; cost: Cost }> {
  return FUSE_CANDIDATES.map((fuseSec) => ({ fuseSec, cost: runFixed(students, fuseSec) }));
}

function runFixed(students: readonly Student[], fuseSec: number): Cost {
  const cost = emptyCost();
  for (const student of students) {
    for (const recovery of student.drifts.slice(TRAIN_DRIFTS)) {
      score(cost, fuseSec, recovery);
    }
  }
  return cost;
}

function runAdaptive(students: readonly Student[]): { cost: Cost; byHabit: Map<string, Cost> } {
  const cost = emptyCost();
  const byHabit = new Map<string, Cost>();
  const base = Date.now();

  for (const student of students) {
    let model: AdaptiveModel = createModel();
    student.drifts.forEach((recovery, index) => {
      const at = moment(base + index * 60_000);
      const choice = chooseFuse(model, at, SHIPPED_FUSE);
      const observed = recovery !== null && recovery <= choice.seconds ? recovery : null;

      if (index < TRAIN_DRIFTS) {
        model = observeDrift(model, { ...at, fuseSec: choice.seconds }, {
          recoveredAfterSec: observed,
          fuseSec: choice.seconds,
          probed: choice.exploring,
        });
        return;
      }

      score(cost, choice.seconds, recovery);
      const habitCost = byHabit.get(student.habit.name) ?? emptyCost();
      score(habitCost, choice.seconds, recovery);
      byHabit.set(student.habit.name, habitCost);
      // Keep learning after the split; the score above was recorded first, so
      // the model never sees a drift before it is graded on it.
      model = observeDrift(model, { ...at, fuseSec: choice.seconds }, {
        recoveredAfterSec: observed,
        fuseSec: choice.seconds,
        probed: choice.exploring,
      });
    });
  }

  return { cost, byHabit };
}

function line(label: string, cost: Cost): string {
  const { accuracy, waitedSec, meanFuse } = per100(cost);
  return `  ${label.padEnd(28)} ${accuracy.toFixed(1).padStart(5)}% right   ${waitedSec
    .toFixed(1)
    .padStart(5)}s waited/drift   fuse ${meanFuse.toFixed(1).padStart(4)}s`;
}

const students = population();
const shipped = runFixed(students, SHIPPED_FUSE);
const sweep = constantSweep(students);
const adaptive = runAdaptive(students);

const shippedScore = per100(shipped);
const adaptiveScore = per100(adaptive.cost);

/** The best constant that spends no more session time than adaptive did. */
const timeMatched = sweep
  .filter((entry) => per100(entry.cost).waitedSec <= adaptiveScore.waitedSec)
  .sort((a, b) => per100(b.cost).accuracy - per100(a.cost).accuracy)[0];
/** The cheapest constant that is at least as accurate. */
const accuracyMatched = sweep
  .filter((entry) => per100(entry.cost).accuracy >= adaptiveScore.accuracy)
  .sort((a, b) => per100(a.cost).waitedSec - per100(b.cost).waitedSec)[0];

console.log("ADAPTIVE FUSE GAUNTLET — simulation, not a user study");
console.log(
  `  ${STUDENTS} simulated students x ${DRIFTS_EACH} drifts · first ${TRAIN_DRIFTS} train, rest scored
`,
);
console.log(line(`shipped constant (${SHIPPED_FUSE}s)`, shipped));
if (timeMatched) {
  console.log(line(`best constant at that cost (${timeMatched.fuseSec}s)`, timeMatched.cost));
}
console.log(line("adaptive, per student", adaptive.cost));
console.log("");
for (const habit of HABITS) {
  const cost = adaptive.byHabit.get(habit.name);
  if (cost) {
    console.log(line(`  └ ${habit.name}`, cost));
  }
}

console.log("\n  the whole constant-fuse curve, so nothing is hidden:");
for (const entry of sweep.filter((item) => item.fuseSec % 4 === 0 || item.fuseSec === MAX_FUSE_SEC)) {
  console.log(line(`    ${entry.fuseSec}s`, entry.cost));
}

console.log("");
if (accuracyMatched) {
  const matched = per100(accuracyMatched.cost);
  console.log(
    `  no constant matches ${adaptiveScore.accuracy.toFixed(1)}% until ${accuracyMatched.fuseSec}s, which burns ` +
      `${matched.waitedSec.toFixed(1)}s a drift — ${(matched.waitedSec / adaptiveScore.waitedSec).toFixed(1)}x the waiting, ` +
      `and a fuse that waits that long is not enforcement.`,
  );
}

/*
 * The bar: beat the fuse that actually ships on both axes at once, and beat
 * the best constant that spends the same session time. Accuracy alone is not
 * the objective — a 28-second fuse scores beautifully on it and would make the
 * product toothless.
 */
const dominatesShipped =
  adaptiveScore.accuracy > shippedScore.accuracy && adaptiveScore.waitedSec < shippedScore.waitedSec;
const beatsMatched =
  timeMatched === undefined || adaptiveScore.accuracy > per100(timeMatched.cost).accuracy;

if (dominatesShipped && beatsMatched) {
  console.log(
    `
PASS: ${adaptiveScore.accuracy.toFixed(1)}% right vs the shipped fuse's ${shippedScore.accuracy.toFixed(1)}%, ` +
      `while waiting ${adaptiveScore.waitedSec.toFixed(1)}s a drift instead of ${shippedScore.waitedSec.toFixed(1)}s — ` +
      `better on both axes, and ahead of any constant at that cost`,
  );
} else {
  console.error("\nFAIL: personalisation did not beat a constant fuse at matched cost");
  process.exitCode = 1;
}
