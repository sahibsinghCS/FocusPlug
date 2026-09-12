import { describe, expect, it } from "vitest";
import type { Decision } from "../types";
import {
  CLEAR_HYSTERESIS,
  CLEAR_SUSTAIN_TICKS,
  INITIAL_ESCALATION_STATE,
  NUDGE_COOLDOWN_SEC,
  NUDGE_SUSTAIN_TICKS,
  PREARM_FUSE_FLOOR_SEC,
  PREARM_SUSTAIN_TICKS,
  RISK_EMA_ALPHA,
  effectiveFuseSec,
  smoothRisk,
  stepEscalation,
  type EscalationInput,
  type EscalationSettings,
  type EscalationState,
} from "./escalate";
import type { ForecastBand, ForecastEvent } from "./types";
import goldenJson from "./fixtures/golden.json";

const T0 = 1_700_000_000_000;
const SEC = 1000;

const SETTINGS: EscalationSettings = {
  nudgeRisk: 0.55,
  prearmRisk: 0.8,
  prearmEnabled: true,
  prearmFuseSec: 5,
  baseFuseSec: 10,
};

interface FixtureStep {
  in: {
    risk: number;
    decision: Decision;
    countdownActive: boolean;
    policySignal: EscalationInput["policySignal"];
    ready?: boolean;
  };
  out: { band: ForecastBand; effectiveFuseSec: number | null; events: ForecastEvent[] };
}

interface EscalationScenario {
  name: string;
  settings: EscalationSettings;
  steps: FixtureStep[];
}

