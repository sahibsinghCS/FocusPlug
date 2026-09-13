import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../types";
import { PLAN_LEDGER_CAP, PLAN_MAX_TICK_GAP_SEC, PLAN_WINDOW_DAYS, PLAN_WINDOW_ROUNDS } from "./constants";
import { DAY, MINUTE, T0, dayKey, drift19_22_20, makeRound, mixedRounds } from "./fixtures";
import {
  SEED_FALLBACK_NOTE,
  SEED_FALLBACK_SOURCE,
  accumulateServed,
  appendRound,
  civilDayUtc,
  eligibleRounds,
  evidenceFrom,
  ledgerFromSessionLog,
  normalizeRound,
  normalizeSeedStamp,
  reviveLedger,
  samplesFrom,
  selectWindow,
} from "./ledger";
import { PLAN_LEDGER_VERSION, type PlanRound } from "./types";

const GOOD: PlanRound = makeRound({ day: 0, driftMin: 19 });

describe("revive is defensive — a corrupt ledger is a short history, never a crash", () => {
  it.each([
    ["not an object", 42],
    ["null", null],
    ["wrong version", { v: 99, lifetimeRounds: 1, rounds: [GOOD] }],
    ["rounds is not an array", { v: PLAN_LEDGER_VERSION, lifetimeRounds: 1, rounds: "nope" }],
    ["missing rounds", { v: PLAN_LEDGER_VERSION, lifetimeRounds: 1 }],
  ])("%s gives an empty ledger and no throw", (_name, raw) => {
    expect(reviveLedger(raw)).toEqual({ v: PLAN_LEDGER_VERSION, lifetimeRounds: 0, rounds: [] });
  });

  it.each([
    ["NaN servedSec", { servedSec: Number.NaN }],
    ["negative servedSec", { servedSec: -1 }],
    ["Infinity startedAt", { startedAt: Number.POSITIVE_INFINITY }],
    ["a malformed day key", { day: "yesterday" }],
    ["an hour out of range", { hour: 25 }],
    ["an unknown status", { status: "paused" }],
    ["a blank roundKey", { roundKey: "" }],
    ["a wrong record version", { v: 2 }],
  ])("drops the record with %s and keeps the good one", (_name, patch) => {
    const ledger = reviveLedger({
      v: PLAN_LEDGER_VERSION,
      lifetimeRounds: 2,
      rounds: [{ ...GOOD, ...patch }, GOOD],
    });
    expect(ledger.rounds).toHaveLength(1);
    expect(ledger.rounds[0]?.roundKey).toBe(GOOD.roundKey);
  });

  it("round-trips a good ledger unchanged, oldest first", () => {
    const ledger = reviveLedger({
      v: PLAN_LEDGER_VERSION,
      lifetimeRounds: 3,
      rounds: [...drift19_22_20.rounds].reverse(),
    });
    expect(ledger.rounds.map((r) => r.firstDriftSec)).toEqual([19 * 60, 22 * 60, 20 * 60]);
    expect(ledger.lifetimeRounds).toBe(3);
  });

  it("normalizeRound rejects a non-object outright", () => {
    expect(normalizeRound("round")).toBeNull();
    expect(normalizeRound(null)).toBeNull();
  });

  it("caps the stored ledger without losing the newest rounds", () => {
    const many = Array.from({ length: PLAN_LEDGER_CAP + 20 }, (_, i) =>
      makeRound({ day: 0, atMin: i, driftMin: 10 }),
    );
    const ledger = reviveLedger({ v: PLAN_LEDGER_VERSION, lifetimeRounds: many.length, rounds: many });
    expect(ledger.rounds).toHaveLength(PLAN_LEDGER_CAP);
    expect(ledger.rounds[ledger.rounds.length - 1]?.startedAt).toBe(
      many[many.length - 1]?.startedAt,
    );
  });
});

