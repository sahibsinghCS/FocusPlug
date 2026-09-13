import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import type { AppSettings } from "../../shared/ipc.ts";
import type { Decision } from "../../shared/types.ts";
import type { FocusPlanLedger, PlanRound, SessionPlanContext } from "../../shared/plan/types.ts";
import { recommend, selectWindow } from "../../shared/plan/index.ts";
import { ledgerOf, makeRound } from "../../shared/plan/fixtures.ts";
import { MutableClock } from "../session/harness.ts";
import {
  createFailingPlanStore,
  createMemoryPlanStore,
  hitEvent,
  nudgeEvent,
  riskSnapshot,
  sessionState,
  standDownEvent,
  type MemoryPlanStore,
} from "./harness.ts";
import { PLAN_PIN_ENV, PlanRecorder, type PlanLedgerStore } from "./recorder.ts";

interface Rig {
  clock: MutableClock;
  recorder: PlanRecorder;
  rounds: PlanRound[];
  log: string[];
  store: PlanLedgerStore | null;
}

function makeRig(init?: {
  settings?: Partial<AppSettings>;
  store?: PlanLedgerStore | null;
  loadSettingsThrows?: boolean;
  now?: () => number;
}): Rig {
  const clock = new MutableClock(1_700_000_000_000);
  const rounds: PlanRound[] = [];
  const log: string[] = [];
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...init?.settings };
  const store = init?.store === undefined ? createMemoryPlanStore() : init.store;
  const recorder = new PlanRecorder({
    loadSettings: () => {
      if (init?.loadSettingsThrows === true) {
        throw new Error("settings dependency exploded");
      }
      return settings;
    },
    appendLog: (detail) => log.push(detail),
    push: {
      round: (round) => rounds.push({ ...round, driftsSec: [...round.driftsSec] }),
    },
    store,
    now: init?.now ?? clock.now,
  });
  return { clock, recorder, rounds, log, store };
}

/**
 * A store that counts reads as well as writes. The filming pin claims the
 * ledger is never touched, and "never written" is only half of that.
 */
interface CountingPlanStore extends PlanLedgerStore {
  loads: number;
  writes: unknown[];
}

function countingPlanStore(seed: unknown): CountingPlanStore {
  const store: CountingPlanStore = {
    loads: 0,
    writes: [],
    loadPlanLedger: () => {
      store.loads += 1;
      return seed;
    },
    savePlanLedger: (next) => {
      store.writes.push(next);
    },
  };
  return store;
}

/** Run `body` with `FOCUSPLUG_NO_PLAN=1`, restoring whatever was there. */
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

/**
 * `PLAN_GET_STATE` pushed through the EXACT chain the renderer runs it
 * through — `usePlanRecommendation` gates on `state.enabled`, calls
 * `selectWindow` over `state.rounds`, and hands the result to `recommend`;
 * `PlanCard` renders `null` if and only if that returns null. Asserting the
 * rung here is what makes "the cards render `no-history`" a test rather than
 * a sentence in a doc.
 */
function cardFor(state: { enabled: boolean; rounds: PlanRound[] }, nowMs: number) {
  if (!state.enabled) {
    return null;
  }
  return recommend({
    rounds: selectWindow(state.rounds, { nowMs, includeDiscarded: true }),
    live: null,
    forecastEnabled: true,
    stretchEnabled: true,
  });
}

