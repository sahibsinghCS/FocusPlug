import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import type { AppSettings } from "../../shared/ipc.ts";
import type { Decision } from "../../shared/types.ts";
import type { FocusPlanLedger, PlanRound, SessionPlanContext } from "../../shared/plan/types.ts";
import { MutableClock } from "../session/harness.ts";
import { createMemoryPlanStore, sessionState, type MemoryPlanStore } from "./harness.ts";
import { PLAN_PIN_ENV, PlanRecorder, type PlanLedgerStore } from "./recorder.ts";

/**
 * A pause the student says was WRONG was not a drift, so it must not count
 * against minutes-until-first-drift. This is the recorder's half of that: the
 * rewrite has to land in `carried` AND in the ledger, it has to survive the
 * resume, and every refusal has to be named rather than silent.
 *
 * `docs/CORRECTION-LOOP.md § 5`.
 */

interface Rig {
  clock: MutableClock;
  recorder: PlanRecorder;
  rounds: PlanRound[];
  log: string[];
  store: MemoryPlanStore | null;
}

function makeRig(init?: { settings?: Partial<AppSettings>; store?: PlanLedgerStore | null }): Rig {
  const clock = new MutableClock(1_700_000_000_000);
  const rounds: PlanRound[] = [];
  const log: string[] = [];
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...init?.settings };
  const store = init?.store === undefined ? createMemoryPlanStore() : init.store;
  const recorder = new PlanRecorder({
    loadSettings: () => settings,
    appendLog: (detail) => log.push(detail),
    push: { round: (round) => rounds.push({ ...round, driftsSec: [...round.driftsSec] }) },
    store,
    now: clock.now,
  });
  return { clock, recorder, rounds, log, store: store as MemoryPlanStore | null };
}

function context(overrides?: Partial<SessionPlanContext>): SessionPlanContext {
  return {
    roundKey: "plan-0",
    round: 1,
    roundsTotal: 2,
    plannedFocusSec: 1500,
    plannedBreakSec: 300,
    recommendedFocusSec: 1200,
    acceptedRecommendation: true,
    ...overrides,
  };
}

function arm(rig: Rig, ctx: unknown = context()): void {
  rig.recorder.declareRound(ctx);
  rig.recorder.onSessionState(sessionState(true));
}

function disarm(rig: Rig): void {
  rig.recorder.onSessionState(sessionState(false));
}

function serve(rig: Rig, seconds: number, stepSec = 5): void {
  const steps = Math.round(seconds / stepSec);
  for (let i = 0; i < steps; i += 1) {
    rig.clock.advance(stepSec * 1000);
    rig.recorder.onSessionState(sessionState(true));
  }
}

function status(rig: Rig, decision: Decision): void {
  rig.recorder.onPolicyEvent({ type: "status", decision, detail: `${decision} in a test` });
}

function ledgerRounds(store: MemoryPlanStore | null): PlanRound[] {
  const raw = store?.current() ?? null;
  return raw === null ? [] : ((raw as FocusPlanLedger).rounds ?? []);
}

/**
 * The shape a false `away` pause leaves behind: on task, then AWAY, then the
 * pause stops the session while the stream is still drifted.
 */
function pausedOnAway(rig: Rig, options?: { driftAtSec?: number; afterSec?: number }): void {
  arm(rig);
  status(rig, "ON_TASK");
  serve(rig, options?.driftAtSec ?? 360);
  status(rig, "AWAY");
  serve(rig, options?.afterSec ?? 60);
  disarm(rig);
}

function withPin<T>(body: () => T): T {
  const before = process.env[PLAN_PIN_ENV];
  process.env[PLAN_PIN_ENV] = "1";
  try {
    return body();
  } finally {
    if (before === undefined) {
      delete process.env[PLAN_PIN_ENV];
    } else {
      process.env[PLAN_PIN_ENV] = before;
    }
  }
}

