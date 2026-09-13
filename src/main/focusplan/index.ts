import type { FocusPlanState, PlanPush, PlanTap } from "../../shared/plan/types.ts";
import { PlanRecorder, type PlanRecorderOptions } from "./recorder.ts";

export { PlanRecorder, describeRound, normalizePlanContext, PLAN_PIN_ENV } from "./recorder.ts";
export type { PlanLedgerStore, PlanRecorderOptions } from "./recorder.ts";
export { withPlan, withPlanForecast } from "./tap.ts";
export {
  appendPlanRound,
  clonePlanRound,
  emptyPlanLedger,
  localDayStamp,
  planStateWindow,
  revivePlanLedger,
} from "./ledger.ts";

export interface CreateFocusPlanOptions extends PlanRecorderOptions {}

export interface FocusPlan {
  recorder: PlanRecorder;
  /** Mirrored off `SessionPush` by `withPlan`. */
  sessionTap: PlanTap;
  /** Mirrored off `ForecastPush` by `withPlanForecast`. */
  forecastTap: PlanTap;
  /** The optional `SESSION_START` argument, consumed in `src/main/index.ts`. */
  declareRound(context: unknown): void;
  /** `PLAN_GET_STATE`. */
  getState(): FocusPlanState;
  /** `PLAN_RESET`. */
  reset(): FocusPlanState;
}

/**
 * One Focus Plan per session runtime. Both taps are the same recorder — they
 * are named apart because they hang off two different pushes, and reading
 * `withPlanForecast(..., plan.forecastTap)` in `runtime.ts` should say which
 * stream is being mirrored.
 */
export function createFocusPlan(options: CreateFocusPlanOptions): FocusPlan {
  const recorder = new PlanRecorder(options);
  return {
    recorder,
    sessionTap: recorder,
    forecastTap: recorder,
    declareRound: (context) => recorder.declareRound(context),
    getState: () => recorder.getState(),
    reset: () => recorder.reset(),
  };
}

/** No-op fan-out for tests and headless wiring (mirrors `silentForecastPush`). */
export function silentPlanPush(): PlanPush {
  return { round: () => undefined };
}