/** Twelve real rounds on disk — what a filmed demo must not be at the mercy of. */
function yesterdaysHistory(): FocusPlanLedger {
  return ledgerOf(
    Array.from({ length: 12 }, (_unused, index) =>
      makeRound({ day: index % 6, atMin: index * 40, driftMin: 18 + (index % 5) }),
    ),
  );
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

function arm(rig: Rig, ctx?: unknown): void {
  rig.recorder.declareRound(ctx);
  rig.recorder.onSessionState(sessionState(true));
}

function disarm(rig: Rig): void {
  rig.recorder.onSessionState(sessionState(false));
}

/** Serve `seconds` of focus at the controller's own republish cadence. */
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

function ledgerRounds(store: PlanLedgerStore | null): PlanRound[] {
  const raw = (store as MemoryPlanStore | null)?.current?.() ?? null;
  return raw === null ? [] : ((raw as FocusPlanLedger).rounds ?? []);
}

describe("PlanRecorder — one clean round", () => {
  it("records a completed, censored round with no drift", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);

    expect(rig.rounds).toHaveLength(1);
    const round = rig.rounds[0] as PlanRound;
    expect(round.status).toBe("completed");
    expect(round.firstDriftSec).toBeNull();
    expect(round.firstDriftType).toBeNull();
    expect(round.driftsSec).toEqual([]);
    expect(round.servedSec).toBe(1500);
    expect(round.roundKey).toBe("plan-0");
    expect(round.plannedFocusSec).toBe(1500);
    expect(round.recommendedFocusSec).toBe(1200);
    expect(round.acceptedRecommendation).toBe(true);
    expect(round.startedDrifted).toBe(false);
    expect(rig.log).toEqual(["round 1 — no drift in 25.0 min (censored, completed)"]);
  });
});

describe("PlanRecorder — the drift definition", () => {
  it("stamps the first drift in SERVED seconds and names its flavour", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 1140);
    status(rig, "DISTRACTED");
    serve(rig, 360);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.firstDriftSec).toBe(1140);
    expect(round.firstDriftType).toBe("tab_out");
    expect(round.status).toBe("completed");
    expect(rig.log[0]).toBe("round 1 — first drift at 19.0 min (planned 25)");
  });

  it("walking away is a drift too, and it is a different flavour", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 600);
    status(rig, "AWAY");
    serve(rig, 900);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.firstDriftSec).toBe(600);
    expect(round.firstDriftType).toBe("walk_away");
  });

  it("two onsets 20 s apart are one drift (DRIFT_DEBOUNCE_SEC), 31 s apart are two", () => {
    const merged = makeRig();
    arm(merged, context());
    status(merged, "ON_TASK");
    serve(merged, 600, 1);
    status(merged, "DISTRACTED");
    serve(merged, 5, 1);
    status(merged, "ON_TASK");
    serve(merged, 15, 1);
    status(merged, "DISTRACTED");
    serve(merged, 880, 5);
    disarm(merged);
    expect((merged.rounds[0] as PlanRound).driftsSec).toEqual([600]);

    const kept = makeRig();
    arm(kept, context());
    status(kept, "ON_TASK");
    serve(kept, 600, 1);
    status(kept, "DISTRACTED");
    serve(kept, 5, 1);
    status(kept, "ON_TASK");
    serve(kept, 26, 1);
    status(kept, "DISTRACTED");
    serve(kept, 869, 1);
    disarm(kept);
    expect((kept.rounds[0] as PlanRound).driftsSec).toEqual([600, 631]);
  });
});

describe("PlanRecorder — started drifted", () => {
  it("fires at 19 s and not at 21 s", () => {
    const early = makeRig();
    arm(early, context());
    serve(early, 19, 1);
    status(early, "DISTRACTED");
    serve(early, 1481);
    disarm(early);
    expect((early.rounds[0] as PlanRound).startedDrifted).toBe(true);
    expect(early.log[0]).toBe("round 1 — not counted, started with a blocked app already open");

    const late = makeRig();
    arm(late, context());
    serve(late, 21, 1);
    status(late, "DISTRACTED");
    serve(late, 1479);
    disarm(late);
    expect((late.rounds[0] as PlanRound).startedDrifted).toBe(false);
    expect((late.rounds[0] as PlanRound).firstDriftSec).toBe(21);
  });

  it("does not fire at 5 s when a clean, non-IDLE decision was seen first", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 5, 1);
    status(rig, "DISTRACTED");
    serve(rig, 1495);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.startedDrifted).toBe(false);
    expect(round.firstDriftSec).toBe(5);
  });
});