describe("appendRound", () => {
  it("adds a round, bumps the lifetime count, and keeps chronological order", () => {
    const first = appendRound({ v: PLAN_LEDGER_VERSION, lifetimeRounds: 0, rounds: [] }, GOOD);
    const second = appendRound(first, makeRound({ day: 1, driftMin: 20 }));
    expect(second.lifetimeRounds).toBe(2);
    expect(second.rounds.map((r) => r.startedAt)).toEqual([...second.rounds].sort((a, b) => a.startedAt - b.startedAt).map((r) => r.startedAt));
  });

  it("a resumed round replaces its earlier self rather than doubling it", () => {
    const first = appendRound({ v: PLAN_LEDGER_VERSION, lifetimeRounds: 0, rounds: [] }, GOOD);
    const merged = appendRound(first, { ...GOOD, servedSec: GOOD.servedSec + 600 });
    expect(merged.rounds).toHaveLength(1);
    expect(merged.rounds[0]?.servedSec).toBe(GOOD.servedSec + 600);
  });
});

describe("selectWindow", () => {
  it("respects PLAN_WINDOW_ROUNDS, keeping the newest", () => {
    const many = Array.from({ length: PLAN_WINDOW_ROUNDS + 5 }, (_, i) =>
      makeRound({ day: 0, atMin: i * 30, driftMin: 10 + i }),
    );
    const window = selectWindow(many);
    expect(window).toHaveLength(PLAN_WINDOW_ROUNDS);
    expect(window[window.length - 1]?.startedAt).toBe(many[many.length - 1]?.startedAt);
  });

  it("respects PLAN_WINDOW_DAYS, dropping what fell out of the month", () => {
    const stale = makeRound({ day: 0, driftMin: 19 });
    const fresh = { ...makeRound({ day: 0, driftMin: 20 }), startedAt: T0 + (PLAN_WINDOW_DAYS + 2) * DAY };
    const window = selectWindow([stale, fresh]);
    expect(window).toHaveLength(1);
    expect(window[0]?.startedAt).toBe(fresh.startedAt);
  });

  it("drops discarded rounds by default and keeps them for the disclosure", () => {
    expect(selectWindow(mixedRounds.rounds)).toHaveLength(4);
    expect(selectWindow(mixedRounds.rounds, { includeDiscarded: true })).toHaveLength(5);
  });
});

describe("samples and evidence", () => {
  it("censors clean rounds and never turns a censored hold into a drift time (H1)", () => {
    const samples = samplesFrom([
      makeRound({ day: 0, plannedFocusMin: 25, driftMin: 19 }),
      makeRound({ day: 1, plannedFocusMin: 25, driftMin: null }),
    ]);
    expect(samples).toEqual([
      expect.objectContaining({ minutes: 19, censored: false }),
      expect.objectContaining({ minutes: 25, censored: true }),
    ]);
  });

  it("eligibleRounds excludes discarded and started-drifted rounds", () => {
    expect(eligibleRounds(mixedRounds.rounds)).toHaveLength(3);
  });

  it("evidence carries every round, and counted is exactly the absence of a reason", () => {
    const rows = evidenceFrom(mixedRounds.rounds);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.counted).toBe(row.excludedBecause === null);
    }
  });
});

describe("served seconds", () => {
  it("clamps every tick, so a suspend cannot inflate the number", () => {
    expect(accumulateServed(0, 1)).toBe(1);
    expect(accumulateServed(0, 4 * 60 * 60)).toBe(PLAN_MAX_TICK_GAP_SEC);
    expect(accumulateServed(100, -5)).toBe(100);
    expect(accumulateServed(100, Number.NaN)).toBe(100);
  });
});

