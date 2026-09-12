import type { Decision } from "../types";
import { isDriftedDecision } from "./labels";
import type { ForecastBand, ForecastEvent } from "./types";

/**
 * Pure escalation reducer — `stepPolicy` style: `(state, input) → { state,
 * events }`, no I/O, no wall clock, ticked once per closed 1 Hz frame (plus
 * immediately on tapped policy signals so the latch is exact).
 *
 * Bands: calm → elevated (nudge) → prearm, with EMA-smoothed risk upstream,
 * consecutive-tick sustains, a 30 s nudge/clear cooldown, and clear
 * hysteresis, so the needle can wander without the UI flapping.
 *
 * The latch rule is the load-bearing safety property: the moment the tap sees
 * `start_countdown`, the fuse value currently in force freezes and
 * `effectiveFuseSec` keeps returning it until `kill` or `cancel_countdown` —
 * a burning fuse NEVER changes duration mid-burn, no matter what risk does.
 */

export const NUDGE_SUSTAIN_TICKS = 3;
export const PREARM_SUSTAIN_TICKS = 2;
export const CLEAR_SUSTAIN_TICKS = 5;
export const NUDGE_COOLDOWN_SEC = 30;
export const CLEAR_HYSTERESIS = 0.10;      // clear threshold = nudgeRisk - 0.10
export const PREARM_FUSE_FLOOR_SEC = 3;
export const RISK_EMA_ALPHA = 0.5;

export interface EscalationSettings {
  nudgeRisk: number;      // settings.forecastNudgeRisk
  prearmRisk: number;     // settings.forecastPrearmRisk
  prearmEnabled: boolean; // settings.forecastPrearmEnabled
  prearmFuseSec: number;  // settings.forecastPrearmFuseSec
  baseFuseSec: number;    // settings.countdownSec
}

export interface EscalationState {
  band: ForecastBand;
  ticksAboveNudge: number;
  ticksAbovePrearm: number;
  ticksBelowClear: number;
  lastNudgeAt: number | null;
  prearmedAt: number | null;
  latchedFuseSec: number | null; // non-null exactly while a policy countdown burns
  drifted: boolean;              // decision currently DISTRACTED/AWAY
}

export interface EscalationInput {
  ts: number;
  risk: number;          // smoothed
  ready: boolean;
  decision: Decision;    // from tapped status events
  countdownActive: boolean;
  policySignal: "start_countdown" | "cancel_countdown" | "kill" | "unlock" | null;
  settings: EscalationSettings;
}

export const INITIAL_ESCALATION_STATE: EscalationState = {
  band: "calm",
  ticksAboveNudge: 0,
  ticksAbovePrearm: 0,
  ticksBelowClear: 0,
  lastNudgeAt: null,
  prearmedAt: null,
  latchedFuseSec: null,
  drifted: false,
};

/** EMA smoothing for the risk needle (α applied per 1 Hz tick). */
export function smoothRisk(previous: number | null, rawRisk: number): number {
  if (previous === null || !Number.isFinite(previous)) {
    return rawRisk;
  }
  return RISK_EMA_ALPHA * rawRisk + (1 - RISK_EMA_ALPHA) * previous;
}

/** The pre-arm fuse a pre-arm would apply: floored at 3 s, capped at base. */
function prearmFuse(settings: EscalationSettings): number {
  return Math.max(
    PREARM_FUSE_FLOOR_SEC,
    Math.min(settings.baseFuseSec, settings.prearmFuseSec),
  );
}

/** max(3, min(baseFuseSec, prearmFuseSec)) while pre-armed; latchedFuseSec wins while burning; null otherwise. */
export function effectiveFuseSec(
  state: EscalationState,
  settings: EscalationSettings,
): number | null {
  if (state.latchedFuseSec !== null) {
    return state.latchedFuseSec;
  }
  if (state.prearmedAt !== null) {
    return prearmFuse(settings);
  }
  return null;
}

