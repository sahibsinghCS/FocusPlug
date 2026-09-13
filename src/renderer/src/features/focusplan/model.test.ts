import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ForecastEvent } from "@shared/ipc";
import {
  PLAN_DEBRIEF_FRESH_MS,
  PLAN_TREND_MIN_DAYS,
  PLAN_TREND_MIN_EVENTS,
  debriefFor,
  holdSparkCaption,
  planTrend,
  recommend,
  samplesFrom,
  selectWindow,
  type PlanRound,
  type PlanTrend,
} from "@shared/plan";
import {
  censorHeavy,
  clean3,
  drift19_22_20,
  fresh,
  improving,
  liveWobble,
  makeRound,
  mixedRounds,
  single,
  stationary20,
  stretchReady,
} from "@shared/plan/fixtures";
import {
  alreadyMatches,
  holdSparkline,
  isFreshDebrief,
  liveRoundFor,
  minSec,
  newestRound,
  planCardView,
  planTone,
  revisionFor,
  sessionRollup,
  signalPhraseFor,
  whenLabel,
  yourPlanLabel,
} from "./model";
import type { PlanSegment } from "../timer/plan";
import type { RunPosition } from "../timer/runtime";

const DIAL = { focusMin: 50, breakMin: 10 };

function view(rounds: readonly PlanRound[], dial = DIAL, stretchEnabled = true) {
  const window = selectWindow(rounds, { includeDiscarded: true });
  return planCardView(
    recommend({ rounds: window, live: null, forecastEnabled: true, stretchEnabled }),
    dial,
  );
}

describe("planCardView — there is no empty state anywhere in this feature", () => {
  const ladders: Array<[string, readonly PlanRound[]]> = [
    ["no-history", fresh.rounds],
    ["single", single.rounds],
    ["censored-only", clean3.rounds],
    ["measured", drift19_22_20.rounds],
    ["stretch", stretchReady.rounds],
    ["censoring-limited", censorHeavy.rounds],
    ["mixed rounds with two ineligible rows", mixedRounds.rounds],
    ["improving", improving.rounds],
  ];

  for (const [name, rounds] of ladders) {
    it(`${name} renders a headline, a reason and a real number`, () => {
      const card = view(rounds);
      expect(card.kicker.length).toBeGreaterThan(0);
      expect(card.headline.length).toBeGreaterThan(0);
      expect(card.reasoning.length).toBeGreaterThan(0);
      expect(card.method.length).toBeGreaterThan(0);
      expect(card.overrideLine.length).toBeGreaterThan(0);
      expect(card.focusMin).toBeGreaterThan(0);
      expect(card.breakMin).toBeGreaterThan(0);
      // The em dash is punctuation the copy is entitled to; a number that
      // failed to render is not. The digit-membership fuzz over the copy
      // itself lives in the shared suite — what matters here is that the view
      // never hands the DOM a hole where a number belongs.
      for (const text of [card.headline, card.reasoning, card.trendLine ?? ""]) {
        expect(text).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b|\bInfinity\b/);
        expect(text).not.toMatch(/(?:at|is|of|then)\s+—/);
      }
      // Every headline states a length, so the card always offers something.
      expect(card.headline).toMatch(/\d/);
    });
  }

  it("the fresh install offers the pomodoro default and says it is not a reading", () => {
    const card = view(fresh.rounds);
    expect(card.focusMin).toBe(25);
    expect(card.breakMin).toBe(5);
    expect(card.reasoning.toLowerCase()).toContain("no history");
  });

  it("the decided beat: 19, 22 and 20 recommends 20", () => {
    const card = view(drift19_22_20.rounds);
    expect(card.focusMin).toBe(20);
    expect(card.reasoning).toContain("19, 22 and 20");
  });
});

