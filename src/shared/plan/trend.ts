/**
 * The trend: seven gates, and it names the one that stopped it.
 *
 * `slopeMinPerRound` is STRUCTURALLY null unless every gate passes, so the UI
 * has no code path to a direction it has not earned. `blockedBy` carries the
 * first failing gate to the copy, which then names the missing thing instead
 * of shrugging.
 *
 * Gate 7 — leave-one-out — is the graft that replaces a seeded bootstrap. It
 * is deterministic, needs no seed, costs ten lines, and produces a sentence a
 * student immediately understands: drop any single round and the direction
 * changes, so that is noise, not a trend.
 */

import {
  PLAN_TREND_MAX_CENSORED_FRACTION,
  PLAN_TREND_MIN_DAYS,
  PLAN_TREND_MIN_DELTA_MIN,
  PLAN_TREND_MIN_EVENTS,
  PLAN_TREND_MIN_HALF,
  PLAN_TREND_NOISE_FACTOR,
  PLAN_TREND_ROUND1_MIN_EVENTS,
} from "./constants";
import type { HoldSample, PlanTrend, PlanTrendGate } from "./types";

/* ── small robust statistics, so there is no dependency to add ───────── */

export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo === undefined || hi === undefined ? null : (lo + hi) / 2;
}

/** Nearest-rank quantile — no interpolation, so ties are stable. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0;
}

/** The student's own round-to-round spread. Zero is a legal answer. */
export function iqr(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.75) - quantile(sorted, 0.25);
}

/**
 * Theil-Sen: the median of all pairwise slopes. Robust, deterministic, ten
 * lines, no dependency — and, unlike least squares, one wild night cannot
 * drag the line. `trend.test.ts` asserts both, so the choice is documented by
 * test rather than by comment.
 */
export function theilSen(points: readonly { x: number; y: number }[]): number | null {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      if (a === undefined || b === undefined || a.x === b.x) {
        continue;
      }
      slopes.push((b.y - a.y) / (b.x - a.x));
    }
  }
  return median(slopes);
}