describe("PlanRecorder — pause and resume", () => {
  it("merges consecutive sessions sharing a roundKey into one round", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 300);
    disarm(rig);

    // The pause: ten minutes of wall clock that is not focus time.
    rig.clock.advance(600_000);

    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 400);
    status(rig, "DISTRACTED");
    serve(rig, 200);
    disarm(rig);

    // Two closes, two pushes — but ONE round in the ledger.
    expect(rig.rounds).toHaveLength(2);
    const merged = rig.rounds[1] as PlanRound;
    expect(merged.roundKey).toBe("plan-0");
    expect(merged.servedSec).toBe(900);
    // Stamped in SERVED seconds: the ten-minute pause is not in the number.
    expect(merged.firstDriftSec).toBe(700);

    const stored = ledgerRounds(rig.store);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.servedSec).toBe(900);
    const ledger = (rig.store as MemoryPlanStore).current() as FocusPlanLedger;
    expect(ledger.lifetimeRounds).toBe(1);
  });

  it("a different roundKey is a different round", () => {
    const rig = makeRig();
    arm(rig, context({ roundKey: "plan-0", round: 1 }));
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);

    arm(rig, context({ roundKey: "plan-1", round: 2 }));
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);

    expect(ledgerRounds(rig.store)).toHaveLength(2);
    expect((rig.store as MemoryPlanStore).current()).toMatchObject({ lifetimeRounds: 2 });
  });
});

describe("PlanRecorder — the clock cannot be trusted", () => {
  it("clamps each tick gap, so a four-hour suspend adds five seconds", () => {
    const rig = makeRig();
    arm(rig, context({ plannedFocusSec: 600 }));
    status(rig, "ON_TASK");
    serve(rig, 300);
    rig.clock.advance(4 * 3_600_000);
    rig.recorder.onSessionState(sessionState(true));
    serve(rig, 300);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.servedSec).toBe(605);
    expect(round.status).toBe("completed");
  });

  it("a three-times over-run is discarded rather than believed", () => {
    const rig = makeRig();
    arm(rig, context({ plannedFocusSec: 300 }));
    status(rig, "ON_TASK");
    serve(rig, 1000);
    disarm(rig);

    expect((rig.rounds[0] as PlanRound).status).toBe("discarded");
  });
});

describe("PlanRecorder — what counts as a round", () => {
  it("a two-minute clean round is not a measurement", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 120);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.status).toBe("discarded");
    expect(rig.log[0]).toBe("round 1 — not counted, too short to count");
  });

  it("a two-minute round WITH a drift is real, informative data", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 60);
    status(rig, "DISTRACTED");
    serve(rig, 60);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.status).toBe("aborted");
    expect(round.firstDriftSec).toBe(60);
  });

  it("a start/stop that saw nothing at all is not recorded", () => {
    const rig = makeRig();
    arm(rig, context());
    disarm(rig);

    expect(rig.rounds).toEqual([]);
    expect(rig.log).toEqual([]);
    expect((rig.store as MemoryPlanStore).writes).toEqual([]);
  });
});

describe("PlanRecorder — the SESSION_START argument is untrusted", () => {
  it("a malformed payload costs the context, never the round and never a throw", () => {
    for (const bad of [undefined, null, "nope", 42, [], { roundKey: 7 }, { roundKey: "" }]) {
      const rig = makeRig();
      expect(() => arm(rig, bad)).not.toThrow();
      status(rig, "ON_TASK");
      serve(rig, 600);
      disarm(rig);

      const round = rig.rounds[0] as PlanRound;
      expect(round.plannedFocusSec).toBe(0);
      expect(round.round).toBe(1);
      expect(round.recommendedFocusSec).toBeNull();
      expect(round.acceptedRecommendation).toBe(false);
      expect(round.roundKey.startsWith("session-")).toBe(true);
      // With no declared plan there is no planned end to have reached.
      expect(round.status).toBe("aborted");
      expect(rig.log[0]).toBe("round 1 — no drift in 10.0 min (censored, aborted)");
    }
  });

  it("partial payloads keep the fields they got right", () => {
    const rig = makeRig();
    arm(rig, { roundKey: "  plan-9  ", round: 3.4, plannedFocusSec: -5, acceptedRecommendation: 1 });
    status(rig, "ON_TASK");
    serve(rig, 600);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.roundKey).toBe("plan-9");
    expect(round.round).toBe(3);
    expect(round.plannedFocusSec).toBe(0);
    expect(round.acceptedRecommendation).toBe(false);
  });
});

