import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { recommend } from "./progression";
import { selectWindow } from "./ledger";
import { FORECAST_OFF_NOTE, holdSparkCaption, trendLine } from "./copy";
import * as fixtures from "./fixtures";
import type { PlanRecommendation, PlanTrend, PlanTrendGate } from "./types";

/**
 * §6.2 of `docs/FOCUS-PLAN.md` is titled "Real copy, every rung" and quotes
 * the card, one block per rung, plus a table of every trend refusal. A quote
 * that has drifted from the string the code emits is the most expensive kind
 * of documentation error in this feature: the whole thesis is that a claim
 * about the copy is asserted rather than promised, and a reader who checks
 * one sentence and finds it invented stops believing the rest.
 *
 * So the doc is read back here and every quoted line has to be a string the
 * copy layer actually produces. The positive control at the end fails if this
 * checker ever stops looking.
 *
 * `purity.test.ts` skips `*.test.ts`, which is why this file may touch
 * `node:fs` while nothing it tests may.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DOC = readFileSync(join(repoRoot, "docs/FOCUS-PLAN.md"), "utf-8");

const NOW = fixtures.T0 + 9 * fixtures.DAY + 12 * 60 * fixtures.MINUTE;

function card(
  ledger: { rounds: readonly import("./types").PlanRound[] },
  live: import("./types").LivePlanRound | null = null,
  forecastEnabled = true,
): PlanRecommendation {
  return recommend({
    rounds: selectWindow(ledger.rounds, { nowMs: NOW, includeDiscarded: true }),
    live,
    forecastEnabled,
    stretchEnabled: true,
  });
}

/** A `PlanTrend` carrying just enough to reach one gate's sentence. */
function trendAt(gate: PlanTrendGate | null, over: Partial<PlanTrend> = {}): PlanTrend {
  return {
    direction: "flat",
    confidence: gate === null ? "clear" : "none",
    slopeMinPerRound: null,
    olderMedianMin: null,
    newerMedianMin: null,
    spreadMin: null,
    events: 0,
    days: 0,
    roundOneOnly: false,
    blockedBy: gate,
    method: "",
    ...over,
  };
}

/**
 * Every string the copy layer can put on a card, over the named ledgers the
 * doc quotes — plus the trend sentences, which need a shaped `PlanTrend`
 * rather than a ledger to reach every gate.
 */
function emittedStrings(): Set<string> {
  const out = new Set<string>();
  const cards: PlanRecommendation[] = [
    card(fixtures.fresh),
    card(fixtures.fresh, fixtures.liveWobble),
    card(fixtures.fresh, fixtures.liveQuiet),
    card(fixtures.clean3),
    card(fixtures.single),
    card(fixtures.pair),
    card(fixtures.drift19_22_20),
    card(fixtures.stretchReady),
    card(fixtures.easeReady),
    card(fixtures.censorHeavy),
    card(fixtures.improving),
    card(fixtures.stationary20),
    card(fixtures.mixedRounds),
    card(fixtures.improving, null, false),
  ];
  for (const rec of cards) {
    const { copy } = rec;
    for (const line of [
      copy.kicker,
      copy.headline,
      copy.reasoning,
      copy.trendLine,
      copy.forecastNote,
      copy.method,
      copy.overrideLine,
    ]) {
      if (line !== null && line.length > 0) {
        out.add(line);
      }
    }
    // The card renders the button and the override line on one row; the doc
    // quotes that row, so the composition is spelled out rather than hidden.
    out.add(`[ ${copy.acceptLabel} ] ${copy.overrideLine}`);
  }

  const gates: Array<[PlanTrendGate, Partial<PlanTrend>]> = [
    ["too-few-events", { events: 0, days: 0 }],
    ["too-few-events", { events: 4, days: 2 }],
    ["too-few-days", { events: 7, days: 1 }],
    ["lopsided-halves", { events: 8, days: 4 }],
    ["censoring-limited", { events: 2, days: 2 }],
    [
      "below-noise",
      { confidence: "weak", events: 8, days: 4, newerMedianMin: 20, olderMedianMin: 19, spreadMin: 4 },
    ],
    ["sign-disagreement", { confidence: "weak", events: 8, days: 4 }],
    ["unstable", { confidence: "weak", events: 8, days: 4 }],
  ];
  for (const [gate, over] of gates) {
    const trend = trendAt(gate, over);
    const line = trendLine(trend);
    if (line !== null) {
      out.add(line);
    }
    // The debrief's sparkline caption is the only sentence that surface prints
    // about direction, so the doc quotes one per gate and each is checked here
    // like every other string.
    out.add(holdSparkCaption(trend, false));
  }
  out.add(holdSparkCaption(trendAt(null), true));

  // The clear line in both like-for-like modes. The numbers come from the
  // `improving` fixture's own trend, so the mixed variant the doc quotes is
  // the same sentence about the same window, not a second set of numbers.
  const clear = card(fixtures.improving).trend;
  for (const roundOneOnly of [true, false]) {
    const line = trendLine({ ...clear, roundOneOnly });
    if (line !== null) {
      out.add(line);
    }
  }

  out.add(FORECAST_OFF_NOTE);
  return out;
}

/** `> **FOCUS PLAN · x**` and `> ### Headline.` both reduce to their text. */
function plain(line: string): string {
  return line
    .replace(/^>\s?/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionSixTwo(): string {
  const start = DOC.indexOf("### 6.2 Real copy, every rung");
  const end = DOC.indexOf('### 6.3 "Why this?"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return DOC.slice(start, end);
}

/** Every blockquote line, and every last cell of the trend table. */
function quotedStrings(section: string): string[] {
  const out: string[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (line.startsWith(">") && plain(line).length > 0) {
      out.push(plain(line));
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|") && !line.includes("---")) {
      const cells = line.slice(1, -1).split("|");
      const last = cells[cells.length - 1];
      if (last !== undefined && plain(last) !== "copy, verbatim") {
        out.push(plain(last));
      }
    }
  }
  return out;
}

describe("docs/FOCUS-PLAN.md §6.2 quotes copy the code really emits", () => {
  it("finds the section and a quote for every rung", () => {
    const quotes = quotedStrings(sectionSixTwo());
    // 6 rungs + the stretch and ease steps, at 3-4 lines each, plus 9 trend
    // rows, the mixed caveat line and the forecast-off note.
    expect(quotes.length).toBeGreaterThanOrEqual(30);
  });

  it("every quoted line is a string the copy layer produces", () => {
    const emitted = emittedStrings();
    const invented = quotedStrings(sectionSixTwo()).filter((line) => !emitted.has(line));
    expect(invented).toEqual([]);
  });

  it("the checker is not a rubber stamp (positive control)", () => {
    const emitted = emittedStrings();
    expect(emitted.has("Start with 25 minutes, then 5 off.")).toBe(true);
    // Plausible, house-idiom, and never emitted.
    expect(emitted.has("Start with 24 minutes, then 5 off.")).toBe(false);
    expect(
      emitted.has("All 7 of those drifts landed on one day. That is one evening, not a trend."),
    ).toBe(false);
    // The caption the code emitted before this gate-naming rule existed. It is
    // plausible, it is house idiom, and nothing emits it any more.
    expect(emitted.has("dots only — the change is smaller than your round-to-round spread.")).toBe(
      true,
    );
    expect(emitted.has("dots only — not enough history for a line (it needs 6 drifts).")).toBe(
      false,
    );
  });
});