describe("civilDayUtc — a day key without ever constructing a Date", () => {
  it("agrees with the fixtures' own day keys, so the two can never drift apart", () => {
    for (let i = 0; i < 10; i += 1) {
      expect(civilDayUtc(T0 + i * DAY).day).toBe(dayKey(i));
    }
  });

  it.each([
    [0, "1970-01-01", 0],
    [T0, "2026-09-01", 9],
    [951_782_400_000, "2000-02-29", 0],
    [1_609_459_199_000, "2020-12-31", 23],
  ])("%i is %s hour %i", (ms, day, hour) => {
    expect(civilDayUtc(ms)).toEqual({ day, hour });
  });
});

describe("ledgerFromSessionLog — the audit trail rebuilt", () => {
  const base = T0;
  function log(rows: ReadonlyArray<[number, string, string]>): SessionEvent[] {
    return rows.map(([offsetMin, kind, detail]) => ({ ts: base + offsetMin * MINUTE, kind, detail }));
  }

  it("rebuilds a drifted round with its MUFD and its cost", () => {
    const ledger = ledgerFromSessionLog(
      log([
        [0, "session", "Session started"],
        [0, "decision", "ON_TASK · Docs"],
        [19, "decision", "DISTRACTED · Discord"],
        [19, "countdown", "start_countdown · blocked window · 10s"],
        [19, "kill", "blocked window · killed Discord.exe"],
        [21, "decision", "ON_TASK · Docs"],
        [25, "session", "Session stopped — observe only"],
      ]),
    );
    expect(ledger.rounds).toHaveLength(1);
    const round = ledger.rounds[0];
    expect(round?.firstDriftSec).toBe(19 * 60);
    expect(round?.firstDriftType).toBe("tab_out");
    expect(round?.countdowns).toBe(1);
    expect(round?.kills).toBe(1);
    expect(round?.servedSec).toBe(25 * 60);
  });

  it("a clean round comes back censored", () => {
    const ledger = ledgerFromSessionLog(
      log([
        [0, "session", "Session started"],
        [0, "decision", "ON_TASK · Docs"],
        [25, "session", "Session stopped — observe only"],
      ]),
    );
    expect(ledger.rounds[0]?.firstDriftSec).toBeNull();
    expect(ledger.rounds[0]?.status).toBe("completed");
  });

  it("a round that opened on a blocked app is marked, not silently counted", () => {
    const ledger = ledgerFromSessionLog(
      log([
        [0, "session", "Session started"],
        [0, "decision", "IDLE · starting"],
        [0.2, "decision", "AWAY · nobody at the desk"],
        [30, "session", "Session stopped — observe only"],
      ]),
    );
    expect(ledger.rounds[0]?.startedDrifted).toBe(true);
    expect(eligibleRounds(ledger.rounds)).toHaveLength(0);
  });

  it("uses the same drift definition as the live path, so the two agree", () => {
    const rebuilt = ledgerFromSessionLog(
      log([
        [0, "session", "Session started"],
        [0, "decision", "ON_TASK · Docs"],
        [19, "decision", "DISTRACTED · Discord"],
        [19.2, "decision", "ON_TASK · Docs"],
        // 24 s after the first onset: inside DRIFT_DEBOUNCE_SEC, so it merges.
        [19.4, "decision", "AWAY · nobody at the desk"],
        [25, "decision", "ON_TASK · Docs"],
        [40, "decision", "DISTRACTED · Discord"],
        [45, "session", "Session stopped — observe only"],
      ]),
    );
    expect(rebuilt.rounds[0]?.driftsSec).toEqual([19 * 60, 40 * 60]);
  });

  it("ignores rows outside a round and never throws on junk", () => {
    const ledger = ledgerFromSessionLog(
      log([
        [0, "decision", "DISTRACTED · before any session"],
        [1, "lists", "Blocklist updated (4 apps)"],
        [2, "session", "Session started"],
        [3, "decision", "not-a-decision"],
        [4, "decision", "ON_TASK · Docs"],
        [30, "session", "Session stopped — observe only"],
      ]),
    );
    expect(ledger.rounds).toHaveLength(1);
    expect(ledger.rounds[0]?.firstDriftSec).toBeNull();
  });

  it("an empty log is an empty ledger", () => {
    expect(ledgerFromSessionLog([])).toEqual({ v: PLAN_LEDGER_VERSION, lifetimeRounds: 0, rounds: [] });
  });

  it("accepts an injected day stamp, so main can supply local days", () => {
    const ledger = ledgerFromSessionLog(
      log([
        [0, "session", "Session started"],
        [0, "decision", "ON_TASK · Docs"],
        [25, "session", "Session stopped — observe only"],
      ]),
      () => ({ day: "2026-01-02", hour: 7 }),
    );
    expect(ledger.rounds[0]?.day).toBe("2026-01-02");
    expect(ledger.rounds[0]?.hour).toBe(7);
  });
});