describe("PlanRecorder — the off switches", () => {
  it("focusPlanEnabled:false records nothing, writes nothing, pushes nothing", () => {
    const rig = makeRig({ settings: { focusPlanEnabled: false } });
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 1500);
    status(rig, "DISTRACTED");
    serve(rig, 60);
    disarm(rig);

    expect(rig.rounds).toEqual([]);
    expect(rig.log).toEqual([]);
    expect((rig.store as MemoryPlanStore).writes).toEqual([]);
    // `enabled:false` is what makes `PlanCard` and `DebriefCard` return null.
    // Contrast the pin below, which reports `enabled:true` on an empty window.
    expect(rig.recorder.getState().enabled).toBe(false);
    expect(rig.recorder.getState().rounds).toEqual([]);
    expect(cardFor(rig.recorder.getState(), rig.clock.now())).toBeNull();
  });

  /* The pin is NOT the master switch, and the difference is the whole point of
     it: `focusPlanEnabled:false` takes the cards away, `FOCUSPLUG_NO_PLAN=1`
     leaves them up on the cold-start rung. The three tests below pin that
     difference end to end, because a filming switch nobody checked is worse
     than no filming switch at all. */

  it("FOCUSPLUG_NO_PLAN=1 leaves the card up, rendering `no-history` over real history", () => {
    withPin(() => {
      const store = countingPlanStore(yesterdaysHistory());
      const rig = makeRig({ store });

      // Switched off would be `enabled:false`; pinned reports a fresh install.
      expect(rig.recorder.getState()).toEqual({
        v: 1,
        enabled: true,
        rounds: [],
        lifetimeRounds: 0,
      });
      // Not read, not just not written: the twelve rounds are still on disk.
      expect(store.loads).toBe(0);
      expect(store.writes).toEqual([]);
      expect((store.loadPlanLedger?.() as FocusPlanLedger).rounds).toHaveLength(12);

      const card = cardFor(rig.recorder.getState(), rig.clock.now());
      expect(card).not.toBeNull();
      expect(card?.cold).toBe(true);
      expect(card?.estimate.rung).toBe("no-history");
      expect(card?.estimate.refusal).toBe("no-rounds");
      expect(card?.copy.kicker).toBe("FOCUS PLAN · no history yet");
      expect(card?.copy.headline).toBe("Start with 25 minutes, then 5 off.");
    });
  });

  it("FOCUSPLUG_NO_PLAN=1 records nothing, pushes nothing and writes nothing", () => {
    withPin(() => {
      const store = countingPlanStore(yesterdaysHistory());
      const rig = makeRig({ store });
      arm(rig, context());
      status(rig, "ON_TASK");
      serve(rig, 1500);
      status(rig, "DISTRACTED");
      serve(rig, 60);
      disarm(rig);

      expect(rig.rounds).toEqual([]);
      expect(rig.log).toEqual([]);
      expect(store.writes).toEqual([]);
      expect(store.loads).toBe(0);
      // Still cold after a full round — that is what "deterministic" buys.
      expect(cardFor(rig.recorder.getState(), rig.clock.now())?.estimate.rung).toBe("no-history");
    });
  });

  it("FOCUSPLUG_NO_PLAN=1 will not clear the history it is hiding", () => {
    const seeded = yesterdaysHistory();
    const store = countingPlanStore(seeded);
    withPin(() => {
      const rig = makeRig({ store });
      // The Settings button is disabled at `lifetimeRounds: 0`, so this is the
      // channel called directly. No writes means no writes: a filming switch
      // must not be able to delete a student's history behind the pretence.
      expect(rig.recorder.reset()).toEqual({ v: 1, enabled: true, rounds: [], lifetimeRounds: 0 });
      expect(store.writes).toEqual([]);
      expect(rig.log).toEqual([]);
    });
    // Unpinned, the same store shows the twelve rounds again.
    expect(makeRig({ store }).recorder.getState()).toMatchObject({
      enabled: true,
      lifetimeRounds: 12,
    });
  });

  it("switching off still reports the history Settings offers to forget", () => {
    const seeded: FocusPlanLedger = {
      v: 1,
      lifetimeRounds: 37,
      rounds: [],
    };
    const rig = makeRig({
      settings: { focusPlanEnabled: false },
      store: createMemoryPlanStore(seeded),
    });
    expect(rig.recorder.getState()).toEqual({
      v: 1,
      enabled: false,
      rounds: [],
      lifetimeRounds: 37,
    });
  });
});

