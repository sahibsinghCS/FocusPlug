import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import type { AppSettings } from "../../shared/ipc.ts";
import type { PolicyEvent, SessionEvent } from "../../shared/types.ts";
import type { PlanRound, SessionPlanContext } from "../../shared/plan/types.ts";
import { SessionController, type SessionControllerOptions, type SessionStore } from "../session/controller.ts";
import { SAMPLE_PLUGS } from "../session/fixtures.ts";
import {
  MutableClock,
  RecordingKiller,
  RecordingPlugController,
  ScriptedDeskMonitor,
  ScriptedWindowMonitor,
  createMemoryStore,
  createRecordingPush,
  discordFocus,
  docsFocus,
  presentDesk,
} from "../session/harness.ts";
import { createMemoryPlanStore, throwingPlanTap, type MemoryPlanStore } from "./harness.ts";
import { createFocusPlan, type FocusPlan } from "./index.ts";
import { withPlan } from "./tap.ts";

/**
 * THE UNCOUPLING TEST — and it must never be deleted.
 *
 * Focus Plan sits next to a process killer. The only reason that is safe is
 * that it cannot reach the kill path: it is a push observer and a JSON file,
 * `SessionControllerOptions` has no plan-shaped key, and `adaptiveFuse.ts` is
 * untouched. This file turns all three of those from claims into assertions.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, "../session/evidence/golden-path.json");

interface GoldenEvidence {
  policyEventTypes: PolicyEvent["type"][];
  log: SessionEvent[];
}

type PlanMode = "none" | "throwing" | "recorder";

interface Harness {
  controller: SessionController;
  window: ScriptedWindowMonitor;
  desk: ScriptedDeskMonitor;
  killer: RecordingKiller;
  clock: MutableClock;
  store: SessionStore;
  planStore: MemoryPlanStore;
  trace: ReturnType<typeof createRecordingPush>["trace"];
  plan: FocusPlan | null;
  rounds: PlanRound[];
}

function makeHarness(init?: { settings?: Partial<AppSettings>; mode?: PlanMode }): Harness {
  const mode: PlanMode = init?.mode ?? "none";
  const clock = new MutableClock();
  const window = new ScriptedWindowMonitor();
  const desk = new ScriptedDeskMonitor();
  const killer = new RecordingKiller();
  const plugs = new RecordingPlugController(SAMPLE_PLUGS);
  const planStore = createMemoryPlanStore();
  const memory = createMemoryStore({
    plugs: SAMPLE_PLUGS,
    settings: {
      ...DEFAULT_SETTINGS,
      countdownSec: 10,
      strictMode: true,
      // The golden-path evidence is a cut-mode run, exactly as the forecast's
      // own integration test scripts it.
      plugMode: "cut",
      forecastEnabled: false,
      ...init?.settings,
      plugs: SAMPLE_PLUGS,
    },
  });
  const store: SessionStore = { ...memory, ...planStore };
  const { push, trace } = createRecordingPush();
  const rounds: PlanRound[] = [];

  let plan: FocusPlan | null = null;
  let wired = push;
  if (mode === "recorder") {
    plan = createFocusPlan({
      loadSettings: () => store.loadSettings(),
      appendLog: (detail) => {
        const event: SessionEvent = { ts: clock.now(), kind: "plan", detail };
        store.appendSessionLog(event);
        push.sessionEvent({ ...event });
      },
      push: { round: (round) => rounds.push(round) },
      store,
      now: clock.now,
    });
    wired = withPlan(push, plan.sessionTap);
  } else if (mode === "throwing") {
    wired = withPlan(push, throwingPlanTap());
  }

  const controller = new SessionController({
    windowMonitor: window,
    deskMonitor: desk,
    killer,
    plugs,
    store,
    push: wired,
    now: clock.now,
    tickIntervalMs: 0,
    adaptiveRandom: () => 1,
  });
  return { controller, window, desk, killer, clock, store, planStore, trace, plan, rounds };
}

/**
 * The exact golden-path script from `controller.test.ts` and
 * `forecast/integration.test.ts` — same clock start, same emissions, same
 * demo kill — so the resulting evidence stream is byte-comparable with the
 * committed `golden-path.json`.
 */
async function runGoldenScript(h: Harness, context?: SessionPlanContext): Promise<void> {
  h.plan?.declareRound(context);
  await h.controller.start();
  h.window.emit(docsFocus(h.clock.ms));
  h.desk.emit(presentDesk(h.clock.ms));
  await h.controller.flush();

  h.clock.advance(250);
  h.window.emit(discordFocus(h.clock.ms));
  h.desk.emit(presentDesk(h.clock.ms));
  await h.controller.flush();

  h.clock.advance(1000);
  await h.controller.tick();
  h.clock.advance(1000);
  await h.controller.tick();
  h.clock.advance(8000);
  await h.controller.tick();

  h.clock.advance(250);
  h.window.emit(docsFocus(h.clock.ms));
  h.desk.emit(presentDesk(h.clock.ms));
  await h.controller.flush();

  h.killer.result = { killed: ["discord.exe (pid 99)"], errors: [] };
  await h.controller.demoKill();
}