export function stepEscalation(
  state: EscalationState,
  input: EscalationInput,
): { state: EscalationState; events: ForecastEvent[] } {
  const next: EscalationState = { ...state };
  const events: ForecastEvent[] = [];

  // 1. Latch. On start_countdown the value currently in force freezes —
  //    computed from the PRE-step state, before this step's receipt can
  //    consume the pre-arm. Kill/cancel/unlock releases it.
  if (input.policySignal === "start_countdown") {
    next.latchedFuseSec = effectiveFuseSec(state, input.settings) ?? input.settings.baseFuseSec;
  } else if (
    input.policySignal === "cancel_countdown" ||
    input.policySignal === "kill" ||
    input.policySignal === "unlock"
  ) {
    next.latchedFuseSec = null;
  }

  // 2. Receipt. On drift onset the forecast prints its scorecard: pre-armed
  //    ⇒ hit with lead seconds, not pre-armed ⇒ miss. Either way the pre-arm
  //    is consumed and escalation resets (policy owns the moment now).
  const driftedNow = isDriftedDecision(input.decision);
  if (driftedNow && !state.drifted) {
    if (state.prearmedAt !== null) {
      events.push({
        type: "forecast_hit",
        ts: input.ts,
        leadSec: (input.ts - state.prearmedAt) / 1000,
      });
    } else {
      events.push({ type: "forecast_miss", ts: input.ts });
    }
    next.prearmedAt = null;
    next.band = "calm";
    next.ticksAboveNudge = 0;
    next.ticksAbovePrearm = 0;
    next.ticksBelowClear = 0;
  }
  next.drifted = driftedNow;

  // 3. Suppression: not warmed up, drifted, or a countdown burning — no
  //    escalation moves, sustain counters restart from zero afterwards.
  if (!input.ready || driftedNow || input.countdownActive) {
    next.ticksAboveNudge = 0;
    next.ticksAbovePrearm = 0;
    next.ticksBelowClear = 0;
    return { state: next, events };
  }

  // 4. Sustain counters against the live settings thresholds.
  const clearRisk = input.settings.nudgeRisk - CLEAR_HYSTERESIS;
  next.ticksAboveNudge = input.risk >= input.settings.nudgeRisk ? next.ticksAboveNudge + 1 : 0;
  next.ticksAbovePrearm = input.risk >= input.settings.prearmRisk ? next.ticksAbovePrearm + 1 : 0;
  next.ticksBelowClear = input.risk < clearRisk ? next.ticksBelowClear + 1 : 0;

  // 5. Clear — from any escalated state, after sustained low risk. A pre-arm
  //    that clears without a drift is a stood-down false alarm, logged as
  //    loudly as a hit. Clearing starts the nudge cooldown so a bouncing
  //    needle cannot nudge immediately after standing down.
  if (next.band !== "calm" && next.ticksBelowClear >= CLEAR_SUSTAIN_TICKS) {
    events.push({
      type: "forecast_clear",
      ts: input.ts,
      risk: input.risk,
      wasPrearmed: next.prearmedAt !== null,
    });
    next.band = "calm";
    next.prearmedAt = null;
    next.lastNudgeAt = input.ts;
    return { state: next, events };
  }

  // 6. Pre-arm — sustained high risk, once per escalation (edge-triggered),
  //    only when the setting allows the fuse to shorten at all.
  if (
    input.settings.prearmEnabled &&
    next.prearmedAt === null &&
    next.ticksAbovePrearm >= PREARM_SUSTAIN_TICKS
  ) {
    next.band = "prearm";
    next.prearmedAt = input.ts;
    events.push({
      type: "forecast_prearm",
      ts: input.ts,
      risk: input.risk,
      fuseSec: prearmFuse(input.settings),
    });
    return { state: next, events };
  }

  // 7. Nudge — sustained elevated risk. The band rises with the sustain; the
  //    toast event is additionally cooled down 30 s from the last nudge or
  //    clear. `topFeatures` is left empty here — the monitor overlays the
  //    live top-3 attribution keys before fan-out (the reducer sees no
  //    feature data by contract).
  if (next.band === "calm" && next.ticksAboveNudge >= NUDGE_SUSTAIN_TICKS) {
    next.band = "elevated";
  }
  if (
    next.band === "elevated" &&
    next.ticksAboveNudge >= NUDGE_SUSTAIN_TICKS &&
    (next.lastNudgeAt === null || input.ts - next.lastNudgeAt >= NUDGE_COOLDOWN_SEC * 1000)
  ) {
    next.lastNudgeAt = input.ts;
    events.push({
      type: "forecast_nudge",
      ts: input.ts,
      risk: input.risk,
      topFeatures: [],
    });
  }

  return { state: next, events };
}
