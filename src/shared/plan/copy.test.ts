import { describe, expect, it } from "vitest";
import {
  PLAN_BACKOFF_MIN,
  PLAN_DEFAULT_FOCUS_MIN,
  PLAN_MAX_REACH_MIN,
  PLAN_MIN_FOCUS_MIN,
  PLAN_MIN_ROUND_SEC,
  PLAN_STRETCH_MIN,
  PLAN_TREND_MIN_DAYS,
  PLAN_TREND_MIN_EVENTS,
  PLAN_TREND_MIN_HALF,
  PLAN_WINDOW_DAYS,
} from "./constants";
import { FORECAST_OFF_NOTE, holdSparkCaption, minutesList, minutesText, trendLine } from "./copy";
import { debriefFor } from "./debrief";
import {
  DAY,
  MINUTE,
  T0,
  censorHeavy,
  clean3,
  cleanOnly,
  drift19_22_20,
  easeReady,
  fresh,
  improving,
  liveWobble,
  makeRound,
  mixedRounds,
  pair,
  single,
  stationary20,
  stretchReady,
} from "./fixtures";
import { selectWindow } from "./ledger";
import { recommend } from "./progression";
import type { PlanDebrief, PlanRecommendation, PlanRound, PlanTrend, PlanTrendGate } from "./types";

const LEDGERS = {
  fresh,
  single,
  pair,
  clean3,
  cleanOnly,
  drift19_22_20,
  stretchReady,
  easeReady,
  improving,
  stationary20,
  censorHeavy,
  mixedRounds,
} as const;

function planFor(
  rounds: readonly PlanRound[],
  over: { forecastEnabled?: boolean; stretchEnabled?: boolean; live?: Parameters<typeof recommend>[0]["live"] } = {},
): PlanRecommendation {
  return recommend({
    rounds: selectWindow(rounds, { includeDiscarded: true }),
    live: over.live ?? null,
    forecastEnabled: over.forecastEnabled ?? true,
    stretchEnabled: over.stretchEnabled ?? true,
  });
}

/** Every variant of the card the app can render. */
function everyCard(): PlanRecommendation[] {
  const cards: PlanRecommendation[] = [];
  for (const ledger of Object.values(LEDGERS)) {
    for (const forecastEnabled of [true, false]) {
      for (const stretchEnabled of [true, false]) {
        cards.push(planFor(ledger.rounds, { forecastEnabled, stretchEnabled }));
      }
    }
  }
  cards.push(planFor(fresh.rounds, { live: liveWobble }));
  cards.push(planFor(clean3.rounds, { live: liveWobble }));
  return cards;
}

/** Every branch of the debrief. */
function everyDebrief(): PlanDebrief[] {
  const specs: Array<{ round: PlanRound; rounds: readonly PlanRound[]; forecastEnabled?: boolean }> = [
    { round: single.rounds[0]!, rounds: single.rounds },
    { round: cleanOnly.rounds[0]!, rounds: cleanOnly.rounds },
    { round: drift19_22_20.rounds[2]!, rounds: drift19_22_20.rounds },
    { round: easeReady.rounds[4]!, rounds: easeReady.rounds },
    { round: stretchReady.rounds[5]!, rounds: stretchReady.rounds },
    { round: improving.rounds[19]!, rounds: improving.rounds },
    {
      round: makeRound({ servedMin: 3, driftMin: null, status: "discarded" }),
      rounds: [makeRound({ servedMin: 3, driftMin: null, status: "discarded" })],
    },
    {
      round: makeRound({ driftMin: 0.2, startedDrifted: true }),
      rounds: [makeRound({ driftMin: 0.2, startedDrifted: true })],
    },
    {
      round: makeRound({ driftMin: null, wobbleMin: 11, standDowns: 1, peakRisk: 0.55, peakRiskMin: 11 }),
      rounds: [makeRound({ driftMin: null, wobbleMin: 11, standDowns: 1, peakRisk: 0.55, peakRiskMin: 11 })],
    },
    {
      round: makeRound({ driftMin: 19, forecastOn: false }),
      rounds: [makeRound({ driftMin: 19, forecastOn: false })],
      forecastEnabled: false,
    },
    {
      round: makeRound({ driftMin: 19, driftsMin: [19, 26, 31], countdowns: 2, kills: 1 }),
      rounds: [makeRound({ driftMin: 19, driftsMin: [19, 26, 31], countdowns: 2, kills: 1 })],
    },
  ];
  return specs.map((spec) =>
    debriefFor({
      round: spec.round,
      rounds: selectWindow(spec.rounds, { includeDiscarded: true }),
      forecastEnabled: spec.forecastEnabled ?? true,
      stretchEnabled: true,
    }),
  );
}