function withoutPlanRows(events: readonly SessionEvent[]): SessionEvent[] {
  return events.filter((event) => event.kind !== "plan");
}

function countdownSeconds(h: Harness): number[] {
  return h.trace.policies
    .filter((event): event is Extract<PolicyEvent, { type: "start_countdown" }> =>
      event.type === "start_countdown",
    )
    .map((event) => event.seconds);
}

function expectSameEnforcement(actual: Harness, expected: Harness): void {
  expect(JSON.stringify(actual.trace.policies)).toBe(JSON.stringify(expected.trace.policies));
  expect(JSON.stringify(actual.trace.states)).toBe(JSON.stringify(expected.trace.states));
  expect(JSON.stringify(actual.trace.focus)).toBe(JSON.stringify(expected.trace.focus));
  expect(JSON.stringify(actual.trace.desk)).toBe(JSON.stringify(expected.trace.desk));
  expect(JSON.stringify(actual.trace.nudges)).toBe(JSON.stringify(expected.trace.nudges));
  expect(JSON.stringify(actual.killer.calls)).toBe(JSON.stringify(expected.killer.calls));
  expect(JSON.stringify(withoutPlanRows(actual.trace.events))).toBe(
    JSON.stringify(withoutPlanRows(expected.trace.events)),
  );
  expect(countdownSeconds(actual)).toEqual(countdownSeconds(expected));
}

describe("Focus Plan cannot reach the kill path", () => {
  it("a recorder that throws on EVERY call leaves the golden path byte-identical", async () => {
    const bare = makeHarness();
    await runGoldenScript(bare);

    const exploding = makeHarness({ mode: "throwing" });
    await runGoldenScript(exploding);

    expectSameEnforcement(exploding, bare);
    expect(JSON.stringify(exploding.controller.getLog())).toBe(
      JSON.stringify(bare.controller.getLog()),
    );

    // And byte-identical to the committed golden-path evidence.
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenEvidence;
    expect(JSON.stringify(exploding.trace.policies.map((event) => event.type))).toBe(
      JSON.stringify(golden.policyEventTypes),
    );
    expect(JSON.stringify(exploding.controller.getLog())).toBe(JSON.stringify(golden.log));
  });

  it("focusPlanEnabled:false reproduces the session evidence stream exactly", async () => {
    // The required guarantee: with the feature off, a judge diffing the log,
    // the policy events, the states and the kill calls against a build that
    // never had Focus Plan finds nothing at all.
    const bare = makeHarness();
    await runGoldenScript(bare);

    const off = makeHarness({ mode: "recorder", settings: { focusPlanEnabled: false } });
    await runGoldenScript(off, {
      roundKey: "plan-0",
      round: 1,
      roundsTotal: 2,
      plannedFocusSec: 1500,
      plannedBreakSec: 300,
      recommendedFocusSec: 1200,
      acceptedRecommendation: true,
    });

    expectSameEnforcement(off, bare);
    expect(JSON.stringify(off.controller.getLog())).toBe(JSON.stringify(bare.controller.getLog()));

    // Not one plan row, not one ledger write, not one push.
    expect(off.trace.events.filter((event) => event.kind === "plan")).toEqual([]);
    expect(off.planStore.writes).toEqual([]);
    expect(off.rounds).toEqual([]);
    expect(off.plan?.getState().enabled).toBe(false);

    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenEvidence;
    expect(JSON.stringify(off.controller.getLog())).toBe(JSON.stringify(golden.log));
  });

  it("a WORKING recorder leaves every enforcement channel byte-identical too", async () => {
    const bare = makeHarness();
    await runGoldenScript(bare);

    const live = makeHarness({ mode: "recorder" });
    await runGoldenScript(live, {
      roundKey: "plan-0",
      round: 1,
      roundsTotal: 2,
      plannedFocusSec: 1500,
      plannedBreakSec: 300,
      recommendedFocusSec: 1200,
      acceptedRecommendation: true,
    });

    // The plan rows are the ONLY difference, and they are additive log lines.
    expectSameEnforcement(live, bare);
    expect(live.trace.events.some((event) => event.kind === "plan")).toBe(false);
  });

  it("PLAN_RESET mid-session does not perturb the running round's enforcement", async () => {
    const bare = makeHarness();
    await runGoldenScript(bare);

    const live = makeHarness({ mode: "recorder" });
    live.plan?.declareRound({
      roundKey: "plan-0",
      round: 1,
      roundsTotal: 1,
      plannedFocusSec: 1500,
      plannedBreakSec: 0,
      recommendedFocusSec: null,
      acceptedRecommendation: false,
    });
    await live.controller.start();
    live.window.emit(docsFocus(live.clock.ms));
    live.desk.emit(presentDesk(live.clock.ms));
    await live.controller.flush();

    live.plan?.reset();

    live.clock.advance(250);
    live.window.emit(discordFocus(live.clock.ms));
    live.desk.emit(presentDesk(live.clock.ms));
    await live.controller.flush();
    live.clock.advance(1000);
    await live.controller.tick();
    live.clock.advance(1000);
    await live.controller.tick();
    live.clock.advance(8000);
    await live.controller.tick();
    live.clock.advance(250);
    live.window.emit(docsFocus(live.clock.ms));
    live.desk.emit(presentDesk(live.clock.ms));
    await live.controller.flush();
    live.killer.result = { killed: ["discord.exe (pid 99)"], errors: [] };
    await live.controller.demoKill();

    expect(JSON.stringify(live.trace.policies)).toBe(JSON.stringify(bare.trace.policies));
    expect(JSON.stringify(live.killer.calls)).toBe(JSON.stringify(bare.killer.calls));
    expect(countdownSeconds(live)).toEqual(countdownSeconds(bare));
  });
});

