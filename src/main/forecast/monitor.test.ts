import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_STATE, DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import type { AppSettings, SessionState } from "../../shared/ipc.ts";
import type {
  Decision,
  FocusSnapshot,
  PolicyEvent,
} from "../../shared/types.ts";
import {
  FORECAST_HIDDEN_DIM,
  FORECAST_INPUT_DIM,
  FORECAST_PARAM_COUNT,
  type ForecastEvent,
  type ForecastSnapshot,
} from "../../shared/forecast/index.ts";
import { discordFocus, docsFocus, presentDesk } from "../session/harness.ts";
import { codeFocus, switchProbeWeights } from "./fixtures.ts";
import { createForecast, type Forecast } from "./index.ts";
import type { ForecastFrameRow, ForecastFrameSink } from "./recorder.ts";

const T0 = 1_000_000;

interface MonitorHarness {
  forecast: Forecast;
  monitor: Forecast["monitor"];
  settings: AppSettings;
  logs: string[];
  snapshots: ForecastSnapshot[];
  events: ForecastEvent[];
  throwSettings: boolean;
  /** Current second boundary the harness has ticked to. */
  t: number;
  churnToggle: boolean;
}

function makeMonitor(init?: {
  settings?: Partial<AppSettings>;
  weights?: unknown;
  recorder?: ForecastFrameSink | null;
}): MonitorHarness {
  const h: MonitorHarness = {
    forecast: undefined as unknown as Forecast,
    monitor: undefined as unknown as Forecast["monitor"],
    settings: { ...DEFAULT_SETTINGS, ...init?.settings, plugs: [] },
    logs: [],
    snapshots: [],
    events: [],
    throwSettings: false,
    t: T0,
    churnToggle: false,
  };
  h.forecast = createForecast({
    loadSettings: () => {
      if (h.throwSettings) {
        throw new Error("settings store exploded");
      }
      return { ...h.settings, plugs: [...h.settings.plugs] };
    },
    appendLog: (detail) => h.logs.push(detail),
    push: {
      snapshot: (snap) => h.snapshots.push(snap),
      event: (event) => h.events.push(event),
    },
    weights: init && "weights" in init ? init.weights : switchProbeWeights(),
    recorder: init?.recorder ?? null,
  });
  h.monitor = h.forecast.monitor;
  return h;
}

function sessionActive(active: boolean): SessionState {
  return { ...DEFAULT_SESSION_STATE, sessionActive: active };
}

function status(decision: Decision): PolicyEvent {
  return { type: "status", decision, detail: "test" };
}

/** Session start as the tap sees it, plus the first evaluate's beforeStep. */
function start(h: MonitorHarness): void {
  h.monitor.onSessionState(sessionActive(true));
  h.monitor.beforeStep(h.t, h.settings.countdownSec);
  h.monitor.onFocus(docsFocus(h.t));
  h.monitor.onDesk(presentDesk(h.t));
  h.monitor.onPolicyEvent(status("ON_TASK"));
}

/** Advance whole seconds, one beforeStep per second (the controller loop). */
function tickSeconds(h: MonitorHarness, seconds: number): void {
  for (let i = 0; i < seconds; i += 1) {
    h.t += 1000;
    h.monitor.beforeStep(h.t, h.settings.countdownSec);
  }
}

/** One alt-tab: docs ⇄ code, both allowlisted, exact transition in the ring. */
function flip(h: MonitorHarness, ts: number): void {
  h.churnToggle = !h.churnToggle;
  const snap: FocusSnapshot = h.churnToggle ? codeFocus(ts) : docsFocus(ts);
  h.monitor.onFocus(snap);
}

function tickUntil(
  h: MonitorHarness,
  predicate: () => boolean,
  maxSeconds: number,
  perSecond?: () => void,
): void {
  for (let i = 0; i < maxSeconds; i += 1) {
    if (predicate()) {
      return;
    }
    perSecond?.();
    tickSeconds(h, 1);
  }
  expect(predicate()).toBe(true);
}

function eventTypes(h: MonitorHarness): string[] {
  return h.events.map((event) => event.type);
}

/** Heavy churn (2 flips/s) until the pre-arm event lands. */
function rampToPrearm(h: MonitorHarness): void {
  tickUntil(
    h,
    () => eventTypes(h).includes("forecast_prearm"),
    20,
    () => {
      flip(h, h.t + 200);
      flip(h, h.t + 400);
    },
  );
}