describe("planCardView — the offer, and the absence of a nag", () => {
  it("hides the accept button and drops the chip once the Dial agrees", () => {
    const card = view(drift19_22_20.rounds, { focusMin: 20, breakMin: 4 });
    expect(card.matches).toBe(true);
    expect(card.yourPlan).toBeNull();
  });

  it("names the student's own plan, quietly, when it disagrees", () => {
    const card = view(drift19_22_20.rounds, { focusMin: 30, breakMin: 8 });
    expect(card.matches).toBe(false);
    expect(card.yourPlan).toBe("your plan: 30 / 8");
  });

  it("alreadyMatches needs both halves of the plan", () => {
    const rec = recommend({
      rounds: drift19_22_20.rounds,
      live: null,
      forecastEnabled: true,
      stretchEnabled: true,
    });
    expect(alreadyMatches(rec, { focusMin: rec.focusMin, breakMin: rec.breakMin })).toBe(true);
    expect(alreadyMatches(rec, { focusMin: rec.focusMin, breakMin: rec.breakMin + 1 })).toBe(false);
    expect(yourPlanLabel({ focusMin: 15, breakMin: 3 })).toBe("your plan: 15 / 3");
  });

  it("keeps an unmeasured card mute and never dresses it as a verdict", () => {
    const cold = recommend({
      rounds: fresh.rounds,
      live: null,
      forecastEnabled: true,
      stretchEnabled: true,
    });
    expect(planTone(cold)).toBe("mute");
    const stretch = recommend({
      rounds: stretchReady.rounds,
      live: null,
      forecastEnabled: true,
      stretchEnabled: true,
    });
    expect(stretch.step).toBe("stretch");
    expect(planTone(stretch)).toBe("focus");
  });

  it("the forecast-off note reaches the card", () => {
    const window = selectWindow(drift19_22_20.rounds, { includeDiscarded: true });
    const card = planCardView(
      recommend({ rounds: window, live: null, forecastEnabled: false, stretchEnabled: true }),
      DIAL,
    );
    expect(card.forecastNote).not.toBeNull();
    expect(card.forecastNote).toContain("Focus Forecast is off");
  });
});

describe("the evidence disclosure — five rounds and three counted must reconcile", () => {
  it("lists every round, greys the ineligible ones and names why", () => {
    const card = view(mixedRounds.rounds);
    expect(card.evidence).toHaveLength(mixedRounds.rounds.length);
    const excluded = card.evidence.filter((row) => !row.counted);
    expect(excluded.length).toBe(2);
    for (const row of excluded) {
      expect(row.note.length).toBeGreaterThan(0);
      expect(row.note).not.toMatch(/NaN|undefined/);
    }
    expect(card.evidenceSummary).toBe("5 rounds · 3 counted");
  });

  it("says how a round ended without ever printing a dash or a bare zero", () => {
    const rows = view(mixedRounds.rounds).evidence;
    for (const row of rows) {
      expect(row.outcome).not.toBe("—");
      expect(row.outcome).not.toBe("0");
      expect(row.when).not.toContain("NaN");
    }
    const drifted = rows.find((row) => row.outcome.startsWith("drifted at"));
    expect(drifted?.note).toBe("tabbed out");
    const clean = rows.find((row) => row.outcome === "no drift" && row.counted);
    expect(clean?.note).toMatch(/^held \d+ of \d+ min$/);
  });

  it("formats drift offsets to the second, and a wall clock that is real", () => {
    expect(minSec(19 * 60 + 12)).toBe("19:12");
    expect(minSec(65)).toBe("1:05");
    expect(minSec(-4)).toBe("0:00");
    expect(whenLabel(Date.UTC(2026, 8, 14, 12, 4))).toMatch(/^(Sun|Mon) \d{2}:\d{2}$/);
    expect(whenLabel(Number.NaN)).toBe("unknown time");
  });
});

/* ── the live round: what makes the cold-start rung reachable ────────── */

function focusSegment(overrides: Partial<PlanSegment> = {}): PlanSegment {
  return {
    index: 0,
    kind: "focus",
    round: 1,
    seconds: 1500,
    startSec: 0,
    endSec: 1500,
    ...overrides,
  };
}

function positionOf(segment: PlanSegment, remainingSec: number): RunPosition {
  return {
    segment,
    remainingSec,
    segmentProgress: 1 - remainingSec / segment.seconds,
    planProgress: 0.5,
    round: segment.round,
    roundsTotal: 1,
  };
}