describe("PlanRecorder — failure containment", () => {
  it("a throwing savePlanLedger writes one plan · off line, and the round still pushes", () => {
    const rig = makeRig({ store: createFailingPlanStore("disk full") });
    arm(rig, context());
    status(rig, "ON_TASK");
    expect(() => {
      serve(rig, 1500);
      disarm(rig);
    }).not.toThrow();

    expect(rig.rounds).toHaveLength(1);
    expect(rig.log).toEqual([
      "round 1 — no drift in 25.0 min (censored, completed)",
      "off · disk full",
    ]);
  });

  it("the latch is per session: nothing more is recorded until the next arm", () => {
    const rig = makeRig({ store: createFailingPlanStore() });
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);
    const afterTrip = rig.log.length;

    // Same session, no declareRound: the latch holds and nothing else lands.
    rig.recorder.onSessionState(sessionState(true));
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);
    expect(rig.log).toHaveLength(afterTrip);

    // A new declareRound clears the latch, exactly as the forecast's does.
    arm(rig, context({ roundKey: "plan-2" }));
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);
    expect(rig.log.length).toBeGreaterThan(afterTrip);
  });

  it("a trip in the MIDDLE of a round does not swallow the next session's round", () => {
    // A genuine mid-round failure: the clock itself blows up while a round is
    // open, so the round's close never runs. The next arm has to recover.
    let boom = false;
    const clock = new MutableClock(1_700_000_000_000);
    const rig = makeRig({
      now: () => {
        if (boom) {
          throw new Error("clock exploded");
        }
        return clock.ms;
      },
    });
    rig.clock.advance = (ms: number) => {
      clock.ms += ms;
    };
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 60);
    boom = true;
    rig.recorder.onPolicyEvent({ type: "status", decision: "ON_TASK", detail: "still here" });
    expect(rig.log.at(-1)).toBe("off · clock exploded");
    // The close never lands: the latch is holding every handler off.
    disarm(rig);
    expect(rig.rounds).toEqual([]);

    boom = false;
    arm(rig, context({ roundKey: "plan-next", round: 2 }));
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);

    expect(rig.rounds).toHaveLength(1);
    expect(rig.rounds[0]?.roundKey).toBe("plan-next");
    expect(rig.rounds[0]?.servedSec).toBe(1500);
  });

  it("a latched session can still answer PLAN_GET_STATE and PLAN_RESET", () => {
    const rig = makeRig({ store: createFailingPlanStore() });
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);
    expect(rig.log.at(-1)?.startsWith("off · ")).toBe(true);

    // Settings must not tell the student their history is gone because one
    // write failed. The `plan · off` line is the disclosure.
    expect(rig.recorder.getState().enabled).toBe(true);
  });

  it("a corrupt ledger on disk starts empty instead of throwing into a session", () => {
    const rig = makeRig({ store: createMemoryPlanStore({ v: 99, rounds: "nope" }) });
    expect(rig.recorder.getState()).toEqual({
      v: 1,
      enabled: true,
      rounds: [],
      lifetimeRounds: 0,
    });
  });

  it("a throwing loadSettings latches Focus Plan off, and the taps stay silent", () => {
    const rig = makeRig({ loadSettingsThrows: true });
    expect(() => {
      arm(rig, context());
      status(rig, "ON_TASK");
      serve(rig, 1500);
      disarm(rig);
    }).not.toThrow();
    expect(rig.rounds).toEqual([]);
  });
});

