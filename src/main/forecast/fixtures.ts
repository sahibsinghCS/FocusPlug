import {
  FORECAST_BASIS,
  FORECAST_BASIS_SHA,
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_INPUT_DIM,
  FORECAST_MODEL_VERSION,
  FORECAST_PARAM_COUNT,
  FORECAST_TERM_COUNT,
  FORECAST_TERM_KEYS,
} from "../../shared/forecast/index.ts";
import type { ForecastFeatureKey, ForecastWeightsFile } from "../../shared/forecast/index.ts";
import type { FocusSnapshot } from "../../shared/types.ts";

/**
 * Test fixtures for the main-process forecast suites.
 *
 * `switchProbeWeights()` is a hand-built, fully valid `ForecastWeightsFile`
 * whose risk responds ONLY to `switch15`, through that feature's own linear
 * and square basis terms, so escalation arcs are exactly scriptable from
 * proc-switch counts (`switch15` encodes as `min(n/8, 1)`):
 *
 *   switch15 = 0  (calm)          → risk ≈ 0.17   (below clear at 0.45)
 *   switch15 = 3  (medium churn)  → risk ≈ 0.67   (nudge zone, < pre-arm 0.80)
 *   switch15 ≥ 7  (heavy churn)   → risk ≈ 0.94   (pre-arm zone)
 *
 * Every other coefficient is zero, so desk noise, dwell, and streak can never
 * move the needle in these tests. The quadratic 6.987·x − 2.3191·x² − 1.586 is
 * the unique parabola through those three (x, logit) points and is monotone
 * increasing on [0, 1] (derivative 6.987 − 4.638·x > 0).
 */
export function switchProbeWeights(): ForecastWeightsFile {
  const coefficients = new Array<number>(FORECAST_TERM_COUNT).fill(0);
  const linear = FORECAST_TERM_KEYS.indexOf("switch15");
  const square = FORECAST_TERM_KEYS.indexOf("switch15^2");
  coefficients[linear] = 6.987;
  coefficients[square] = -2.3191;
  return {
    version: FORECAST_MODEL_VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
    seed: 7,
    featureKeys: [...FORECAST_FEATURE_KEYS] as ForecastFeatureKey[],
    norm: {
      mean: new Array<number>(FORECAST_INPUT_DIM).fill(0),
      scale: new Array<number>(FORECAST_INPUT_DIM).fill(1),
    },
    basis: FORECAST_BASIS,
    basisSha: FORECAST_BASIS_SHA,
    coefficients,
    intercept: -1.586,
    calibration: { a: 1, b: 0 },
    horizonSec: FORECAST_HORIZON_SEC,
    thresholds: { nudge: 0.55, prearm: 0.8, clear: 0.45 },
    paramCount: FORECAST_PARAM_COUNT,
    trainProvenanceSha: "test-fixture",
  };
}

/** Second allowlisted app so tests can churn proc switches while ON_TASK. */
export function codeFocus(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "code.exe",
    windowTitle: "essay.md — Visual Studio Code",
    matchedAllow: true,
    matchedBlock: false,
  };
}