describe("ForecastMonitor cadence", () => {
  it("closes one frame per elapsed wall second, driven only by beforeStep", () => {
    const h = makeMonitor();
    start(h);
    // The session's first focus flips focusKind none→allow, which is a
    // forced display-only recompute — one snapshot at T0, no frame.
    expect(h.snapshots.length).toBe(1);
    expect(h.snapshots[0]?.ts).toBe(T0);

    h.monitor.beforeStep(h.t + 500, 10);
    expect(h.snapshots.length).toBe(1); // sub-second: no frame yet

    h.monitor.beforeStep(h.t + 1000, 10);
    expect(h.snapshots.length).toBe(2);
    expect(h.snapshots[1]?.ts).toBe(T0 + 1000);

    h.monitor.beforeStep(h.t + 4200, 10);
    expect(h.snapshots.slice(1).map((snap) => snap.ts)).toEqual([
      T0 + 1000,
      T0 + 2000,
      T0 + 3000,
      T0 + 4000,
    ]);
  });

  it("warm-up: ready flips at 15 s, warmupRemainingSec counts down", () => {
    const h = makeMonitor();
    start(h);
    tickSeconds(h, 14);
    const early = h.snapshots[h.snapshots.length - 1];
    expect(early?.ready).toBe(false);
    expect(early?.warmupRemainingSec).toBe(1);
    expect(h.snapshots[1]?.warmupRemainingSec).toBe(14); // first 1 Hz frame

    tickSeconds(h, 1);
    const ready = h.snapshots[h.snapshots.length - 1];
    expect(ready?.ready).toBe(true);
    expect(ready?.warmupRemainingSec).toBe(0);
  });

  it("escalation is suppressed until ready, even under heavy churn", () => {
    const h = makeMonitor();
    start(h);
    for (let i = 0; i < 14; i += 1) {
      flip(h, h.t + 200);
      flip(h, h.t + 400);
      tickSeconds(h, 1);
      expect(h.events).toEqual([]);
      expect(h.forecast.getSnapshot()?.band).toBe("calm");
    }
    // Once warmed up the sustained churn escalates promptly.
    rampToPrearm(h);
    expect(eventTypes(h)).toContain("forecast_prearm");
  });

  it("snapshot shape: every feature in key order, one cell per hidden unit, provenance fields", () => {
    const h = makeMonitor();
    start(h);
    tickSeconds(h, 1);
    const snap = h.snapshots[0];
    expect(snap?.features.length).toBe(FORECAST_INPUT_DIM);
    expect(snap?.features[0]?.key).toBe("switch15");
    // `hidden` is the shipped head's actual hidden layer — the contract is
    // "a number[] of whatever length the architecture has", and the UI reads
    // its length rather than assuming one cell per feature.
    expect(snap?.hidden.length).toBe(FORECAST_HIDDEN_DIM);
    expect(snap?.paramCount).toBe(FORECAST_PARAM_COUNT);
    expect(snap?.modelVersion).toBe("ff-1");
    expect(snap?.horizonSec).toBe(30);
    expect(snap?.baseFuseSec).toBe(10);
    expect(snap?.effectiveFuseSec).toBe(10);
  });
});

describe("ForecastMonitor gating", () => {
  it("forecastEnabled:false is total silence", () => {
    const h = makeMonitor({ settings: { forecastEnabled: false } });
    start(h);
    for (let i = 0; i < 20; i += 1) {
      flip(h, h.t + 200);
      flip(h, h.t + 400);
      h.t += 1000;
      expect(h.monitor.beforeStep(h.t, 10)).toBe(null);
    }
    h.monitor.onPolicyEvent(status("DISTRACTED"));
    expect(h.snapshots).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.logs).toEqual([]);
    expect(h.forecast.getSnapshot()).toBe(null);
  });

  it("invalid weights fail closed: silent, null override, one log line", () => {
    const h = makeMonitor({ weights: { version: "not-ff-1" } });
    start(h);
    tickSeconds(h, 20);
    expect(h.snapshots).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.forecast.getSnapshot()).toBe(null);
    expect(h.monitor.beforeStep(h.t + 1000, 10)).toBe(null);
    expect(h.logs.filter((line) => line.startsWith("off ·")).length).toBe(1);
  });

  it("session restart resets the ring, warm-up, and snapshot", () => {
    const h = makeMonitor();
    start(h);
    tickSeconds(h, 16);
    expect(h.forecast.getSnapshot()?.ready).toBe(true);

    h.monitor.onSessionState(sessionActive(false));
    expect(h.forecast.getSnapshot()).toBe(null);

    h.monitor.onSessionState(sessionActive(true));
    h.t += 60_000; // long break between sessions
    h.monitor.beforeStep(h.t, 10);
    h.monitor.onFocus(docsFocus(h.t));
    tickSeconds(h, 1);
    const snap = h.forecast.getSnapshot();
    expect(snap?.ready).toBe(false); // warm-up starts over
    expect(snap?.warmupRemainingSec).toBe(14);
    expect(snap?.risk).toBeLessThan(0.3); // churn history did not survive
  });
});