describe("PlanRecorder — the forecast stream", () => {
  it("records the peak, the wobbles, the stand-downs and the lead", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 60);
    rig.recorder.onForecastSnapshot(riskSnapshot(rig.clock.ms, 0.41));
    serve(rig, 60);
    rig.recorder.onForecastEvent(nudgeEvent(rig.clock.ms));
    serve(rig, 60);
    rig.recorder.onForecastSnapshot(riskSnapshot(rig.clock.ms, 0.78));
    rig.recorder.onForecastEvent(standDownEvent(rig.clock.ms));
    serve(rig, 60);
    rig.recorder.onForecastSnapshot(riskSnapshot(rig.clock.ms, 0.22));
    rig.recorder.onForecastEvent(hitEvent(rig.clock.ms, 14));
    serve(rig, 1260);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.peakRisk).toBeCloseTo(0.78, 6);
    expect(round.peakRiskSec).toBe(180);
    expect(round.wobbles).toBe(1);
    expect(round.firstWobbleSec).toBe(120);
    expect(round.standDowns).toBe(1);
    expect(round.firstDriftLeadSec).toBe(14);
    expect(round.forecastOn).toBe(true);
  });

  it("a warming snapshot is not a peak, and a wobble is never a drift", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 60);
    rig.recorder.onForecastSnapshot(riskSnapshot(rig.clock.ms, 0.99, false));
    rig.recorder.onForecastEvent(nudgeEvent(rig.clock.ms, 0.62));
    serve(rig, 1440);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.peakRisk).toBeNull();
    expect(round.peakRiskSec).toBeNull();
    expect(round.wobbles).toBe(1);
    expect(round.firstDriftSec).toBeNull();
    expect(round.status).toBe("completed");
  });

  it("forecast off leaves no risk curve to report", () => {
    const rig = makeRig({ settings: { forecastEnabled: false } });
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.forecastOn).toBe(false);
    expect(round.peakRisk).toBeNull();
    expect(round.firstWobbleSec).toBeNull();
  });
});

describe("PlanRecorder — state and reset", () => {
  it("counts countdowns and kills without touching either", () => {
    const rig = makeRig();
    arm(rig, context());
    status(rig, "ON_TASK");
    serve(rig, 600);
    status(rig, "DISTRACTED");
    rig.recorder.onPolicyEvent({ type: "start_countdown", reason: "blocked_focus", seconds: 10 });
    serve(rig, 10, 1);
    rig.recorder.onPolicyEvent({ type: "kill", targets: ["discord"], reason: "blocked_focus" });
    serve(rig, 890);
    disarm(rig);

    const round = rig.rounds[0] as PlanRound;
    expect(round.countdowns).toBe(1);
    expect(round.kills).toBe(1);
  });

  it("PLAN_RESET empties the ledger and says how much it forgot", () => {
    const rig = makeRig();
    arm(rig, context({ roundKey: "plan-0" }));
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);
    arm(rig, context({ roundKey: "plan-1", round: 2 }));
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);

    expect(rig.recorder.getState()).toMatchObject({ enabled: true, lifetimeRounds: 2 });
    expect(rig.recorder.getState().rounds).toHaveLength(2);

    const after = rig.recorder.reset();
    expect(after).toEqual({ v: 1, enabled: true, rounds: [], lifetimeRounds: 0 });
    expect(rig.log.at(-1)).toBe("history cleared (2 rounds)");
    expect(ledgerRounds(rig.store)).toEqual([]);
  });

  it("the window keeps ineligible rounds visible so the evidence table reconciles", () => {
    const rig = makeRig();
    arm(rig, context({ roundKey: "plan-0" }));
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);
    arm(rig, context({ roundKey: "plan-1", round: 2 }));
    status(rig, "ON_TASK");
    serve(rig, 120);
    disarm(rig);

    const state = rig.recorder.getState();
    expect(state.rounds.map((round) => round.status)).toEqual(["completed", "discarded"]);
  });
});