const golden = goldenJson as unknown as {
  escalation: { t0: number; scenarios: EscalationScenario[] };
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function input(
  ts: number,
  risk: number,
  settings: EscalationSettings = SETTINGS,
  over: Partial<EscalationInput> = {},
): EscalationInput {
  return {
    ts,
    risk,
    ready: true,
    decision: "ON_TASK",
    countdownActive: false,
    policySignal: null,
    settings,
    ...over,
  };
}

/** Runs `risks` at 1 Hz from T0 and returns the trace. */
function run(
  risks: number[],
  settings: EscalationSettings = SETTINGS,
  overrides: Record<number, Partial<EscalationInput>> = {},
): { state: EscalationState; events: ForecastEvent[][] } {
  let state = INITIAL_ESCALATION_STATE;
  const events: ForecastEvent[][] = [];
  risks.forEach((risk, i) => {
    const result = stepEscalation(
      state,
      input(T0 + i * SEC, risk, settings, overrides[i] ?? {}),
    );
    state = result.state;
    events.push(result.events);
  });
  return { state, events };
}

describe("escalation golden sequences", () => {
  for (const scenario of golden.escalation.scenarios) {
    it(scenario.name, () => {
      let state = INITIAL_ESCALATION_STATE;
      scenario.steps.forEach((step, i) => {
        // Frozen input AND state: a mutating reducer throws in strict mode.
        const frozenState = deepFreeze(structuredClone(state));
        const stepInput = deepFreeze({
          ts: golden.escalation.t0 + i * SEC,
          risk: step.in.risk,
          ready: step.in.ready ?? true,
          decision: step.in.decision,
          countdownActive: step.in.countdownActive,
          policySignal: step.in.policySignal,
          settings: scenario.settings,
        });
        const result = stepEscalation(frozenState, stepInput);
        expect(result.events, `${scenario.name} step ${i} events`).toEqual(step.out.events);
        expect(result.state.band, `${scenario.name} step ${i} band`).toBe(step.out.band);
        expect(
          effectiveFuseSec(result.state, scenario.settings),
          `${scenario.name} step ${i} effectiveFuseSec`,
        ).toBe(step.out.effectiveFuseSec);
        state = result.state;
      });
    });
  }

  it("golden scenarios cover the load-bearing paths", () => {
    const names = golden.escalation.scenarios.map((scenario) => scenario.name);
    expect(names).toContain("ramp_nudge_prearm_hit_latch");
    expect(names).toContain("nudge_cooldown_renudge");
    expect(names).toContain("stand_down_then_base_fuse");
    expect(names).toContain("hysteresis_holds_band");
    expect(names).toContain("prearm_disabled_nudge_only_miss");
    expect(names).toContain("warmup_not_ready_is_silent");
  });
});

describe("sustain ticks", () => {
  it("nudge needs exactly 3 consecutive ticks at or above the threshold", () => {
    expect(NUDGE_SUSTAIN_TICKS).toBe(3);
    const { events } = run([0.6, 0.6, 0.4, 0.6, 0.6, 0.6]);
    // The dip at index 2 resets the counter — nudge fires only at index 5.
    expect(events.flat().map((event) => event.type)).toEqual(["forecast_nudge"]);
    expect(events[5]?.[0]?.type).toBe("forecast_nudge");
  });

  it("pre-arm needs exactly 2 consecutive ticks at or above the threshold", () => {
    expect(PREARM_SUSTAIN_TICKS).toBe(2);
    const { events } = run([0.85, 0.4, 0.85, 0.85]);
    expect(events.flat().map((event) => event.type)).toEqual(["forecast_prearm"]);
    expect(events[3]?.[0]?.type).toBe("forecast_prearm");
  });

  it("clear needs 5 consecutive ticks below nudgeRisk − 0.10", () => {
    expect(CLEAR_SUSTAIN_TICKS).toBe(5);
    expect(CLEAR_HYSTERESIS).toBe(0.1);
    const risks = [0.6, 0.6, 0.6, 0.3, 0.3, 0.3, 0.3, 0.5, 0.3, 0.3, 0.3, 0.3, 0.3];
    const { events } = run(risks);
    // The 0.5 blip at index 7 (above 0.45) restarts the clear count.
    const clears = events.flatMap((list, i) => list.filter((e) => e.type === "forecast_clear").map(() => i));
    expect(clears).toEqual([12]);
  });
});

describe("nudge cooldown", () => {
  it("re-nudges only after 30 s, and a clear also starts the cooldown", () => {
    expect(NUDGE_COOLDOWN_SEC).toBe(30);
    // Nudge at i=2 (ts T0+2s); clear after five low ticks; re-elevation with
    // three high ticks lands within 30 s of the clear — no second nudge yet.
    const risks = [0.6, 0.6, 0.6, 0.3, 0.3, 0.3, 0.3, 0.3, 0.6, 0.6, 0.6, 0.6];
    const { state, events } = run(risks);
    const types = events.flat().map((event) => event.type);
    expect(types).toEqual(["forecast_nudge", "forecast_clear"]);
    // Band still escalates — only the toast is cooled down.
    expect(state.band).toBe("elevated");
  });
});

describe("latch rule — a burning fuse never changes duration mid-burn", () => {
  function prearmed(): EscalationState {
    const { state } = run([0.85, 0.85]);
    expect(state.prearmedAt).not.toBeNull();
    return state;
  }

  it("start_countdown freezes the pre-arm fuse; risk collapse cannot move it", () => {
    let state = prearmed();
    let result = stepEscalation(
      state,
      input(T0 + 2 * SEC, 0.9, SETTINGS, {
        decision: "DISTRACTED",
        countdownActive: true,
        policySignal: "start_countdown",
      }),
    );
    state = result.state;
    expect(state.latchedFuseSec).toBe(5);
    expect(effectiveFuseSec(state, SETTINGS)).toBe(5);
    // Risk falls off a cliff mid-burn; the latch holds every step.
    for (let i = 3; i < 8; i += 1) {
      result = stepEscalation(
        state,
        input(T0 + i * SEC, 0.05, SETTINGS, { decision: "DISTRACTED", countdownActive: true }),
      );
      state = result.state;
      expect(effectiveFuseSec(state, SETTINGS)).toBe(5);
      expect(result.events).toEqual([]); // the hit fired at the onset step, nothing since
    }
  });

  it("even a settings change mid-burn cannot move a latched fuse", () => {
    let state = prearmed();
    state = stepEscalation(
      state,
      input(T0 + 2 * SEC, 0.9, SETTINGS, {
        decision: "DISTRACTED",
        countdownActive: true,
        policySignal: "start_countdown",
      }),
    ).state;
    const retuned: EscalationSettings = { ...SETTINGS, prearmFuseSec: 8, baseFuseSec: 20 };
    state = stepEscalation(
      state,
      input(T0 + 3 * SEC, 0.9, retuned, { decision: "DISTRACTED", countdownActive: true }),
    ).state;
    expect(effectiveFuseSec(state, retuned)).toBe(5);
  });

  it("kill releases the latch; cancel_countdown releases the latch", () => {
    for (const signal of ["kill", "cancel_countdown"] as const) {
      let state = prearmed();
      state = stepEscalation(
        state,
        input(T0 + 2 * SEC, 0.9, SETTINGS, {
          decision: "DISTRACTED",
          countdownActive: true,
          policySignal: "start_countdown",
        }),
      ).state;
      state = stepEscalation(
        state,
        input(T0 + 3 * SEC, 0.9, SETTINGS, { decision: "DISTRACTED", policySignal: signal }),
      ).state;
      expect(state.latchedFuseSec).toBeNull();
      expect(effectiveFuseSec(state, SETTINGS)).toBeNull();
    }
  });

  it("a countdown that starts without a pre-arm latches the base fuse", () => {
    const { state } = run([0.2, 0.2], SETTINGS, {
      1: { decision: "DISTRACTED", countdownActive: true, policySignal: "start_countdown" },
    });
    expect(state.latchedFuseSec).toBe(SETTINGS.baseFuseSec);
  });
});

describe("effectiveFuseSec floor and cap", () => {
  function prearmedState(): EscalationState {
    return { ...INITIAL_ESCALATION_STATE, band: "prearm", prearmedAt: T0 };
  }

  it("is null when neither pre-armed nor latched", () => {
    expect(effectiveFuseSec(INITIAL_ESCALATION_STATE, SETTINGS)).toBeNull();
  });

  it("floors at 3 s: prearmFuseSec 1 → 3", () => {
    expect(PREARM_FUSE_FLOOR_SEC).toBe(3);
    expect(effectiveFuseSec(prearmedState(), { ...SETTINGS, prearmFuseSec: 1 })).toBe(3);
  });

  it("caps at the base fuse: prearmFuseSec 60, base 10 → 10", () => {
    expect(effectiveFuseSec(prearmedState(), { ...SETTINGS, prearmFuseSec: 60 })).toBe(10);
  });

  it("max(3, min(base, prearm)) exactly — floor wins even over a tiny base", () => {
    expect(effectiveFuseSec(prearmedState(), { ...SETTINGS, baseFuseSec: 4, prearmFuseSec: 5 })).toBe(4);
    expect(effectiveFuseSec(prearmedState(), { ...SETTINGS, baseFuseSec: 2, prearmFuseSec: 1 })).toBe(3);
  });

  it("the pre-arm event carries the same floored/capped fuse", () => {
    const { events } = run([0.85, 0.85], { ...SETTINGS, prearmFuseSec: 1 });
    const prearm = events.flat().find((event) => event.type === "forecast_prearm");
    expect(prearm).toEqual({ type: "forecast_prearm", ts: T0 + SEC, risk: 0.85, fuseSec: 3 });
  });

  it("latched value wins over the pre-arm derivation", () => {
    const state: EscalationState = { ...prearmedState(), latchedFuseSec: 7 };
    expect(effectiveFuseSec(state, SETTINGS)).toBe(7);
  });
});

describe("receipts", () => {
  it("hit carries fractional lead seconds from prearmedAt", () => {
    let state = run([0.85, 0.85]).state; // prearmedAt = T0 + 1000
    const result = stepEscalation(
      state,
      input(T0 + 3 * SEC + 500, 0.9, SETTINGS, { decision: "DISTRACTED", countdownActive: true }),
    );
    expect(result.events).toEqual([
      { type: "forecast_hit", ts: T0 + 3 * SEC + 500, leadSec: 2.5 },
    ]);
    state = result.state;
    expect(state.prearmedAt).toBeNull();
    expect(state.band).toBe("calm");
  });

  it("a second drift without re-pre-arm is a miss, not a stale hit", () => {
    const risks = [0.85, 0.85, 0.9, 0.9, 0.9];
    const { events } = run(risks, SETTINGS, {
      2: { decision: "DISTRACTED", countdownActive: true },
      3: { decision: "ON_TASK" },
      4: { decision: "AWAY", countdownActive: true },
    });
    const types = events.flat().map((event) => event.type);
    expect(types).toEqual(["forecast_prearm", "forecast_hit", "forecast_miss"]);
  });

  it("stood-down pre-arm clears with wasPrearmed true; plain elevation clears false", () => {
    const prearmedClear = run([0.85, 0.85, 0.3, 0.3, 0.3, 0.3, 0.3]).events.flat();
    expect(prearmedClear.find((event) => event.type === "forecast_clear")).toMatchObject({
      wasPrearmed: true,
    });
    const elevatedClear = run([0.6, 0.6, 0.6, 0.3, 0.3, 0.3, 0.3, 0.3]).events.flat();
    expect(elevatedClear.find((event) => event.type === "forecast_clear")).toMatchObject({
      wasPrearmed: false,
    });
  });
});

describe("suppression and gating", () => {
  it("not ready: no events, no band movement, counters stay at zero", () => {
    const { state, events } = run([0.95, 0.95, 0.95, 0.95], SETTINGS, {
      0: { ready: false },
      1: { ready: false },
      2: { ready: false },
      3: { ready: false },
    });
    expect(events.flat()).toEqual([]);
    expect(state).toMatchObject({ band: "calm", ticksAboveNudge: 0, prearmedAt: null });
  });

  it("high risk during an active countdown never escalates (policy owns the moment)", () => {
    const overrides: Record<number, Partial<EscalationInput>> = {};
    for (let i = 0; i < 6; i += 1) {
      overrides[i] = { countdownActive: true };
    }
    const { events } = run([0.95, 0.95, 0.95, 0.95, 0.95, 0.95], SETTINGS, overrides);
    expect(events.flat()).toEqual([]);
  });

  it("sustain restarts from zero after suppression ends", () => {
    // Two hot ticks, then a suppressed tick, then the countdown lifts:
    // pre-arm still needs 2 fresh ticks.
    const { events } = run([0.9, 0.9, 0.9, 0.9, 0.9], SETTINGS, {
      0: { countdownActive: true },
      1: { countdownActive: true },
      2: { countdownActive: true },
    });
    const prearmIndexes = events.flatMap((list, i) =>
      list.filter((event) => event.type === "forecast_prearm").map(() => i),
    );
    expect(prearmIndexes).toEqual([4]);
  });

  it("pre-arm disabled is nudge-only: band elevates, fuse never shortens", () => {
    const { state, events } = run([0.9, 0.9, 0.9, 0.9], { ...SETTINGS, prearmEnabled: false });
    expect(events.flat().map((event) => event.type)).toEqual(["forecast_nudge"]);
    expect(state.band).toBe("elevated");
    expect(state.prearmedAt).toBeNull();
    expect(effectiveFuseSec(state, { ...SETTINGS, prearmEnabled: false })).toBeNull();
  });

  it("re-pre-arm after a stand-down is allowed", () => {
    const risks = [0.85, 0.85, 0.3, 0.3, 0.3, 0.3, 0.3, 0.85, 0.85];
    const { events } = run(risks);
    const types = events.flat().map((event) => event.type);
    expect(types).toEqual(["forecast_prearm", "forecast_clear", "forecast_prearm"]);
  });
});

describe("determinism and helpers", () => {
  it("same state + input twice gives deep-equal results", () => {
    const state = run([0.6, 0.6, 0.6, 0.85]).state;
    const stepInput = input(T0 + 4 * SEC, 0.85);
    expect(stepEscalation(state, stepInput)).toEqual(stepEscalation(state, stepInput));
  });

  it("smoothRisk applies α = 0.5 per tick and seeds from the first sample", () => {
    expect(RISK_EMA_ALPHA).toBe(0.5);
    expect(smoothRisk(null, 0.8)).toBe(0.8);
    expect(smoothRisk(0.4, 0.8)).toBeCloseTo(0.6, 12);
    expect(smoothRisk(Number.NaN, 0.8)).toBe(0.8);
  });
});
