import { describe, expect, it } from "vitest";
import {
  PLAN_TREND_MAX_CENSORED_FRACTION,
  PLAN_TREND_MIN_DAYS,
  PLAN_TREND_MIN_EVENTS,
  PLAN_TREND_ROUND1_MIN_EVENTS,
} from "./constants";
import { samplesFrom } from "./ledger";
import { improving, stationary20 } from "./fixtures";
import { iqr, leastSquaresSlope, median, planTrend, theilSen } from "./trend";
import type { HoldSample } from "./types";

const DAY = 86_400_000;
const T0 = 1_788_000_000_000;

interface Row {
  minutes: number;
  censored?: boolean;
  /** Day index; distinct values are what the day-spread gate counts. */
  day?: number;
  round?: number;
}

/** Chronological samples, one per slot, with a distinct day unless told. */
function window(rows: readonly Row[]): HoldSample[] {
  return rows.map((row, index) => ({
    minutes: row.minutes,
    censored: row.censored ?? false,
    day: `2026-09-${String((row.day ?? index) + 1).padStart(2, "0")}`,
    round: row.round ?? 1,
    at: T0 + index * DAY,
  }));
}

function events(minutes: readonly number[], over: Partial<Row> = {}): HoldSample[] {
  return window(minutes.map((m) => ({ minutes: m, ...over })));
}

describe("robust statistics", () => {
  it("median handles both parities and refuses an empty list", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("iqr is zero for a constant series and positive for a spread one", () => {
    expect(iqr([20, 20, 20, 20])).toBe(0);
    expect(iqr([10, 20, 30, 40])).toBeGreaterThan(0);
  });

  /*
   * The estimator choice, documented by test rather than by comment: one wild
   * night moves least squares by two orders of magnitude and barely moves
   * Theil-Sen. That is the whole reason the slope on screen is Theil-Sen.
   */
  it("Theil-Sen survives an outlier that destroys least squares", () => {
    const flat = [20, 21, 19, 20, 21, 19, 20].map((y, x) => ({ x, y }));
    const spiked = [...flat, { x: 7, y: 200 }];
    expect(Math.abs(theilSen(flat) ?? 99)).toBeLessThan(0.5);
    expect(Math.abs(theilSen(spiked) ?? 99)).toBeLessThan(0.5);
    expect(Math.abs(leastSquaresSlope(spiked) ?? 0)).toBeGreaterThan(10);
  });
});

describe("the seven gates, each failing in isolation and naming itself", () => {
  it("1 — too-few-events: five drifts is not six", () => {
    const trend = planTrend(events([12, 14, 16, 18, 20]));
    expect(trend.blockedBy).toBe("too-few-events");
    expect(trend.confidence).toBe("none");
    expect(trend.direction).toBe("unknown");
    expect(trend.slopeMinPerRound).toBeNull();
  });

  it("2 — too-few-days: six drifts across one evening are one evening's mood", () => {
    const trend = planTrend(
      window([12, 14, 16, 18, 20, 22].map((minutes, i) => ({ minutes, day: i < 3 ? 0 : 1 }))),
    );
    expect(trend.blockedBy).toBe("too-few-days");
    expect(trend.days).toBeLessThan(PLAN_TREND_MIN_DAYS);
    expect(trend.confidence).toBe("none");
  });

  it("3 — lopsided-halves: a direction needs two comparable sides", () => {
    const trend = planTrend(
      window([
        { minutes: 12 },
        { minutes: 13 },
        { minutes: 14 },
        { minutes: 15 },
        { minutes: 16 },
        { minutes: 17 },
        { minutes: 25, censored: true },
        { minutes: 25, censored: true },
        { minutes: 20 },
        { minutes: 25, censored: true },
        { minutes: 25, censored: true },
        { minutes: 25, censored: true },
      ]),
    );
    expect(trend.blockedBy).toBe("lopsided-halves");
    expect(trend.confidence).toBe("none");
  });

  it("4 — censoring-limited: when most rounds ran clean the drifts are a biased short subsample", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 14; i += 1) {
      const isEvent = i % 7 < 3;
      rows.push({ minutes: isEvent ? 14 + i : 30, censored: !isEvent });
    }
    const samples = window(rows);
    const censoredFraction = samples.filter((s) => s.censored).length / samples.length;
    expect(censoredFraction).toBeGreaterThan(PLAN_TREND_MAX_CENSORED_FRACTION);
    const trend = planTrend(samples);
    expect(trend.blockedBy).toBe("censoring-limited");
    expect(trend.confidence).toBe("none");
  });

  it("5 — below-noise: a one-minute change against an eleven-minute spread is noise", () => {
    const trend = planTrend(events([14, 20, 26, 15, 21, 27]));
    expect(trend.blockedBy).toBe("below-noise");
    expect(trend.confidence).toBe("weak");
    expect(trend.direction).toBe("flat");
    expect(trend.slopeMinPerRound).toBeNull();
  });

  it("6 — sign-disagreement: the halves say up while the robust slope says down", () => {
    const rows: Row[] = [
      ...Array.from({ length: 6 }, () => ({ minutes: 45, censored: true })),
      { minutes: 1 },
      { minutes: 2 },
      { minutes: 3 },
      ...[30, 28, 26, 24, 22, 20, 18, 16, 14].map((minutes) => ({ minutes })),
    ];
    const trend = planTrend(window(rows));
    expect(trend.blockedBy).toBe("sign-disagreement");
    expect(trend.confidence).toBe("weak");
    expect(trend.slopeMinPerRound).toBeNull();
    // The disagreement is real: the halves rise, the pairwise slope falls.
    expect((trend.newerMedianMin ?? 0) - (trend.olderMedianMin ?? 0)).toBeGreaterThan(0);
  });

  it("7 — unstable: drop one round and the direction changes", () => {
    const trend = planTrend(events([20, 22, 21, 19, 18, 30]));
    expect(trend.blockedBy).toBe("unstable");
    expect(trend.confidence).toBe("weak");
    expect(trend.slopeMinPerRound).toBeNull();
  });
});