/**
 * `npm run demo:seed` writes fabricated rounds into the real
 * `<userData>/focus-plan.json` so a plan card has something to say while a
 * demo is being filmed. On screen that card is indistinguishable from one
 * built out of real work — same headline, same evidence table — so the
 * disclosure has to come out of the app itself, not out of a README.
 */
describe("PlanRecorder — seeded history announces itself", () => {
  const STAMP = {
    source: "npm run demo:seed",
    writtenAt: 1_700_000_000_000,
    rounds: 3,
    note: "Fabricated demo history, written for filming.",
  };

  function seededLedger(): FocusPlanLedger {
    return {
      ...ledgerOf([
        makeRound({ day: 0, driftMin: 19 }),
        makeRound({ day: 1, driftMin: 22 }),
        makeRound({ day: 2, driftMin: 20 }),
      ]),
      seed: STAMP,
    };
  }

  function notices(log: readonly string[]): string[] {
    return log.filter((line) => line.startsWith("SEEDED DEMO HISTORY"));
  }

  it("prints the stamp into the session log the first time the ledger is read", () => {
    const rig = makeRig({ store: createMemoryPlanStore(seededLedger()) });
    expect(rig.log).toEqual([]);

    rig.recorder.getState();
    const printed = notices(rig.log);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("3 fabricated rounds");
    expect(printed[0]).toContain("npm run demo:seed");
    expect(printed[0]).toContain("npm run demo:unseed");
  });

  it("says it again for the round that arms on top of it, once per round", () => {
    const rig = makeRig({ store: createMemoryPlanStore(seededLedger()) });
    rig.recorder.getState();
    arm(rig, context({ roundKey: "plan-0" }));
    status(rig, "ON_TASK");
    serve(rig, 600);
    // A pause and a resume are two segments of ONE round, and one disclosure.
    disarm(rig);
    arm(rig, context({ roundKey: "plan-0" }));
    serve(rig, 900);
    disarm(rig);
    expect(notices(rig.log)).toHaveLength(2);
  });

  it("never writes a stamp of its own, and never drops the one it found", () => {
    const store = createMemoryPlanStore(seededLedger());
    const rig = makeRig({ store });
    arm(rig, context({ roundKey: "plan-0" }));
    status(rig, "ON_TASK");
    serve(rig, 1500);
    disarm(rig);

    const written = store.current() as FocusPlanLedger;
    expect(written.rounds).toHaveLength(4);
    expect(written.seed).toEqual(STAMP);

    // …and a ledger nobody seeded stays unstamped, whatever the recorder does.
    const clean = createMemoryPlanStore(null);
    const plain = makeRig({ store: clean });
    arm(plain, context({ roundKey: "plan-0" }));
    status(plain, "ON_TASK");
    serve(plain, 1500);
    disarm(plain);
    expect((clean.current() as FocusPlanLedger).seed).toBeUndefined();
    expect(notices(plain.log)).toEqual([]);
  });

  it("PLAN_RESET forgets the seed along with the rounds", () => {
    const store = createMemoryPlanStore(seededLedger());
    const rig = makeRig({ store });
    rig.recorder.reset();
    expect((store.current() as FocusPlanLedger).seed).toBeUndefined();
    expect((store.current() as FocusPlanLedger).rounds).toEqual([]);
  });

  it("the filming pin reads no ledger, so it has no seed to announce", () => {
    withPin(() => {
      const store = countingPlanStore(seededLedger());
      const rig = makeRig({ store });
      rig.recorder.getState();
      arm(rig, context({ roundKey: "plan-0" }));
      status(rig, "ON_TASK");
      serve(rig, 1500);
      disarm(rig);
      expect(store.loads).toBe(0);
      expect(notices(rig.log)).toEqual([]);
    });
  });
});