/**
 * The seed stamp is the only thing standing between a filmed demo and a false
 * claim: `npm run demo:seed` writes a ledger that looks on screen exactly like
 * a measured one. So it has to survive everything the app does to the file
 * afterwards, and an unreadable stamp has to keep disclosing rather than fail
 * quiet.
 */
describe("the seed stamp — fabricated history cannot age into measurement", () => {
  const STAMP = {
    source: "npm run demo:seed",
    writtenAt: T0,
    rounds: 3,
    note: "Fabricated for filming.",
  };

  it("is absent from a ledger that never had one", () => {
    expect(reviveLedger({ v: PLAN_LEDGER_VERSION, lifetimeRounds: 1, rounds: [GOOD] }).seed).toBeUndefined();
    expect(appendRound(reviveLedger(null), GOOD).seed).toBeUndefined();
  });

  it("survives revive", () => {
    const revived = reviveLedger({
      v: PLAN_LEDGER_VERSION,
      lifetimeRounds: 3,
      rounds: drift19_22_20.rounds,
      seed: STAMP,
    });
    expect(revived.seed).toEqual(STAMP);
    expect(revived.rounds).toHaveLength(3);
  });

  it("survives the round that would otherwise launder it", () => {
    const seeded = reviveLedger({
      v: PLAN_LEDGER_VERSION,
      lifetimeRounds: 3,
      rounds: drift19_22_20.rounds,
      seed: STAMP,
    });
    const after = appendRound(seeded, makeRound({ day: 5, driftMin: 12 }));
    expect(after.seed).toEqual(STAMP);
    // …and again on the next launch, through the same file the app rewrote.
    expect(reviveLedger(JSON.parse(JSON.stringify(after))).seed).toEqual(STAMP);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["false", false],
    ["empty string", ""],
    ["zero", 0],
  ])("%s is not a seed", (_name, raw) => {
    expect(normalizeSeedStamp(raw)).toBeNull();
  });

  it("a stamp that cannot say what it is still says it is a stamp", () => {
    expect(normalizeSeedStamp({})).toEqual({
      source: SEED_FALLBACK_SOURCE,
      writtenAt: 0,
      rounds: 0,
      note: SEED_FALLBACK_NOTE,
    });
    expect(normalizeSeedStamp(true)?.note).toBe(SEED_FALLBACK_NOTE);
    expect(normalizeSeedStamp({ source: "   ", note: "", rounds: "nope" })).toEqual({
      source: SEED_FALLBACK_SOURCE,
      writtenAt: 0,
      rounds: 0,
      note: SEED_FALLBACK_NOTE,
    });
  });

  it("normalises what it can read, and bounds what it cannot trust", () => {
    const long = "x".repeat(900);
    const stamp = normalizeSeedStamp({ source: long, note: long, rounds: 4.6, writtenAt: T0 });
    expect(stamp?.source).toHaveLength(120);
    expect(stamp?.note).toHaveLength(400);
    expect(stamp?.rounds).toBe(5);
    expect(stamp?.writtenAt).toBe(T0);
  });
});
