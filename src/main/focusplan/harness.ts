import { DEFAULT_SESSION_STATE } from "../../shared/defaults.ts";
import type { SessionState } from "../../shared/ipc.ts";
import type {
  ForecastEvent,
  ForecastSnapshot,
} from "../../shared/forecast/types.ts";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
} from "../../shared/forecast/types.ts";
import type { FocusPlanLedger, PlanPush, PlanRound, PlanTap } from "../../shared/plan/types.ts";
import type { PlanLedgerStore } from "./recorder.ts";

/**
 * Focus Plan's test doubles.
 *
 * These live here rather than in `src/main/session/harness.ts` on purpose:
 * `PushTrace` is deliberately NOT extended, because the uncoupling test
 * deep-equals two traces and an extra field would make that assertion fail for
 * the wrong reason.
 */

export function createRecordingPlanPush(): { push: PlanPush; rounds: PlanRound[] } {
  const rounds: PlanRound[] = [];
  return {
    rounds,
    push: {
      round: (round) => {
        rounds.push({ ...round, driftsSec: [...round.driftsSec] });
      },
    },
  };
}

export interface MemoryPlanStore extends PlanLedgerStore {
  /** Every value handed to `savePlanLedger`, newest last. */
  readonly writes: unknown[];
  current(): unknown;
}

export function createMemoryPlanStore(init?: unknown): MemoryPlanStore {
  const writes: unknown[] = [];
  let value: unknown = init ?? null;
  return {
    writes,
    current: () => value,
    loadPlanLedger: () => value,
    savePlanLedger: (next) => {
      writes.push(next);
      value = next;
    },
  };
}

/** A store whose write always fails — the `plan · off` containment case. */
export function createFailingPlanStore(message = "disk full"): PlanLedgerStore {
  return {
    loadPlanLedger: () => null,
    savePlanLedger: () => {
      throw new Error(message);
    },
  };
}

/** Every handler throws — the tap's containment case and the uncoupling run. */
export function throwingPlanTap(message = "plan exploded"): PlanTap {
  const boom = (): never => {
    throw new Error(message);
  };
  return {
    onSessionState: boom,
    onPolicyEvent: boom,
    onForecastSnapshot: boom,
    onForecastEvent: boom,
  };
}

export function sessionState(active: boolean): SessionState {
  return { ...DEFAULT_SESSION_STATE, sessionActive: active };
}

/** A ready forecast snapshot carrying one risk reading. Nothing else matters. */
export function riskSnapshot(ts: number, risk: number, ready = true): ForecastSnapshot {
  return {
    ts,
    ready,
    warmupRemainingSec: ready ? 0 : 15,
    risk,
    rawRisk: risk,
    logit: 0,
    band: risk >= 0.65 ? "prearm" : risk >= 0.5 ? "elevated" : "calm",
    horizonSec: FORECAST_HORIZON_SEC,
    features: FORECAST_FEATURE_KEYS.map((key) => ({
      key,
      raw: 0,
      value: 0,
      attribution: 0,
    })),
    hidden: [],
    prearmedAt: null,
    effectiveFuseSec: 10,
    baseFuseSec: 10,
    modelVersion: FORECAST_MODEL_VERSION,
    paramCount: 0,
  };
}

export function nudgeEvent(ts: number, risk = 0.55): ForecastEvent {
  return { type: "forecast_nudge", ts, risk, topFeatures: [] };
}

export function standDownEvent(ts: number, risk = 0.2): ForecastEvent {
  return { type: "forecast_clear", ts, risk, wasPrearmed: true };
}

export function hitEvent(ts: number, leadSec: number): ForecastEvent {
  return { type: "forecast_hit", ts, leadSec };
}

export function ledgerOf(value: unknown): FocusPlanLedger {
  return value as FocusPlanLedger;
}