describe("ForecastMonitor escalation and receipts", () => {
  it("nudge carries the top attribution keys (switch15 drives the probe)", () => {
    const h = makeMonitor();
    start(h);
    tickSeconds(h, 16);
    // Three switches, then hold: risk plateaus in the nudge band.
    flip(h, h.t + 100);
    flip(h, h.t + 200);
    flip(h, h.t + 300);
    tickUntil(h, () => eventTypes(h).includes("forecast_nudge"), 10);
    const nudge = h.events.find((event) => event.type === "forecast_nudge");
    expect(nudge?.type === "forecast_nudge" && nudge.topFeatures[0]).toBe("switch15");
    expect(eventTypes(h)).not.toContain("forecast_prearm");
    expect(h.forecast.getSnapshot()?.band).toBe("elevated");
    expect(h.logs.some((line) => line.startsWith("nudge ·"))).toBe(true);
  });

  it("pre-arm shortens the advisory fuse; hit receipt carries leadSec; kill releases", () => {
    const h = makeMonitor();
    start(h);
    tickSeconds(h, 16);
    rampToPrearm(h);
    const prearm = h.events.find((event) => event.type === "forecast_prearm");
    expect(prearm?.type === "forecast_prearm" && prearm.fuseSec).toBe(5);
    expect(h.monitor.beforeStep(h.t, 10)).toBe(5);
    expect(h.forecast.getSnapshot()?.band).toBe("prearm");
    expect(h.forecast.getSnapshot()?.effectiveFuseSec).toBe(5);

    // The violation: tap order is focus → start_countdown → status (as the
    // controller pushes them). The latch freezes 5; the receipt is a hit.
    h.t += 250;
    h.monitor.onFocus(discordFocus(h.t));
    h.monitor.beforeStep(h.t, 10);
    h.monitor.onPolicyEvent({ type: "start_countdown", reason: "blocked_focus", seconds: 5 });
    h.monitor.onPolicyEvent(status("DISTRACTED"));

    const hit = h.events.find((event) => event.type === "forecast_hit");
    expect(hit?.type === "forecast_hit" && hit.leadSec).toBeGreaterThan(0);
    expect(h.logs.some((line) => line.startsWith("hit · called"))).toBe(true);

    // Latched while burning — even though the pre-arm was consumed.
    expect(h.monitor.beforeStep(h.t + 1000, 10)).toBe(5);

    h.monitor.onPolicyEvent({ type: "kill", targets: ["discord.exe"], reason: "blocked_focus" });
    h.monitor.onPolicyEvent(status("DISTRACTED"));
    expect(h.monitor.beforeStep(h.t + 2000, 10)).toBe(null);
  });

  it("drift onset without a pre-arm is a loud miss", () => {
    const h = makeMonitor();
    start(h);
    tickSeconds(h, 16);
    h.monitor.onPolicyEvent({ type: "start_countdown", reason: "blocked_focus", seconds: 10 });
    h.monitor.onPolicyEvent(status("DISTRACTED"));
    expect(eventTypes(h)).toContain("forecast_miss");
    expect(h.logs).toContain("miss — no warning");
  });
});

describe("ForecastMonitor failure containment", () => {
  it("first error latches off for the session: one line, base fuse, no throws", () => {
    const h = makeMonitor();
    start(h);
    tickSeconds(h, 16);
    rampToPrearm(h);
    expect(h.monitor.beforeStep(h.t, 10)).toBe(5);

    h.throwSettings = true;
    expect(h.monitor.beforeStep(h.t + 1000, 10)).toBe(null); // base fuse restored
    expect(h.logs.filter((line) => line.startsWith("off ·")).length).toBe(1);

    const snapshotCount = h.snapshots.length;
    const eventCount = h.events.length;
    expect(() => {
      h.monitor.onFocus(discordFocus(h.t + 1500));
      h.monitor.onPolicyEvent(status("DISTRACTED"));
      h.monitor.beforeStep(h.t + 2000, 10);
    }).not.toThrow();
    expect(h.snapshots.length).toBe(snapshotCount);
    expect(h.events.length).toBe(eventCount);
    expect(h.logs.filter((line) => line.startsWith("off ·")).length).toBe(1);

    // The latch is per session: the next session starts clean.
    h.throwSettings = false;
    h.monitor.onSessionState(sessionActive(false));
    h.monitor.onSessionState(sessionActive(true));
    h.t += 10_000;
    h.monitor.beforeStep(h.t, 10);
    h.monitor.onFocus(docsFocus(h.t)); // none→allow: one forced recompute
    tickSeconds(h, 1); // plus the first 1 Hz frame
    expect(h.snapshots.length).toBe(snapshotCount + 2);
  });

  it("recorder rows flow at 1 Hz through the monitor", () => {
    const rows: ForecastFrameRow[] = [];
    const h = makeMonitor({ recorder: { record: (row) => rows.push(row) } });
    start(h);
    tickSeconds(h, 3);
    expect(rows.length).toBe(3);
    expect(rows.map((row) => row.t)).toEqual([1, 2, 3]);
    expect(rows[0]?.v).toBe(1);
    expect(rows[0]?.source).toBe("recorded");
    expect(rows[0]?.label).toBe(null);
    expect(rows[0]?.features.length).toBe(FORECAST_INPUT_DIM);
    expect(rows[0]?.decision).toBe("ON_TASK");
  });
});