describe("liveRoundFor", () => {
  const startedAtMs = 1_800_000_000_000;

  it("is null before the switch, and on a break", () => {
    expect(
      liveRoundFor({
        startedAtMs: null,
        position: positionOf(focusSegment(), 600),
        forecastOn: true,
        forecastEvents: [],
        history: [],
      }),
    ).toBeNull();
    expect(
      liveRoundFor({
        startedAtMs,
        position: positionOf(focusSegment({ kind: "break", index: 1 }), 60),
        forecastOn: true,
        forecastEvents: [],
        history: [],
      }),
    ).toBeNull();
  });

  it("reads the first wobble and the peak off the live curve", () => {
    const segment = focusSegment();
    const events: ForecastEvent[] = [
      { type: "forecast_nudge", ts: startedAtMs + 660_000, risk: 0.55, topFeatures: ["fracOther60"] },
      { type: "forecast_prearm", ts: startedAtMs + 900_000, risk: 0.7, fuseSec: 5 },
    ];
    const live = liveRoundFor({
      startedAtMs,
      position: positionOf(segment, 780),
      forecastOn: true,
      forecastEvents: events,
      history: [
        { ts: startedAtMs + 120_000, risk: 0.2 },
        { ts: startedAtMs + 660_000, risk: 0.62 },
        { ts: startedAtMs + 700_000, risk: 0.41 },
      ],
    });
    expect(live?.firstWobbleSec).toBe(660);
    expect(live?.servedSec).toBe(720);
    expect(live?.peakRisk).toBeCloseTo(0.62, 5);
    expect(live?.peakRiskSec).toBe(660);
    expect(live?.roundKey).toBe(`${startedAtMs}-0`);
  });

  it("fabricates no risk curve with the forecast off", () => {
    const live = liveRoundFor({
      startedAtMs,
      position: positionOf(focusSegment(), 780),
      forecastOn: false,
      forecastEvents: [
        { type: "forecast_nudge", ts: startedAtMs + 660_000, risk: 0.55, topFeatures: [] },
      ],
      history: [{ ts: startedAtMs + 120_000, risk: 0.9 }],
    });
    expect(live?.firstWobbleSec).toBeNull();
    expect(live?.peakRisk).toBeNull();
  });

  it("carries a fresh install's first round into the wobble rung", () => {
    const rec = recommend({
      rounds: [],
      live: liveWobble,
      forecastEnabled: true,
      stretchEnabled: true,
    });
    expect(rec.estimate.rung).toBe("wobble-only");
    expect(planCardView(rec, DIAL).provisional).toBe(true);
  });
});

/* ── the mid-session revision ────────────────────────────────────────── */

describe("revisionFor", () => {
  const startedAtMs = 1_800_000_000_000;
  const segment = focusSegment({ seconds: 3000, endSec: 3000 });
  const live = {
    roundKey: `${startedAtMs}-0`,
    startedAt: startedAtMs,
    plannedFocusSec: 3000,
    servedSec: 1000,
    firstDriftSec: null,
    firstWobbleSec: 900,
    peakRisk: 0.6,
    peakRiskSec: 900,
    forecastOn: true,
  };

  it("says nothing while a fuse is burning — the guard, first", () => {
    expect(
      revisionFor({
        live,
        position: positionOf(segment, 2000),
        estimateMin: 15,
        risk: 0.7,
        nudgeRisk: 0.5,
        countdownActive: true,
      }),
    ).toBeNull();
  });

  it("offers an earlier break once a real wobble lands past 60% of the estimate", () => {
    const revision = revisionFor({
      live,
      position: positionOf(segment, 2000),
      estimateMin: 15,
      risk: 0.7,
      nudgeRisk: 0.5,
      countdownActive: false,
    });
    expect(revision?.kind).toBe("earlier");
    expect(revision?.suggestedBreakInSec).toBe(180);
    expect(revision?.copy.line).toContain("nothing moves unless you move it");
  });

  it("never invents a comparison, and never speaks on a break", () => {
    expect(
      revisionFor({
        live,
        position: positionOf(segment, 2000),
        estimateMin: null,
        risk: 0.7,
        nudgeRisk: 0.5,
        countdownActive: false,
      }),
    ).toBeNull();
    expect(
      revisionFor({
        live,
        position: positionOf(focusSegment({ kind: "break", index: 1 }), 200),
        estimateMin: 15,
        risk: 0.7,
        nudgeRisk: 0.5,
        countdownActive: false,
      }),
    ).toBeNull();
  });
});

/* ── the sparkline ───────────────────────────────────────────────────── */