function cardStrings(card: PlanRecommendation): string[] {
  const c = card.copy;
  return [c.kicker, c.headline, c.reasoning, c.method, c.acceptLabel, c.overrideLine]
    .concat(c.trendLine === null ? [] : [c.trendLine])
    .concat(c.forecastNote === null ? [] : [c.forecastNote]);
}

function debriefStrings(debrief: PlanDebrief): string[] {
  const c = debrief.copy;
  return [c.kicker, c.headline, c.theNumber, c.nextRound]
    .concat([c.whereItWent, c.rhythm, c.cost, c.notCountedLine].filter((s): s is string => s !== null))
    // The sparkline caption is the debrief's ONLY statement about direction,
    // and it renders under "The number" on the same card. It is held to every
    // rule below, including the digit-membership fuzz, exactly because it used
    // to be composed in the renderer where none of this could see it.
    .concat([sparkCaptionOf(debrief)]);
}

/** The caption the DebriefCard actually renders for this debrief. */
function sparkCaptionOf(debrief: PlanDebrief): string {
  const { trend } = debrief.next;
  const drawn = trend.confidence === "clear" && debrief.series.length >= 2;
  return holdSparkCaption(trend, drawn);
}

describe("copy rule 7 — nothing renders as 0, NaN, undefined or a dash", () => {
  const BANNED = /\bNaN\b|\bundefined\b|\bnull\b|\bInfinity\b|—\s*minutes|\b0 minutes\b|\b0 rounds\b|\b0 drifts\b|\b0 days\b/;

  it("no card string in any variant", () => {
    for (const card of everyCard()) {
      for (const line of cardStrings(card)) {
        expect({ line, banned: BANNED.test(line) }).toEqual({ line, banned: false });
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("no debrief string in any branch", () => {
    for (const debrief of everyDebrief()) {
      for (const line of debriefStrings(debrief)) {
        expect({ line, banned: BANNED.test(line) }).toEqual({ line, banned: false });
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("no exclamation marks and no emoji — a number that went up is the celebration", () => {
    const lines = [...everyCard().flatMap(cardStrings), ...everyDebrief().flatMap(debriefStrings)];
    for (const line of lines) {
      expect(line).not.toContain("!");
      // eslint-disable-next-line no-control-regex
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(line)).toBe(false);
    }
  });

  it("never says the student failed — the verb is always 'drifted'", () => {
    const lines = [...everyCard().flatMap(cardStrings), ...everyDebrief().flatMap(debriefStrings)];
    for (const line of lines) {
      expect(line.toLowerCase()).not.toContain("you failed");
      expect(line.toLowerCase()).not.toContain("lost focus");
      expect(line.toLowerCase()).not.toContain("you must");
    }
  });
});

describe("the never-enforced line, in every variant", () => {
  it("every card carries it, and it offers the student's own number as an equal choice", () => {
    for (const card of everyCard()) {
      expect(card.copy.overrideLine).toContain("Nothing here is enforced");
      expect(card.copy.overrideLine).toContain("set your own");
      expect(card.copy.acceptLabel.length).toBeGreaterThan(0);
    }
  });

  it("no card copy anywhere threatens a consequence", () => {
    for (const card of everyCard()) {
      for (const line of cardStrings(card)) {
        expect(line.toLowerCase()).not.toContain("will be closed");
        expect(line.toLowerCase()).not.toContain("force-quit");
      }
    }
  });
});

describe("the rungs say what they are", () => {
  it("no-history contains the words 'no history' and owns the default", () => {
    const card = planFor(fresh.rounds);
    expect(card.copy.reasoning.toLowerCase()).toContain("no history");
    expect(card.copy.reasoning).toContain("not a reading of you");
    expect(card.copy.kicker.toLowerCase()).toContain("no history");
  });

  it("wobble-only contains 'provisional' and explains what a wobble is", () => {
    const card = planFor(fresh.rounds, { live: liveWobble });
    expect(card.copy.reasoning.toLowerCase()).toContain("provisional");
    expect(card.copy.reasoning).toContain("warning that a drift was coming");
    expect(card.copy.reasoning).toContain("warning, not a drift");
  });

  it("an unreached median says 'at least' and never a point estimate (H2)", () => {
    for (const ledger of [cleanOnly, clean3, censorHeavy]) {
      const card = planFor(ledger.rounds);
      expect(card.estimate.medianMin).toBeNull();
      expect(card.copy.reasoning).toContain("at least");
      expect(card.copy.reasoning).toContain("do not know where");
    }
  });

  it("the forecast-off note appears exactly when the forecast is off", () => {
    expect(planFor(single.rounds, { forecastEnabled: false }).copy.forecastNote).toBe(
      FORECAST_OFF_NOTE,
    );
    expect(planFor(single.rounds, { forecastEnabled: true }).copy.forecastNote).toBeNull();
  });

  it("the method is named on screen, verbatim, and never empty (H6)", () => {
    for (const card of everyCard()) {
      expect(card.copy.method).toContain(card.estimate.method);
      expect(card.copy.method).toContain(card.trend.method);
      expect(card.copy.method.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("the trend sentence refuses out loud (H3, H4, H5)", () => {
  const CLAIMS = /\b(improving|improved|getting better|getting worse|worse than|on track)\b/i;

  it("every confidence below clear carries a refusal clause and claims no direction", () => {
    for (const card of everyCard()) {
      if (card.trend.confidence === "clear") {
        continue;
      }
      const line = card.copy.trendLine;
      expect(line).not.toBeNull();
      expect(line ?? "").toMatch(
        /not enough|no drifts|not a trend|biased sample|noise|nothing is being claimed|too few|it needs/i,
      );
      expect(CLAIMS.test(line ?? "")).toBe(false);
      expect(card.trend.slopeMinPerRound).toBeNull();
    }
  });

  it("a clear trend names its size, its two ends and its evidence", () => {
    const card = planFor(improving.rounds);
    expect(card.trend.confidence).toBe("clear");
    expect(card.copy.trendLine).toMatch(/^(Up|Down) /);
    expect(card.copy.trendLine).toContain("now against");
    expect(card.copy.trendLine).toContain("drifts on");
  });

  it("each gate produces its own sentence, so the copy names the missing thing", () => {
    const seen = new Set<string>();
    for (const card of everyCard()) {
      if (card.trend.blockedBy !== null) {
        seen.add(card.trend.blockedBy);
      }
      expect(trendLine(card.trend)).not.toBeNull();
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("the like-for-like caveat rides the clear line (H8)", () => {
    const card = planFor(improving.rounds);
    expect(card.copy.trendLine).toMatch(/first rounds only|not equally hard/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * The sparkline caption.
 *
 * It is the only sentence the debrief prints about direction, and it used to
 * be composed in `features/focusplan/model.ts` — outside this file, outside
 * every test here — where it hard-coded ONE gate's reason for all seven. A
 * student with 8 drifts on 8 different evenings, refused by `below-noise`,
 * was told on the debrief card that they did not have enough history and that
 * it needed 6 drifts. Both halves of that were false about their own data.
 * ──────────────────────────────────────────────────────────────────────── */

/** A `PlanTrend` carrying just enough to reach one gate's caption. */
function trendAt(gate: PlanTrendGate | null, over: Partial<PlanTrend> = {}): PlanTrend {
  return {
    direction: gate === null ? "up" : "flat",
    confidence: gate === null ? "clear" : "none",
    slopeMinPerRound: gate === null ? 0.4 : null,
    olderMedianMin: null,
    newerMedianMin: null,
    spreadMin: null,
    events: 8,
    days: 4,
    roundOneOnly: false,
    blockedBy: gate,
    method: "",
    ...over,
  };
}

const EVERY_GATE: PlanTrendGate[] = [
  "too-few-events",
  "too-few-days",
  "lopsided-halves",
  "censoring-limited",
  "below-noise",
  "sign-disagreement",
  "unstable",
];

describe("the sparkline caption names the gate that actually stopped the line", () => {
  it("every gate gets its own caption, and no two gates share one", () => {
    const captions = new Set<string>();
    for (const gate of EVERY_GATE) {
      const caption = holdSparkCaption(trendAt(gate), false);
      expect(caption.startsWith("dots only — ")).toBe(true);
      expect(caption.trim().length).toBeGreaterThan("dots only — ".length + 10);
      captions.add(caption);
    }
    expect(captions.size).toBe(EVERY_GATE.length);
  });

  it("only `too-few-events` may say the history is short, or name the 6-drift bar", () => {
    for (const gate of EVERY_GATE) {
      const caption = holdSparkCaption(trendAt(gate), false);
      if (gate === "too-few-events") {
        expect(caption).toContain(`a line needs ${PLAN_TREND_MIN_EVENTS}`);
        continue;
      }
      expect(caption.toLowerCase()).not.toContain("not enough history");
      expect(caption.toLowerCase()).not.toContain("so far");
      expect(caption).not.toContain(`needs ${PLAN_TREND_MIN_EVENTS}`);
    }
  });

  it("the caption and the card sentence never name different gates", () => {
    // Each gate's two sentences must agree on WHY, so a student reading the
    // setup card and then the debrief is not told two different stories.
    const marker: Record<PlanTrendGate, RegExp> = {
      "too-few-events": /a line needs 6|It needs 6/,
      "too-few-days": /different days|but on \d+ day/,
      "lopsided-halves": /half .*fewer than 3|too few drifts/,
      "censoring-limited": /ran clean/,
      "below-noise": /spread/,
      "sign-disagreement": /halves and the overall slope|disagree/,
      unstable: /drop any single round|direction changes/,
    };
    for (const gate of EVERY_GATE) {
      const trend = trendAt(gate, { days: gate === "too-few-days" ? 1 : 4 });
      expect(holdSparkCaption(trend, false)).toMatch(marker[gate]);
      expect(trendLine(trend) ?? "").toMatch(marker[gate]);
    }
  });

  it("says a line was drawn only when one was", () => {
    expect(holdSparkCaption(trendAt(null), true)).toContain("Theil–Sen line");
    for (const gate of EVERY_GATE) {
      expect(holdSparkCaption(trendAt(gate), false)).not.toContain("Theil–Sen line");
    }
    // A cleared trend with fewer than two marks still has no line to describe.
    expect(holdSparkCaption(trendAt(null), false)).not.toContain("Theil–Sen line");
    expect(holdSparkCaption(trendAt(null), false)).toContain("two points");
  });

  it("REGRESSION — a real below-noise history is never told it is short of history", () => {
    // `stationary20`: 20 rounds of a student who is not improving, spread over
    // ten days. Every gate about history volume passes; the change is simply
    // inside their own spread.
    const rounds = selectWindow(stationary20.rounds, { includeDiscarded: true });
    const debrief = debriefFor({
      round: rounds[rounds.length - 1]!,
      rounds,
      forecastEnabled: true,
      stretchEnabled: true,
    });
    const { trend } = debrief.next;
    expect(trend.blockedBy).toBe("below-noise");
    expect(trend.events).toBeGreaterThanOrEqual(PLAN_TREND_MIN_EVENTS);
    expect(trend.days).toBeGreaterThanOrEqual(PLAN_TREND_MIN_DAYS);

    const caption = sparkCaptionOf(debrief);
    expect(caption).toBe("dots only — the change is smaller than your round-to-round spread.");
    expect(caption).not.toContain("not enough history");
    expect(caption).not.toContain("6 drifts");
  });

  it("a genuinely short history still says so, with its own count", () => {
    const rounds = selectWindow(drift19_22_20.rounds, { includeDiscarded: true });
    const debrief = debriefFor({
      round: rounds[rounds.length - 1]!,
      rounds,
      forecastEnabled: true,
      stretchEnabled: true,
    });
    expect(debrief.next.trend.blockedBy).toBe("too-few-events");
    expect(sparkCaptionOf(debrief)).toBe(
      `dots only — ${debrief.next.trend.events} drifts so far — a line needs ${PLAN_TREND_MIN_EVENTS}, on ${PLAN_TREND_MIN_DAYS} different days.`,
    );
  });
});

describe("number formatting helpers", () => {
  it("never renders a zero or a NaN as a minute count", () => {
    expect(minutesText(0)).toBe("under a minute");
    expect(minutesText(0.4)).toBe("under a minute");
    expect(minutesText(1)).toBe("1 minute");
    expect(minutesText(19.6)).toBe("20 minutes");
    expect(minutesText(Number.NaN)).not.toMatch(/NaN/);
  });

  it("lists read as English", () => {
    expect(minutesList([19])).toBe("19");
    expect(minutesList([19, 22])).toBe("19 and 22");
    expect(minutesList([19, 22, 20])).toBe("19, 22 and 20");
    expect(minutesList([])).toBe("");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * H10 — the digit-membership fuzz.
 *
 * Every number in a rendered sentence must exist in the model that produced
 * it. The allowed set is built from the model's own values under only the
 * transformations the copy is permitted to apply (rounding, seconds to
 * minutes, risk to a percentage, an absolute value), plus the handful of
 * plan constants the copy is allowed to name by number. Copy that invents a
 * figure fails here and cannot be argued with.
 * ──────────────────────────────────────────────────────────────────────── */

/** The constants copy may name. Each is a fixed product decision, not a datum. */
const NAMEABLE_CONSTANTS = [
  PLAN_DEFAULT_FOCUS_MIN,
  PLAN_MIN_FOCUS_MIN,
  PLAN_MAX_REACH_MIN,
  PLAN_STRETCH_MIN,
  PLAN_BACKOFF_MIN,
  PLAN_TREND_MIN_EVENTS,
  PLAN_TREND_MIN_DAYS,
  PLAN_TREND_MIN_HALF,
  PLAN_WINDOW_DAYS,
  PLAN_MIN_ROUND_SEC / 60,
];

function numericLeaves(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      numericLeaves(item, out);
    }
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      numericLeaves(item, out);
    }
  }
  return out;
}

/** Rounding, seconds to minutes, risk to a percentage, absolute value. */
function permittedForms(value: number): number[] {
  if (!Number.isFinite(value)) {
    return [];
  }
  return [
    value,
    Math.round(value),
    Math.floor(value),
    Math.ceil(value),
    Math.abs(value),
    Math.round(Math.abs(value)),
    Math.round(value / 60),
    Math.floor(value / 60),
    Math.round(value * 100),
  ];
}

function allowedNumbers(model: unknown, derived: readonly number[]): Set<number> {
  const allowed = new Set<number>();
  for (const value of [...numericLeaves(model), ...derived, ...NAMEABLE_CONSTANTS]) {
    for (const form of permittedForms(value)) {
      allowed.add(form);
    }
  }
  return allowed;
}

function numbersIn(line: string): number[] {
  return [...line.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

/**
 * Quantities the copy computes rather than reads. Each is a documented
 * derivation, listed here so the fuzz stays a real constraint: if the copy
 * ever computes something new, this list has to grow and someone has to
 * justify the entry.
 */
function derivedForCard(card: PlanRecommendation): number[] {
  const { trend } = card;
  const delta =
    trend.newerMedianMin === null || trend.olderMedianMin === null
      ? []
      : [trend.newerMedianMin - trend.olderMedianMin];
  return [...delta];
}

function derivedForDebrief(debrief: PlanDebrief): number[] {
  const { round } = debrief;
  const lead =
    round.firstDriftSec !== null && round.peakRiskSec !== null
      ? [(round.firstDriftSec - round.peakRiskSec) / 60]
      : [];
  const gaps: number[] = [];
  for (let i = 1; i < round.driftsSec.length; i += 1) {
    gaps.push(((round.driftsSec[i] ?? 0) - (round.driftsSec[i - 1] ?? 0)) / 60);
  }
  return [...lead, ...gaps, round.driftsSec.length];
}

describe("H10 — copy physically cannot invent a figure", () => {
  it("every number on every card variant comes from that card's own model", () => {
    for (const card of everyCard()) {
      const allowed = allowedNumbers(card, derivedForCard(card));
      for (const line of cardStrings(card)) {
        for (const value of numbersIn(line)) {
          expect({ line, value, known: allowed.has(value) }).toEqual({ line, value, known: true });
        }
      }
    }
  });

  it("every number in every debrief branch comes from that debrief's own model", () => {
    for (const debrief of everyDebrief()) {
      const allowed = allowedNumbers(debrief, derivedForDebrief(debrief));
      for (const line of debriefStrings(debrief)) {
        for (const value of numbersIn(line)) {
          expect({ line, value, known: allowed.has(value) }).toEqual({ line, value, known: true });
        }
      }
    }
  });

  it("holds over 5000 randomly generated histories", () => {
    let state = 20_260_913;
    const next = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };

    for (let run = 0; run < 5000; run += 1) {
      const size = Math.floor(next() * 8);
      const rounds: PlanRound[] = Array.from({ length: size }, () => {
        const plannedFocusMin = 10 + Math.floor(next() * 40);
        const drifted = next() < 0.6;
        return makeRound({
          day: Math.floor(next() * 10),
          atMin: Math.floor(next() * 600),
          plannedFocusMin,
          servedMin: Math.max(1, Math.round(plannedFocusMin * (0.2 + next() * 0.9))),
          driftMin: drifted ? Math.round(next() * plannedFocusMin * 10) / 10 : null,
          round: 1 + Math.floor(next() * 3),
          startedDrifted: next() < 0.08,
          peakRisk: next() < 0.7 ? Math.round(next() * 100) / 100 : null,
          peakRiskMin: Math.round(next() * plannedFocusMin),
          countdowns: Math.floor(next() * 3),
          kills: Math.floor(next() * 2),
          wobbleMin: next() < 0.5 ? Math.round(next() * plannedFocusMin) : null,
          standDowns: Math.floor(next() * 2),
        });
      });

      const card = planFor(rounds, {
        forecastEnabled: next() < 0.8,
        stretchEnabled: next() < 0.8,
      });
      const allowed = allowedNumbers(card, derivedForCard(card));
      for (const line of cardStrings(card)) {
        for (const value of numbersIn(line)) {
          expect({ run, line, value, known: allowed.has(value) }).toEqual({
            run,
            line,
            value,
            known: true,
          });
        }
      }

      const last = rounds[rounds.length - 1];
      if (last === undefined) {
        continue;
      }
      const debrief = debriefFor({
        round: last,
        rounds: selectWindow(rounds, { includeDiscarded: true }),
        forecastEnabled: true,
        stretchEnabled: true,
      });
      const debriefAllowed = allowedNumbers(debrief, derivedForDebrief(debrief));
      for (const line of debriefStrings(debrief)) {
        for (const value of numbersIn(line)) {
          expect({ run, line, value, known: debriefAllowed.has(value) }).toEqual({
            run,
            line,
            value,
            known: true,
          });
        }
      }
    }
  });

  it("the fuzz's own allowlist is not a rubber stamp (positive control)", () => {
    const card = planFor(drift19_22_20.rounds);
    const allowed = allowedNumbers(card, derivedForCard(card));
    // A number nothing in this model produces must be rejected.
    expect(allowed.has(4242)).toBe(false);
    expect(numbersIn("held 19 minutes, peaked at 78%")).toEqual([19, 78]);
  });
});

describe("the decided copy beats, verbatim enough to recognise", () => {
  it("the fresh install card is not an empty state", () => {
    const card = planFor(fresh.rounds);
    expect(card.copy.headline).toBe("Start with 25 minutes, then 5 off.");
    expect(card.copy.reasoning.length).toBeGreaterThan(80);
  });

  it("the measured beat reads as decided", () => {
    const card = planFor(drift19_22_20.rounds);
    expect(card.copy.headline).toBe("20 minutes of work, then 4 off.");
    expect(card.copy.reasoning).toContain("19, 22 and 20 minutes");
    expect(card.copy.reasoning).toContain("the middle of that is 20");
  });

  it("the ease beat promises the way back in the same sentence", () => {
    const card = planFor(easeReady.rounds);
    expect(card.copy.headline).toBe("Ease back: 17 minutes, then 3 off.");
    expect(card.copy.reasoning).toContain("It goes back up as soon as you hold two in a row.");
  });
});

describe("stability", () => {
  it("copy is a pure function of the model — same input, same words", () => {
    const rounds = selectWindow(mixedRounds.rounds, { includeDiscarded: true });
    const a = recommend({ rounds, live: null, forecastEnabled: true, stretchEnabled: true });
    const b = recommend({ rounds, live: null, forecastEnabled: true, stretchEnabled: true });
    expect(a.copy).toEqual(b.copy);
  });

  it("a window that straddles the 28-day cut still renders", () => {
    const straddling = [
      { ...makeRound({ day: 0, driftMin: 19 }), startedAt: T0 - (PLAN_WINDOW_DAYS + 3) * DAY },
      makeRound({ day: 1, driftMin: 21, atMin: 10 * MINUTE }),
    ];
    const card = planFor(straddling);
    for (const line of cardStrings(card)) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});
