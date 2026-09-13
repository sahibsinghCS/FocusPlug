import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import type { AppSettings } from "../../shared/ipc.ts";
import type { FocusSnapshot, PolicyEvent, SessionEvent } from "../../shared/types.ts";
import type {
  ForecastEvent,
  ForecastHook,
  ForecastSnapshot,
} from "../../shared/forecast/index.ts";
import { AdaptiveFuse } from "../session/adaptiveFuse.ts";
import { SessionController } from "../session/controller.ts";
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
import { codeFocus, switchProbeWeights } from "./fixtures.ts";
import { createForecast, withForecast, type Forecast } from "./index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, "../session/evidence/golden-path.json");

interface GoldenEvidence {
  policyEventTypes: PolicyEvent["type"][];
  log: SessionEvent[];
}

interface Harness {
  controller: SessionController;
  window: ScriptedWindowMonitor;
  desk: ScriptedDeskMonitor;
  killer: RecordingKiller;
  plugs: RecordingPlugController;
  clock: MutableClock;
  store: ReturnType<typeof createMemoryStore>;
  trace: ReturnType<typeof createRecordingPush>["trace"];
  /** Forecast fan-out — empty arrays when the forecast is not attached. */
  fxSnapshots: ForecastSnapshot[];
  fxEvents: ForecastEvent[];
  forecast: Forecast | null;
  churnToggle: boolean;
}

function makeHarness(init?: {
  settings?: Partial<AppSettings>;
  /** Attach the forecast tap + hook (default true). */
  attach?: boolean;
  /** Simulate a broken forecast dependency — its loadSettings throws. */
  throwForecastSettings?: boolean;
  /**
   * Use the SHIPPED weights.json instead of the switch-probe fixture, so the
   * regression tests can pin the artifact judges actually run.
   */
  bundledWeights?: boolean;
  /** Replace the hook handed to the controller — used to break its contract. */
  hook?: ForecastHook;
  /**
   * Exploration draw for the adaptive fuse. Defaults to `1` — above every
   * rate, so the personalised fuse is the greedy one and these tests measure
   * the composition rather than a random probe.
   */
  adaptiveRandom?: () => number;
  /** Spy on the adaptive model's writes — the learning-signal guard uses it. */
  onSaveAdaptiveModel?: (value: unknown) => void;
}): Harness {
  const clock = new MutableClock();
  const window = new ScriptedWindowMonitor();
  const desk = new ScriptedDeskMonitor();
  const killer = new RecordingKiller();
  const plugs = new RecordingPlugController(SAMPLE_PLUGS);
  const memory = createMemoryStore({
    plugs: SAMPLE_PLUGS,
    settings: {
      ...DEFAULT_SETTINGS,
      countdownSec: 10,
      strictMode: true,
      // The golden-path evidence is a cut-mode run (plugs off at the kill,
      // back on at the unlock); the nudge-mode lamp is a different script.
      plugMode: "cut",
      ...init?.settings,
      plugs: SAMPLE_PLUGS,
    },
  });
  const save = init?.onSaveAdaptiveModel;
  const store = save === undefined ? memory : { ...memory, saveAdaptiveModel: save };
  const { push, trace } = createRecordingPush();
  const fxSnapshots: ForecastSnapshot[] = [];
  const fxEvents: ForecastEvent[] = [];
  const attach = init?.attach ?? true;
  let forecast: Forecast | null = null;
  if (attach) {
    forecast = createForecast({
      loadSettings: () => {
        if (init?.throwForecastSettings) {
          throw new Error("forecast settings dependency exploded");
        }
        return store.loadSettings();
      },
      appendLog: (detail) => {
        const event: SessionEvent = { ts: clock.now(), kind: "forecast", detail };
        store.appendSessionLog(event);
        push.sessionEvent({ ...event });
      },
      push: {
        snapshot: (snap) => fxSnapshots.push(snap),
        event: (event) => fxEvents.push(event),
      },
      ...(init?.bundledWeights === true ? {} : { weights: switchProbeWeights() }),
    });
  }
  const controller = new SessionController({
    windowMonitor: window,
    deskMonitor: desk,
    killer,
    plugs,
    store,
    push: forecast === null ? push : withForecast(push, forecast.monitor),
    now: clock.now,
    tickIntervalMs: 0,
    adaptiveRandom: init?.adaptiveRandom ?? (() => 1),
    ...(init?.hook !== undefined
      ? { forecast: init.hook }
      : forecast === null
        ? {}
        : { forecast: forecast.hook }),
  });
  return {
    controller,
    window,
    desk,
    killer,
    plugs,
    clock,
    store,
    trace,
    fxSnapshots,
    fxEvents,
    forecast,
    churnToggle: false,
  };
}