function trendOf(rounds: readonly PlanRound[]): PlanTrend {
  return planTrend(samplesFrom(rounds));
}

describe("holdSparkline", () => {
  it("draws three marks, one of them open, and NO line below six drifts", () => {
    const series = [
      { at: 1, minutes: 19, censored: false },
      { at: 2, minutes: 25, censored: true },
      { at: 3, minutes: 20, censored: false },
    ];
    const spark = holdSparkline(series, { medianMin: 20, trend: trendOf(drift19_22_20.rounds) });
    expect(spark.marks).toHaveLength(3);
    expect(spark.marks.filter((mark) => mark.censored)).toHaveLength(1);
    expect(spark.line).toBeNull();
    expect(spark.medianY).not.toBeNull();
    // Three drifts really is `too-few-events`, so the caption may say so — and
    // it quotes this window's own count, not a constant.
    expect(trendOf(drift19_22_20.rounds).blockedBy).toBe("too-few-events");
    expect(spark.caption).toBe(
      `dots only — 3 drifts so far — a line needs ${PLAN_TREND_MIN_EVENTS}, on ${PLAN_TREND_MIN_DAYS} different days.`,
    );
  });

  it("draws exactly one line once the trend has cleared all seven gates", () => {
    const trend = trendOf(improving.rounds);
    expect(trend.confidence).toBe("clear");
    const series = samplesFrom(improving.rounds).map((sample) => ({
      at: sample.at,
      minutes: sample.minutes,
      censored: sample.censored,
    }));
    const spark = holdSparkline(series, { medianMin: 18, trend });
    expect(spark.line).not.toBeNull();
    expect(spark.marks).toHaveLength(series.length);
    for (const mark of spark.marks) {
      expect(mark.x).toBeGreaterThanOrEqual(0);
      expect(mark.x).toBeLessThanOrEqual(spark.width);
      expect(mark.y).toBeGreaterThanOrEqual(0);
      expect(mark.y).toBeLessThanOrEqual(spark.height);
    }
  });

  it("cannot draw a direction a weak trend refused to claim", () => {
    const weak: PlanTrend = { ...trendOf(improving.rounds), confidence: "weak" };
    const series = samplesFrom(improving.rounds).map((sample) => ({
      at: sample.at,
      minutes: sample.minutes,
      censored: sample.censored,
    }));
    expect(holdSparkline(series, { medianMin: 18, trend: weak }).line).toBeNull();
  });

  it("REGRESSION — the caption names the gate that refused THIS trend", () => {
    // Eight drifts on eight different evenings. Every volume gate passes; the
    // trend is refused because the change is inside the student's own spread.
    // The caption used to be hard-coded to one gate's reason and told them
    // they did not have enough history, which was false about their own data
    // and false about the count it quoted.
    const rounds = [20, 18, 22, 19, 21, 20, 18, 22].map((driftMin, index) =>
      makeRound({ day: index, atMin: 60, plannedFocusMin: 30, servedMin: 30, driftMin }),
    );
    const trend = trendOf(rounds);
    expect(trend.blockedBy).toBe("below-noise");
    expect(trend.events).toBe(8);
    expect(trend.days).toBe(8);

    const series = samplesFrom(rounds).map((sample) => ({
      at: sample.at,
      minutes: sample.minutes,
      censored: sample.censored,
    }));
    const spark = holdSparkline(series, { medianMin: 20, trend });
    expect(spark.line).toBeNull();
    expect(spark.caption).toBe("dots only — the change is smaller than your round-to-round spread.");
    expect(spark.caption).not.toContain("not enough history");
    expect(spark.caption).not.toContain(`${PLAN_TREND_MIN_EVENTS} drifts`);
  });

  it("every caption it can render comes from the copy layer, never from here", () => {
    // The geometry may choose WHETHER a line is drawn; it may not choose what
    // that means. Anything else re-opens the hole this file used to have.
    for (const ledger of [fresh, drift19_22_20, stationary20, improving, censorHeavy, clean3]) {
      const trend = trendOf(ledger.rounds);
      const series = samplesFrom(ledger.rounds).map((sample) => ({
        at: sample.at,
        minutes: sample.minutes,
        censored: sample.censored,
      }));
      const spark = holdSparkline(series, { medianMin: 20, trend });
      expect(spark.caption).toBe(holdSparkCaption(trend, spark.line !== null));
    }
  });

  it("model.ts states no trend claim of its own — the fence that used to leak", () => {
    // The caption was the one sentence this file composed, and being here is
    // exactly why the copy fuzz in `shared/plan/copy.test.ts` could not see it
    // and it went wrong for six of the seven gates. Comments may discuss the
    // line; code may not word it.
    const source = readFileSync(new URL("./model.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const claim of ["dots only", "Theil", "not enough history", "it needs"]) {
      expect({ claim, composedHere: code.includes(claim) }).toEqual({
        claim,
        composedHere: false,
      });
    }
    // Positive control: the checker still reads the file it thinks it reads.
    expect(code).toContain("holdSparkCaption(options.trend");
  });

  it("survives an empty series and a single point", () => {
    const trend = trendOf(fresh.rounds);
    expect(holdSparkline([], { medianMin: null, trend }).empty).toBe(true);
    const one = holdSparkline([{ at: 1, minutes: 19, censored: false }], {
      medianMin: 19,
      trend,
    });
    expect(one.marks).toHaveLength(1);
    expect(one.line).toBeNull();
    expect(Number.isFinite(one.marks[0]?.y ?? Number.NaN)).toBe(true);
  });
});

/* ── the debrief's plumbing ──────────────────────────────────────────── */

describe("debrief plumbing", () => {
  it("finds the newest closed round by end time, not by array order", () => {
    const [first, second, third] = drift19_22_20.rounds;
    expect(newestRound([second!, third!, first!])?.roundKey).toBe(third!.roundKey);
    expect(newestRound([])).toBeNull();
  });

  it("shows a round on the setup page only while it is still what just happened", () => {
    const round = drift19_22_20.rounds[2]!;
    expect(isFreshDebrief(round, round.endedAt + 60_000)).toBe(true);
    expect(isFreshDebrief(round, round.endedAt + PLAN_DEBRIEF_FRESH_MS + 1)).toBe(false);
  });

  it("rolls up only the rounds of the run that just finished", () => {
    const startedAtMs = 1_800_000_000_000;
    const mine = drift19_22_20.rounds.map((round, index) => ({
      ...round,
      roundKey: `${startedAtMs}-${index}`,
    }));
    const theirs = clean3.rounds.map((round, index) => ({
      ...round,
      roundKey: `${startedAtMs + 1}-${index}`,
    }));
    const rollup = sessionRollup([...theirs, ...mine], startedAtMs);
    expect(rollup?.rounds).toBe(3);
    expect(rollup?.firstDriftsMin).toEqual([19, 22, 20]);
    expect(rollup?.medianMin).toBe(20);
    expect(rollup?.kills).toBe(1);
    expect(sessionRollup(mine, null)).toBeNull();
    expect(sessionRollup(mine, 42)).toBeNull();
  });

  it("borrows the forecast's own feature words and never invents a second table", () => {
    const round = drift19_22_20.rounds[0]!;
    const events: ForecastEvent[] = [
      {
        type: "forecast_nudge",
        ts: round.startedAt + 600_000,
        risk: 0.6,
        topFeatures: ["fracOther60"],
      },
    ];
    expect(signalPhraseFor(round, events)).toBe("grey share 60s");
    expect(signalPhraseFor(round, [])).toBeNull();
    expect(signalPhraseFor({ ...round, forecastOn: false }, events)).toBeNull();
    expect(
      signalPhraseFor(round, [{ ...events[0]!, ts: round.endedAt + 60_000 } as ForecastEvent]),
    ).toBeNull();
  });

  it("always states the number, even for the rounds that do not count", () => {
    for (const rounds of [mixedRounds.rounds, clean3.rounds, single.rounds]) {
      const round = newestRound(rounds)!;
      const debrief = debriefFor({
        round,
        rounds,
        forecastEnabled: true,
        stretchEnabled: true,
        lifetimeRounds: rounds.length,
      });
      expect(debrief.copy.theNumber.length).toBeGreaterThan(0);
      expect(debrief.copy.headline.length).toBeGreaterThan(0);
      expect(debrief.copy.nextRound).not.toMatch(/NaN|undefined/);
    }
  });
});