describe("retractLastAwayDrift — the drift comes out of the history", () => {
  it("removes the last still-open walk_away onset and censors the round", () => {
    const rig = makeRig();
    pausedOnAway(rig);
    expect(rig.rounds[0]?.firstDriftSec).toBe(360);

    const out = rig.recorder.retractLastAwayDrift();

    expect(out.retracted).toBe(true);
    expect(out.roundKey).toBe("plan-0");
    expect(out.retractedAtSec).toBe(360);
    expect(out.firstDriftSecBefore).toBe(360);
    expect(out.firstDriftSecAfter).toBeNull();
    expect(out.refusal).toBeNull();
  });

  it("rewrites the LEDGER row, replacing by key and leaving lifetimeRounds alone", () => {
    const rig = makeRig();
    pausedOnAway(rig);
    const lifetimeBefore = (rig.store?.current() as FocusPlanLedger).lifetimeRounds;

    rig.recorder.retractLastAwayDrift();

    const rows = ledgerRounds(rig.store);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.driftsSec).toEqual([]);
    expect(rows[0]?.firstDriftSec).toBeNull();
    expect(rows[0]?.firstDriftType).toBeNull();
    expect(rows[0]?.retractedDriftsSec).toEqual([360]);
    expect((rig.store?.current() as FocusPlanLedger).lifetimeRounds).toBe(lifetimeBefore);
  });

  it("pushes the rewritten round so every open surface reconciles", () => {
    const rig = makeRig();
    pausedOnAway(rig);
    rig.recorder.retractLastAwayDrift();

    expect(rig.rounds).toHaveLength(2);
    expect(rig.rounds[1]?.roundKey).toBe("plan-0");
    expect(rig.rounds[1]?.firstDriftSec).toBeNull();
    expect(rig.rounds[1]?.retractedDriftsSec).toEqual([360]);
  });

  it("THE HEADLINE: the resume does not resurrect the drift", () => {
    const rig = makeRig();
    pausedOnAway(rig);
    rig.recorder.retractLastAwayDrift();

    // The student presses "I was working", which resumes under the same key.
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 900);
    disarm(rig);

    const round = rig.rounds[rig.rounds.length - 1] as PlanRound;
    expect(round.roundKey).toBe("plan-0");
    // `openRound` seeds the next segment's onsets from `carried.round.driftsSec`,
    // so an un-retracted `carried` would put 360 straight back.
    expect(round.driftsSec).toEqual([]);
    expect(round.firstDriftSec).toBeNull();
    expect(round.firstDriftType).toBeNull();
    expect(round.retractedDriftsSec).toEqual([360]);
    expect(ledgerRounds(rig.store)).toHaveLength(1);
  });

  it("leaves an earlier real drift alone and only takes the last one", () => {
    const rig = makeRig();
    arm(rig);
    status(rig, "ON_TASK");
    serve(rig, 300);
    status(rig, "DISTRACTED");
    serve(rig, 120);
    status(rig, "ON_TASK");
    serve(rig, 300);
    status(rig, "AWAY");
    serve(rig, 60);
    disarm(rig);

    const out = rig.recorder.retractLastAwayDrift();
    expect(out.retracted).toBe(true);
    expect(out.retractedAtSec).toBe(720);
    const row = ledgerRounds(rig.store)[0] as PlanRound;
    expect(row.driftsSec).toEqual([300]);
    // The FIRST onset survives, so the headline number does not move at all.
    expect(row.firstDriftSec).toBe(300);
    expect(row.firstDriftType).toBe("tab_out");
  });

  it("reclassifies a short round that is now clean as discarded", () => {
    const rig = makeRig();
    arm(rig, context({ plannedFocusSec: 1500 }));
    status(rig, "ON_TASK");
    serve(rig, 120);
    status(rig, "AWAY");
    serve(rig, 60);
    disarm(rig);
    expect(rig.rounds[0]?.status).toBe("aborted");

    rig.recorder.retractLastAwayDrift();
    expect(ledgerRounds(rig.store)[0]?.status).toBe("discarded");
  });

  it("logs the retraction next to the round it belongs to", () => {
    const rig = makeRig();
    pausedOnAway(rig);
    rig.recorder.retractLastAwayDrift();

    expect(rig.log).toContain("round 1 — drift at 6.0 min retracted (the away reading was wrong)");
  });
});

describe("retractLastAwayDrift — the refusals, named and never thrown", () => {
  it("refuses `not-away` when a blocked app caused the last onset", () => {
    const rig = makeRig();
    arm(rig);
    status(rig, "ON_TASK");
    serve(rig, 300);
    status(rig, "DISTRACTED");
    serve(rig, 60);
    disarm(rig);

    const out = rig.recorder.retractLastAwayDrift();
    expect(out.refusal).toBe("not-away");
    expect(ledgerRounds(rig.store)[0]?.driftsSec).toEqual([300]);
    expect(rig.log).toContain("round 1 — nothing retracted, not-away");
  });

  it("refuses `not-open` when the away episode had already ended", () => {
    const rig = makeRig();
    arm(rig);
    status(rig, "ON_TASK");
    serve(rig, 300);
    status(rig, "AWAY");
    serve(rig, 60);
    status(rig, "ON_TASK");
    serve(rig, 300);
    disarm(rig);

    expect(rig.recorder.retractLastAwayDrift().refusal).toBe("not-open");
    expect(ledgerRounds(rig.store)[0]?.driftsSec).toEqual([300]);
  });

  it("refuses `no-onset` on a round that never drifted", () => {
    const rig = makeRig();
    arm(rig);
    status(rig, "ON_TASK");
    serve(rig, 900);
    disarm(rig);

    expect(rig.recorder.retractLastAwayDrift().refusal).toBe("no-onset");
  });

  it("refuses `no-round` when nothing was left behind by a pause", () => {
    const rig = makeRig();
    const out = rig.recorder.retractLastAwayDrift();
    expect(out.refusal).toBe("no-round");
    expect(out.roundKey).toBeNull();
    // And it says nothing at all — there is no round to say it beside.
    expect(rig.log).toEqual([]);
  });

  it("refuses `plan-off` with the master switch off", () => {
    const rig = makeRig({ settings: { focusPlanEnabled: false } });
    pausedOnAway(rig);
    expect(rig.recorder.retractLastAwayDrift().refusal).toBe("plan-off");
  });

  it("refuses `pinned` under FOCUSPLUG_NO_PLAN=1 and writes nothing", () => {
    withPin(() => {
      const rig = makeRig();
      pausedOnAway(rig);
      expect(rig.recorder.retractLastAwayDrift().refusal).toBe("pinned");
      expect(rig.store?.writes).toEqual([]);
    });
  });

  it("survives a store that cannot be read, and still refuses rather than throws", () => {
    const rig = makeRig({
      store: {
        loadPlanLedger: () => {
          throw new Error("unreadable");
        },
        savePlanLedger: () => undefined,
      },
    });
    expect(() => rig.recorder.retractLastAwayDrift()).not.toThrow();
    expect(rig.recorder.retractLastAwayDrift().retracted).toBe(false);
  });

  it("still rewrites `carried` when nothing was persisted, so the resume is clean", () => {
    // No store at all: the round never reaches a ledger, but the resume still
    // must not resurrect the drift.
    const rig = makeRig({ store: null });
    pausedOnAway(rig);
    expect(rig.recorder.retractLastAwayDrift().retracted).toBe(true);

    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 600);
    disarm(rig);
    expect((rig.rounds[rig.rounds.length - 1] as PlanRound).driftsSec).toEqual([]);
  });
});