/** Least squares, exported only so the outlier test can assert the contrast. */
export function leastSquaresSlope(points: readonly { x: number; y: number }[]): number | null {
  if (points.length < 2) {
    return null;
  }
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

/* ── the split-half ──────────────────────────────────────────────────── */

interface HalfSplit {
  olderMedian: number | null;
  newerMedian: number | null;
  delta: number | null;
  olderEvents: number;
  newerEvents: number;
  holds: number[];
}

/**
 * Halves are cut over the WINDOW, not over the events, and then the events in
 * each half are counted. That is what makes `lopsided-halves` a real gate: six
 * drifts can still sit 5/1 across a window whose newer half mostly ran clean,
 * and comparing those two halves would be comparing a busy fortnight with a
 * quiet one.
 */
function splitHalves(samples: readonly HoldSample[]): HalfSplit {
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  const half = Math.floor(ordered.length / 2);
  const older = ordered.slice(0, half);
  const newer = ordered.slice(ordered.length - half);

  const olderHolds = older.filter((s) => !s.censored).map((s) => s.minutes);
  const newerHolds = newer.filter((s) => !s.censored).map((s) => s.minutes);
  const olderMedian = median(olderHolds);
  const newerMedian = median(newerHolds);

  return {
    olderMedian,
    newerMedian,
    delta: olderMedian === null || newerMedian === null ? null : newerMedian - olderMedian,
    olderEvents: olderHolds.length,
    newerEvents: newerHolds.length,
    holds: ordered.filter((s) => !s.censored).map((s) => s.minutes),
  };
}

function noiseFloor(holds: readonly number[]): number {
  return Math.max(PLAN_TREND_MIN_DELTA_MIN, PLAN_TREND_NOISE_FACTOR * iqr(holds));
}

function refused(
  blockedBy: PlanTrendGate,
  split: HalfSplit,
  events: number,
  days: number,
  roundOneOnly: boolean,
  method: string,
): PlanTrend {
  const weak: PlanTrendGate[] = ["below-noise", "sign-disagreement", "unstable"];
  return {
    direction: blockedBy === "below-noise" ? "flat" : "unknown",
    confidence: weak.includes(blockedBy) ? "weak" : "none",
    slopeMinPerRound: null,
    olderMedianMin: split.olderMedian,
    newerMedianMin: split.newerMedian,
    spreadMin: split.holds.length >= 2 ? iqr(split.holds) : null,
    events,
    days,
    roundOneOnly,
    blockedBy,
    method,
  };
}

/**
 * Like-for-like. Round 4 of a pomodoro is systematically harder than round 1,
 * so a window mixing them measures window layout as much as attention. Given
 * enough round-1 drifts the comparison uses round-1 rounds only; below that it
 * uses everything and says so out loud in `method`.
 */
export function planTrend(samples: readonly HoldSample[]): PlanTrend {
  const usable = samples.filter((s) => Number.isFinite(s.minutes) && s.minutes >= 0);
  const roundOneEvents = usable.filter((s) => !s.censored && s.round === 1).length;
  const roundOneOnly = roundOneEvents >= PLAN_TREND_ROUND1_MIN_EVENTS;
  const scope = roundOneOnly ? usable.filter((s) => s.round === 1) : usable;

  const events = scope.filter((s) => !s.censored);
  const eventCount = events.length;
  const days = new Set(events.map((s) => s.day)).size;
  const split = splitHalves(scope);
  const likeForLike = roundOneOnly
    ? "Comparing first rounds only — later rounds of a plan are systematically harder."
    : "Mixing first and later rounds, which are not equally hard.";
  const method =
    eventCount === 0
      ? `No drifts in the window yet, so there is no direction to compare. It needs ${PLAN_TREND_MIN_EVENTS} drifts on ${PLAN_TREND_MIN_DAYS} different days.`
      : eventCount < PLAN_TREND_MIN_EVENTS
        ? `Too few drifts to compare halves: ${eventCount} so far, against the ${PLAN_TREND_MIN_EVENTS} needed on ${PLAN_TREND_MIN_DAYS} different days. ${likeForLike}`
        : `Older half of ${eventCount} drifts against the newer half, across ${days} days. ${likeForLike}`;
  const block = (gate: PlanTrendGate): PlanTrend =>
    refused(gate, split, eventCount, days, roundOneOnly, method);

  /* 1 — never fit a line through two points. */
  if (eventCount < PLAN_TREND_MIN_EVENTS) {
    return block("too-few-events");
  }
  /* 2 — three rounds in one evening are one evening's mood. */
  if (days < PLAN_TREND_MIN_DAYS) {
    return block("too-few-days");
  }
  /* 3 — a direction needs two comparable sides. */
  if (split.olderEvents < PLAN_TREND_MIN_HALF || split.newerEvents < PLAN_TREND_MIN_HALF) {
    return block("lopsided-halves");
  }
  /* 4 — if most rounds ran clean, the drifts you DID see are a biased short
   *     subsample, and that bias is exactly the one informative censoring
   *     builds in (§2.5). */
  const censoredFraction = scope.length === 0 ? 0 : (scope.length - eventCount) / scope.length;
  if (censoredFraction > PLAN_TREND_MAX_CENSORED_FRACTION) {
    return block("censoring-limited");
  }

  const delta = split.delta;
  if (delta === null) {
    return block("lopsided-halves");
  }
  /* 5 — the change must beat the student's own spread. */
  if (Math.abs(delta) < noiseFloor(split.holds)) {
    return block("below-noise");
  }

  /* 6 — the half-split must agree in sign with the robust slope. */
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const slope = theilSen(ordered.map((s, index) => ({ x: index, y: s.minutes })));
  if (slope === null || slope === 0 || Math.sign(slope) !== Math.sign(delta)) {
    return block("sign-disagreement");
  }

  /* 7 — one lucky night must not be able to make the claim. */
  if (!survivesLeaveOneOut(scope, delta)) {
    return block("unstable");
  }

  return {
    direction: delta > 0 ? "up" : "down",
    confidence: "clear",
    slopeMinPerRound: slope,
    olderMedianMin: split.olderMedian,
    newerMedianMin: split.newerMedian,
    spreadMin: iqr(split.holds),
    events: eventCount,
    days,
    roundOneOnly,
    blockedBy: null,
    method,
  };
}

/**
 * Gate 7. Drop each observation in turn, recompute, and require the delta to
 * keep its sign and stay over the noise floor. The floor is recomputed from
 * the reduced series too — grading a reduced series against the full series'
 * spread would be marking its own homework.
 *
 * It drops each distinct DAY as well as each observation, because the gate's
 * job is stated as "one lucky night must not be able to make the claim" and a
 * night is usually several rounds. Dropping them one at a time cannot remove a
 * night, so the observation sweep alone does not do what the gate is for.
 *
 * That is not decoration. Measured against a stationary simulated population
 * (no true improvement, σ 4 min, 30% censored, two rounds a night), the
 * observation sweep alone leaves a false-`clear` rate around 11-12%; adding
 * the day sweep takes it to roughly 4.5-5%, which is the bar
 * `PLAN_GAUNTLET_MAX_FALSE_TREND` sets. Power against a real +0.6 min/round
 * rise over twenty rounds goes from about 76% to about 61% — the trade this
 * design makes every time, and in the direction it says it makes it.
 *
 * The honest residual: a student who runs exactly ONE round a night gets no
 * benefit from the day sweep (it is then the observation sweep), and sits at
 * the higher rate. `gauntlet:plan` prints both.
 */
export function survivesLeaveOneOut(samples: readonly HoldSample[], delta: number): boolean {
  const sign = Math.sign(delta);
  const reductions: HoldSample[][] = samples.map((_, index) =>
    samples.filter((__, other) => other !== index),
  );
  for (const day of new Set(samples.map((sample) => sample.day))) {
    reductions.push(samples.filter((sample) => sample.day !== day));
  }

  for (const reduced of reductions) {
    const split = splitHalves(reduced);
    if (split.delta === null) {
      return false;
    }
    if (Math.sign(split.delta) !== sign) {
      return false;
    }
    if (Math.abs(split.delta) < noiseFloor(split.holds)) {
      return false;
    }
  }
  return true;
}