function policyTypes(h: Harness): PolicyEvent["type"][] {
  return h.trace.policies.map((event) => event.type);
}

function fxTypes(h: Harness): string[] {
  return h.fxEvents.map((event) => event.type);
}

async function tickSeconds(h: Harness, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i += 1) {
    h.clock.advance(1000);
    await h.controller.tick();
  }
}

async function tickUntil(
  h: Harness,
  predicate: () => boolean,
  maxSeconds: number,
  perSecond?: () => void,
): Promise<void> {
  for (let i = 0; i < maxSeconds; i += 1) {
    if (predicate()) {
      return;
    }
    perSecond?.();
    h.clock.advance(1000);
    await h.controller.tick();
  }
  expect(predicate()).toBe(true);
}

/** One alt-tab between two allowlisted apps — churn without any violation. */
function flip(h: Harness, advanceMs = 50): void {
  h.clock.advance(advanceMs);
  h.churnToggle = !h.churnToggle;
  const snap: FocusSnapshot = h.churnToggle ? codeFocus(h.clock.ms) : docsFocus(h.clock.ms);
  h.window.emit(snap);
}

async function startOnTask(h: Harness): Promise<void> {
  await h.controller.start();
  h.window.emit(docsFocus(h.clock.ms));
  h.desk.emit(presentDesk(h.clock.ms));
  await h.controller.flush();
}

/** Warm up calm, churn to nudge, then to pre-arm. Returns the pre-arm event. */
async function rampToPrearm(h: Harness): Promise<Extract<ForecastEvent, { type: "forecast_prearm" }>> {
  await startOnTask(h);
  await tickSeconds(h, 16); // 15 s warm-up + one ready frame, all calm
  for (let i = 0; i < 8; i += 1) {
    flip(h);
  }
  await h.controller.flush();
  await tickUntil(h, () => fxTypes(h).includes("forecast_prearm"), 15, () => {
    flip(h);
    flip(h);
  });
  const prearm = h.fxEvents.find((event) => event.type === "forecast_prearm");
  if (prearm === undefined || prearm.type !== "forecast_prearm") {
    throw new Error("pre-arm never fired");
  }
  return prearm;
}

/**
 * The exact golden-path script from controller.test.ts (same clock start,
 * same emissions, same demo kill) so the resulting evidence stream is
 * byte-comparable with the committed golden-path.json.
 */