describe("when every gate passes", () => {
  it("a twenty-round monotone rise is up, clear, and carries a positive slope", () => {
    const trend = planTrend(samplesFrom(improving.rounds));
    expect(trend.blockedBy).toBeNull();
    expect(trend.confidence).toBe("clear");
    expect(trend.direction).toBe("up");
    expect(trend.slopeMinPerRound).not.toBeNull();
    expect(trend.slopeMinPerRound ?? 0).toBeGreaterThan(0);
    expect(trend.events).toBeGreaterThanOrEqual(PLAN_TREND_MIN_EVENTS);
  });

  it("a stationary twenty-round population is refused, not fitted", () => {
    const trend = planTrend(samplesFrom(stationary20.rounds));
    expect(trend.confidence).not.toBe("clear");
    expect(trend.slopeMinPerRound).toBeNull();
    expect(trend.blockedBy).not.toBeNull();
  });

  it("a monotone fall is down, clear, and carries a negative slope", () => {
    const falling = events(Array.from({ length: 12 }, (_, i) => 30 - i * 1.2));
    const trend = planTrend(falling);
    expect(trend.confidence).toBe("clear");
    expect(trend.direction).toBe("down");
    expect(trend.slopeMinPerRound ?? 0).toBeLessThan(0);
  });
});

describe("like-for-like rounds", () => {
  it("restricts to round-1 rounds once there are enough of them, and says so", () => {
    const rows: Row[] = [];
    for (let i = 0; i < PLAN_TREND_ROUND1_MIN_EVENTS; i += 1) {
      rows.push({ minutes: 20 + i, round: 1 });
      rows.push({ minutes: 8, round: 3 });
    }
    const trend = planTrend(window(rows));
    expect(trend.roundOneOnly).toBe(true);
    expect(trend.method).toContain("first rounds only");
    // The round-3 holds are excluded, so the event count is the round-1 count.
    expect(trend.events).toBe(PLAN_TREND_ROUND1_MIN_EVENTS);
  });

  it("below that bar it mixes them and carries the caveat out loud", () => {
    const trend = planTrend(
      window([
        { minutes: 20, round: 1 },
        { minutes: 8, round: 3 },
        { minutes: 21, round: 1 },
        { minutes: 9, round: 3 },
      ]),
    );
    expect(trend.roundOneOnly).toBe(false);
    expect(trend.method).toContain("not equally hard");
  });
});

describe("H5 — the UI has no path to an unearned direction", () => {
  it("slopeMinPerRound is null for every confidence below clear, over 500 random windows", () => {
    let state = 20_260_913;
    const next = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    let clears = 0;
    for (let run = 0; run < 500; run += 1) {
      const size = 1 + Math.floor(next() * 24);
      const rows: Row[] = Array.from({ length: size }, () => ({
        minutes: Math.round(next() * 60 * 10) / 10,
        censored: next() < 0.35,
        day: Math.floor(next() * 10),
        round: 1 + Math.floor(next() * 4),
      }));
      const trend = planTrend(window(rows));
      if (trend.confidence === "clear") {
        clears += 1;
        expect(trend.slopeMinPerRound).not.toBeNull();
        expect(trend.blockedBy).toBeNull();
        expect(["up", "down"]).toContain(trend.direction);
      } else {
        expect(trend.slopeMinPerRound).toBeNull();
        expect(trend.blockedBy).not.toBeNull();
        expect(["flat", "unknown"]).toContain(trend.direction);
      }
      expect(trend.method.length).toBeGreaterThan(0);
    }
    // Uniform noise over a 60-minute range is a harsher spread than any real
    // student's; the gauntlet gates the realistic case. What matters here is
    // that the structural property holds on every single one of these windows.
    expect(clears).toBeLessThan(500);
  });

  it("an empty window is refused with a named gate and a non-empty method", () => {
    const trend = planTrend([]);
    expect(trend.blockedBy).toBe("too-few-events");
    expect(trend.slopeMinPerRound).toBeNull();
    expect(trend.method.length).toBeGreaterThan(0);
    expect(trend.method).not.toMatch(/\b0\b/);
  });
});