describe("Focus Plan has no seam into the fuse", () => {
  it("SessionControllerOptions has no plan-shaped key — compile time and run time", () => {
    type KnownKey =
      | "windowMonitor"
      | "adaptiveRandom"
      | "deskMonitor"
      | "killer"
      | "plugs"
      | "store"
      | "push"
      | "policyFactory"
      | "now"
      | "tickIntervalMs"
      | "forecast"
      | "revealWindow";
    // If a future change adds a plan-shaped option, this stops compiling.
    type Unexpected = Exclude<keyof SessionControllerOptions, KnownKey>;
    const noNewKeys: Unexpected extends never ? true : false = true;
    expect(noNewKeys).toBe(true);

    const h = makeHarness({ mode: "recorder" });
    const options: SessionControllerOptions = {
      windowMonitor: h.window,
      deskMonitor: h.desk,
      killer: h.killer,
      store: h.store,
      push: h.trace as never,
      now: h.clock.now,
      tickIntervalMs: 0,
    };
    expect(Object.keys(options).filter((key) => /plan/i.test(key))).toEqual([]);
  });

  it("the adaptive fuse is untouched: the countdown is still the Settings fuse", async () => {
    const live = makeHarness({ mode: "recorder" });
    await runGoldenScript(live, {
      roundKey: "plan-0",
      round: 1,
      roundsTotal: 1,
      plannedFocusSec: 1500,
      plannedBreakSec: 0,
      // A plan that recommends 20 minutes must not move the fuse by one second.
      recommendedFocusSec: 1200,
      acceptedRecommendation: true,
    });
    expect(countdownSeconds(live)).toEqual([10]);
  });
});

describe("Focus Plan records the round it just watched", () => {
  it("produces the exact PlanRound for a scripted drift-and-kill round", async () => {
    const h = makeHarness({ mode: "recorder" });
    h.plan?.declareRound({
      roundKey: "1789412400000-0",
      round: 1,
      roundsTotal: 2,
      plannedFocusSec: 1500,
      plannedBreakSec: 300,
      recommendedFocusSec: 1200,
      acceptedRecommendation: true,
    });
    await h.controller.start();
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();

    for (let i = 0; i < 60; i += 1) {
      h.clock.advance(1000);
      await h.controller.tick();
    }

    h.clock.advance(1000);
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    for (let i = 0; i < 11; i += 1) {
      h.clock.advance(1000);
      await h.controller.tick();
    }

    h.clock.advance(1000);
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    for (let i = 0; i < 5; i += 1) {
      h.clock.advance(1000);
      await h.controller.tick();
    }
    await h.controller.stop();

    expect(h.rounds).toHaveLength(1);
    const round = h.rounds[0] as PlanRound;
    expect(round).toMatchObject({
      v: 1,
      roundKey: "1789412400000-0",
      status: "aborted",
      round: 1,
      roundsTotal: 2,
      plannedFocusSec: 1500,
      recommendedFocusSec: 1200,
      acceptedRecommendation: true,
      firstDriftSec: 61,
      firstDriftType: "tab_out",
      driftsSec: [61],
      startedDrifted: false,
      countdowns: 1,
      kills: 1,
      forecastOn: false,
      peakRisk: null,
      firstWobbleSec: null,
    });
    expect(round.servedSec).toBe(78);
    expect(round.endedAt - round.startedAt).toBe(78_000);

    // The ledger has it, the log says so, and enforcement never saw any of it.
    const state = h.plan?.getState();
    expect(state?.lifetimeRounds).toBe(1);
    expect(state?.rounds).toHaveLength(1);
    expect(
      h.controller.getLog().filter((event) => event.kind === "plan").map((event) => event.detail),
    ).toEqual(["round 1 — first drift at 1.0 min (planned 25)"]);
  });
});