async function runGoldenScript(h: Harness): Promise<void> {
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

describe("forecast disabled == committed golden path (byte-identical)", () => {
  it("forecastEnabled:false replays golden-path.json event-for-event, byte-for-byte", async () => {
    const bare = makeHarness({ attach: false });
    await runGoldenScript(bare);

    const attached = makeHarness({ settings: { forecastEnabled: false } });
    await runGoldenScript(attached);

    // The attached-but-disabled run is byte-identical to the bare run on
    // every push channel the session emits.
    expect(JSON.stringify(attached.trace.policies)).toBe(JSON.stringify(bare.trace.policies));
    expect(JSON.stringify(attached.trace.events)).toBe(JSON.stringify(bare.trace.events));
    expect(JSON.stringify(attached.trace.states)).toBe(JSON.stringify(bare.trace.states));
    expect(JSON.stringify(attached.controller.getLog())).toBe(
      JSON.stringify(bare.controller.getLog()),
    );

    // And byte-identical to the committed golden-path evidence.
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenEvidence;
    expect(JSON.stringify(policyTypes(attached))).toBe(JSON.stringify(golden.policyEventTypes));
    expect(JSON.stringify(attached.controller.getLog())).toBe(JSON.stringify(golden.log));

    // The forecast produced nothing at all.
    expect(attached.fxSnapshots).toEqual([]);
    expect(attached.fxEvents).toEqual([]);
  });

  it("enabled but below thresholds is still event-for-event identical", async () => {
    const bare = makeHarness({ attach: false });
    await runGoldenScript(bare);

    const attached = makeHarness(); // forecastEnabled: true (default)
    await runGoldenScript(attached);

    expect(JSON.stringify(attached.trace.policies)).toBe(JSON.stringify(bare.trace.policies));
    expect(JSON.stringify(attached.controller.getLog())).toBe(
      JSON.stringify(bare.controller.getLog()),
    );
    // Advisory only: snapshots flowed, but no escalation event and no override.
    expect(attached.fxEvents).toEqual([]);
    const countdown = attached.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(10);
  });

  it("the SHIPPED weights.json leaves the golden path byte-identical", async () => {
    // The sibling cases run the switch-probe fixture, which is wired so only
    // switch15 moves. This one runs src/shared/forecast/weights.json — the
    // artifact a judge downloads — so "swapping the model cannot move the
    // enforcement path" is a tested claim about the shipped head, not a
    // synthetic one. Re-run it after every trainer round.
    const bare = makeHarness({ attach: false });
    await runGoldenScript(bare);

    const shipped = makeHarness({ bundledWeights: true });
    await runGoldenScript(shipped);

    expect(JSON.stringify(shipped.trace.policies)).toBe(JSON.stringify(bare.trace.policies));
    expect(JSON.stringify(shipped.trace.events)).toBe(JSON.stringify(bare.trace.events));
    expect(JSON.stringify(shipped.controller.getLog())).toBe(
      JSON.stringify(bare.controller.getLog()),
    );

    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenEvidence;
    expect(JSON.stringify(policyTypes(shipped))).toBe(JSON.stringify(golden.policyEventTypes));

    // No escalation on this stream, and the fuse is the settings fuse.
    expect(shipped.fxEvents).toEqual([]);
    const countdown = shipped.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(10);
  });

  it("a hook that BREAKS the never-throw contract still cannot stop enforcement", async () => {
    // ForecastMonitor.beforeStep wraps everything in guard(), so this is not
    // reachable today — that is the point. The controller catches around the
    // call site, so the property belongs to the enforcement core and survives
    // any future ForecastHook, not just the current observer.
    const bare = makeHarness({ attach: false });
    await runGoldenScript(bare);

    const hostile = makeHarness({
      attach: false,
      hook: {
        beforeStep: () => {
          throw new Error("hook exploded");
        },
      },
    });
    await runGoldenScript(hostile);

    expect(JSON.stringify(hostile.trace.policies)).toBe(JSON.stringify(bare.trace.policies));
    expect(JSON.stringify(hostile.controller.getLog())).toBe(
      JSON.stringify(bare.controller.getLog()),
    );
    expect(hostile.killer.calls.length).toBe(bare.killer.calls.length);
    expect(hostile.killer.calls.length).toBeGreaterThan(0);
  });

  it("the ADAPTIVE half of the never-throw contract holds too", async () => {
    // The symmetric partner of the test above. `resolveFuse` wraps BOTH models
    // in one try, and the forecast hook is only one of them — `AdaptiveFuse`
    // is constructed inside the controller and `fuseFor` is called on the same
    // kill path with no guard of its own. Until now only the hook was driven
    // into a throw, so the half of the contract that covers `main`'s model was
    // asserted by reading the `try` rather than by running it.
    const bare = makeHarness({ attach: false });
    await runGoldenScript(bare);

    const spy = vi.spyOn(AdaptiveFuse.prototype, "fuseFor").mockImplementation(() => {
      throw new Error("adaptive fuse exploded");
    });
    let hostile: Harness;
    try {
      hostile = makeHarness({ attach: false });
      await runGoldenScript(hostile); // completing at all proves nothing propagated
    } finally {
      spy.mockRestore();
    }

    // Enforcement is untouched: same events, same fuse, same kill.
    expect(JSON.stringify(hostile.trace.policies)).toBe(JSON.stringify(bare.trace.policies));
    expect(hostile.killer.calls.length).toBe(bare.killer.calls.length);
    expect(hostile.killer.calls.length).toBeGreaterThan(0);
    const countdown = hostile.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(10);

    // The ONE thing that legitimately differs: a `fuseFor` that throws never
    // records the pending DriftMoment, so `armed()` has nothing to freeze and
    // the run learns nothing. The enforcement narrative is otherwise identical.
    const enforcement = (h: Harness): string =>
      JSON.stringify(h.controller.getLog().filter((event) => event.kind !== "adapt"));
    expect(enforcement(hostile)).toBe(enforcement(bare));
    expect(hostile.controller.getLog().some((event) => event.kind === "adapt")).toBe(false);
    expect(bare.controller.getLog().some((event) => event.kind === "adapt")).toBe(true);
  });

  it("a throwing forecast never perturbs the PolicyEvent stream or kill timing", async () => {
    const bare = makeHarness({ attach: false });
    await runGoldenScript(bare);

    const broken = makeHarness({ throwForecastSettings: true });
    await runGoldenScript(broken); // completing at all proves nothing propagated

    expect(JSON.stringify(broken.trace.policies)).toBe(JSON.stringify(bare.trace.policies));
    expect(broken.killer.calls.length).toBe(bare.killer.calls.length);
    // Exactly one forecast log line: the off latch.
    const forecastLines = broken.controller
      .getLog()
      .filter((event) => event.kind === "forecast");
    expect(forecastLines.length).toBe(1);
    expect(forecastLines[0]?.detail.startsWith("off ·")).toBe(true);
  });
});

describe("full escalation arc", () => {
  it("calm → churn → nudge → pre-arm (10s→5s) → blocked focus → kill ~5 s later with hit receipt", async () => {
    const h = makeHarness();
    await startOnTask(h);

    // Calm through warm-up: needle low, nothing escalates.
    await tickSeconds(h, 16);
    expect(h.fxEvents).toEqual([]);
    const calm = h.forecast?.getSnapshot() ?? null;
    expect(calm?.ready).toBe(true);
    expect(calm?.band).toBe("calm");
    expect(calm?.risk ?? 1).toBeLessThan(0.3);
    expect(calm?.effectiveFuseSec).toBe(10);

    // Medium churn: three quick allow↔allow switches, then hold.
    for (let i = 0; i < 3; i += 1) {
      flip(h);
    }
    await h.controller.flush();
    await tickUntil(h, () => fxTypes(h).includes("forecast_nudge"), 10);
    expect(fxTypes(h)).not.toContain("forecast_prearm");
    const nudge = h.fxEvents.find((event) => event.type === "forecast_nudge");
    expect(nudge?.type === "forecast_nudge" && nudge.topFeatures).toContain("switch15");
    expect(h.forecast?.getSnapshot()?.band).toBe("elevated");

    // Heavy churn: the pre-arm band, fuse chip flips 10s → 5s.
    for (let i = 0; i < 8; i += 1) {
      flip(h);
    }
    await h.controller.flush();
    await tickUntil(h, () => fxTypes(h).includes("forecast_prearm"), 10, () => {
      flip(h);
      flip(h);
    });
    const prearm = h.fxEvents.find((event) => event.type === "forecast_prearm");
    expect(prearm?.type === "forecast_prearm" && prearm.fuseSec).toBe(5);
    const armed = h.forecast?.getSnapshot() ?? null;
    expect(armed?.band).toBe("prearm");
    expect(armed?.prearmedAt).not.toBe(null);
    expect(armed?.effectiveFuseSec).toBe(5);
    expect(armed?.baseFuseSec).toBe(10);

    // Pure observer: high risk alone starts nothing — a kill still requires
    // a real, deterministically classified violation.
    expect(policyTypes(h)).not.toContain("start_countdown");
    expect(policyTypes(h)).not.toContain("kill");
    expect(h.killer.calls.length).toBe(0);

    // The violation. The unchanged policy classifies it; the fuse is 5 s.
    const prearmedAt = armed?.prearmedAt ?? 0;
    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    await h.controller.flush();
    const violationAt = h.clock.ms;
    const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(5);

    // The receipt: pre-armed before the fuse, with honest lead seconds.
    const hit = h.fxEvents.find((event) => event.type === "forecast_hit");
    expect(hit?.type).toBe("forecast_hit");
    if (hit?.type === "forecast_hit") {
      expect(hit.leadSec).toBeGreaterThan(0);
      expect(hit.leadSec).toBeCloseTo((violationAt - prearmedAt) / 1000, 5);
    }
    expect(
      h.controller.getLog().some((event) => event.kind === "forecast" && event.detail.startsWith("hit · called")),
    ).toBe(true);

    // Kill fires ~5 s later — not at the base 10 s.
    await tickSeconds(h, 4);
    expect(h.killer.calls.length).toBe(0);
    await tickSeconds(h, 1);
    expect(h.killer.calls.length).toBe(1);
    expect(policyTypes(h)).toContain("kill");
  });

  it("miss arc: an unforecast drift prints a loud forecast_miss", async () => {
    const h = makeHarness();
    await startOnTask(h);
    await tickSeconds(h, 20); // ready and calm — no churn precursors at all

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    await h.controller.flush();

    const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(10);
    expect(fxTypes(h)).toContain("forecast_miss");
    expect(fxTypes(h)).not.toContain("forecast_hit");
    expect(
      h.controller.getLog().some((event) => event.kind === "forecast" && event.detail === "miss — no warning"),
    ).toBe(true);
  });

  it("forecastPrearmEnabled:false is nudge-only: fuse stays 10", async () => {
    const h = makeHarness({ settings: { forecastPrearmEnabled: false } });
    await startOnTask(h);
    await tickSeconds(h, 16);
    for (let i = 0; i < 8; i += 1) {
      flip(h);
    }
    await h.controller.flush();
    await tickUntil(h, () => fxTypes(h).includes("forecast_nudge"), 10, () => {
      flip(h);
      flip(h);
    });
    // Keep the risk pegged: still no pre-arm, ever.
    for (let i = 0; i < 8; i += 1) {
      flip(h);
      flip(h);
      await tickSeconds(h, 1);
    }
    expect(fxTypes(h)).not.toContain("forecast_prearm");
    const snap = h.forecast?.getSnapshot() ?? null;
    expect(snap?.band).toBe("elevated");
    expect(snap?.effectiveFuseSec).toBe(10);

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    await h.controller.flush();
    const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(10);
    expect(fxTypes(h)).toContain("forecast_miss"); // never pre-armed ⇒ miss
  });
});

describe("the latch rule — a burning fuse never changes duration mid-burn", () => {
  it("risk collapse and a settings change mid-burn cannot stretch the 5 s fuse", async () => {
    const h = makeHarness();
    await rampToPrearm(h);

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    await h.controller.flush();
    const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(5);

    // Mid-burn: no more churn (risk will collapse) AND the user lengthens
    // countdownSec. The latched fuse must not move.
    await tickSeconds(h, 1);
    h.controller.setSettings({ countdownSec: 600 });
    await h.controller.flush();
    expect(h.controller.getState().countdownSec).toBeLessThanOrEqual(4);

    await tickSeconds(h, 3); // 4-and-a-bit seconds elapsed — still burning
    expect(h.killer.calls.length).toBe(0);
    await tickSeconds(h, 1); // 5 s: the latched fuse fires
    expect(h.killer.calls.length).toBe(1);
  });

  it("stand-down is loud and a later violation burns the full base fuse", async () => {
    const h = makeHarness();
    await rampToPrearm(h);

    // No churn, no violation: risk decays until the pre-arm stands down.
    await tickUntil(h, () => fxTypes(h).includes("forecast_clear"), 40);
    const clear = h.fxEvents.find((event) => event.type === "forecast_clear");
    expect(clear?.type === "forecast_clear" && clear.wasPrearmed).toBe(true);
    expect(
      h.controller
        .getLog()
        .some(
          (event) =>
            event.kind === "forecast" && event.detail.startsWith("pre-arm stood down · unconfirmed"),
        ),
    ).toBe(true);
    // The whole ramp + stand-down never touched enforcement.
    expect(policyTypes(h)).not.toContain("start_countdown");
    expect(h.killer.calls.length).toBe(0);

    // A violation after the stand-down gets today's full 10 s fuse.
    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    await h.controller.flush();
    const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(10);
    expect(fxTypes(h)).toContain("forecast_miss");
  });

  it("the pre-arm halves the personal fuse rather than replacing it (20 s → 10 s)", async () => {
    // A longer personal fuse is not collapsed to `forecastPrearmFuseSec` (5).
    // Scaling is what keeps adapt's fair-shot contract bent instead of broken:
    // whoever has earned 20 s still gets twice as long as whoever earned 10.
    const h = makeHarness({ settings: { countdownSec: 20 } });
    await rampToPrearm(h);

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    await h.controller.flush();
    const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(10);

    await tickSeconds(h, 9);
    expect(h.killer.calls.length).toBe(0);
    await tickSeconds(h, 1);
    expect(h.killer.calls.length).toBe(1);
  });

  it("a scaled fuse never lands below MIN_FUSE_SEC", async () => {
    // INVARIANT CHANGED at the merge, and this is the test that says so.
    // The pre-arm no longer *replaces* the fuse with `forecastPrearmFuseSec`;
    // it scales the personalised length (`fuseAuthority.composeFuse`). So the
    // number that gets clamped is round(personal × 0.5), not the setting:
    // a 4 s personal fuse would scale to 2 s and is lifted to the 3 s floor.
    // The setting still floors the forecast's own advisory view at 3, which
    // is why both readings below agree.
    const h = makeHarness({ settings: { countdownSec: 4, forecastPrearmFuseSec: 1 } });
    await rampToPrearm(h);
    expect(h.forecast?.getSnapshot()?.effectiveFuseSec).toBe(3);

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    await h.controller.flush();
    const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(3);
  });
});

describe("the learning-signal guard", () => {
  /** `AdaptiveFuse.persist` writes the model exactly once per learned drift. */
  function withSaveSpy(settings?: Partial<AppSettings>): {
    h: Harness;
    saved: Array<{ drifts: number }>;
  } {
    const saved: Array<{ drifts: number }> = [];
    const h = makeHarness({
      ...(settings === undefined ? {} : { settings }),
      onSaveAdaptiveModel: (value) => saved.push(value as { drifts: number }),
    });
    return { h, saved };
  }

  it("a pre-armed drift is never folded into the adaptive model", async () => {
    // The trap: a pre-armed fuse is half the length the learner asked for, so
    // it kills more often through no fault of the user. Learn from it and the
    // model concludes "this person needs longer", the pre-arm halves the
    // longer fuse, and the two systems ratchet against each other forever.
    const { h, saved } = withSaveSpy();
    await rampToPrearm(h);

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    await h.controller.flush();
    const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(5);

    await tickSeconds(h, 5);
    expect(h.killer.calls.length).toBe(1);
    // The kill landed on a fuse the learner did not choose, so it is not
    // evidence about how long this person needs: nothing was written.
    expect(saved).toEqual([]);
    expect(
      h.controller
        .getLog()
        .some((event) => event.kind === "adapt" && event.detail.includes("not learned from")),
    ).toBe(true);
  });

  it("an unforecast drift is still learned from — the guard is not a blanket off switch", async () => {
    const { h, saved } = withSaveSpy();
    await startOnTask(h);
    await tickSeconds(h, 20); // ready and calm — no precursors, so no pre-arm

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    await h.controller.flush();
    const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
    expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(10);
    expect(fxTypes(h)).toContain("forecast_miss");

    await tickSeconds(h, 10);
    expect(h.killer.calls.length).toBe(1);
    expect(saved.length).toBe(1);
    expect(saved[0]?.drifts).toBe(1);
  });

  it("adapt off + forecast off is exactly the Settings fuse", async () => {
    // Both models silenced by their own switches: 1 s survives untouched —
    // neither the adaptive floor (3 s) nor a pre-arm can reach it.
    const previous = process.env.FOCUSPLUG_NO_ADAPT;
    process.env.FOCUSPLUG_NO_ADAPT = "1";
    try {
      const h = makeHarness({ settings: { countdownSec: 1, forecastEnabled: false } });
      await startOnTask(h);
      await tickSeconds(h, 20);

      h.clock.advance(250);
      h.window.emit(discordFocus(h.clock.ms));
      await h.controller.flush();
      const countdown = h.trace.policies.find((event) => event.type === "start_countdown");
      expect(countdown?.type === "start_countdown" && countdown.seconds).toBe(1);
      expect(h.fxEvents).toEqual([]);

      await tickSeconds(h, 1);
      expect(h.killer.calls.length).toBe(1);
    } finally {
      if (previous === undefined) {
        delete process.env.FOCUSPLUG_NO_ADAPT;
      } else {
        process.env.FOCUSPLUG_NO_ADAPT = previous;
      }
    }
  });
});

describe("no self-owned timers", () => {
  it("src/main/forecast sources never call setInterval/setTimeout — the controller loop ticks it", () => {
    for (const name of ["monitor.ts", "tap.ts", "recorder.ts", "index.ts", "fixtures.ts"]) {
      const source = readFileSync(join(HERE, name), "utf8");
      expect({ name, timers: /set(Interval|Timeout)\s*\(/.test(source) }).toEqual({
        name,
        timers: false,
      });
    }
  });
});
