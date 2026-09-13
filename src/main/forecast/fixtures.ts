import {
  FORECAST_BASIS,
  FORECAST_BASIS_SHA,
  FORECAST_FEATURE_KEYS,
  FORECAST_HIDDEN_DIM,
  FORECAST_HORIZON_SEC,
  FORECAST_INPUT_DIM,
  FORECAST_MODEL_VERSION,
  FORECAST_PARAM_COUNT,
} from "../../shared/forecast/index.ts";
import type { ForecastFeatureKey, ForecastWeightsFile } from "../../shared/forecast/index.ts";
import type { FocusSnapshot } from "../../shared/types.ts";

/**
 * Test fixtures for the main-process forecast suites.
 *
 * `switchProbeWeights()` is a hand-built, fully valid `ForecastWeightsFile`
 * whose risk responds ONLY to `switch15` — exactly one hidden unit is wired to
 * that feature and every other weight is zero — so escalation arcs are exactly
 * scriptable from proc-switch counts (`switch15` encodes as `min(n/8, 1)`):
 *
 *   switch15 = 0  (calm)          → risk ≈ 0.17
 *   switch15 = 3  (medium churn)  → risk ≈ 0.67
 *   switch15 ≥ 7  (heavy churn)   → risk ≈ 0.94
 *
 * Which band each lands in is read off `DEFAULT_SETTINGS` and
 * `CLEAR_HYSTERESIS` at run time, never pinned here — the trainer re-derives
 * the thresholds every round and a written-down number goes stale silently.
 * Against the shipped defaults today (clear `nudge − CLEAR_HYSTERESIS` = 0.40,
 * nudge 0.50, pre-arm 0.65) that is: below clear, pre-arm zone, pre-arm zone.
 *
 * Desk noise, dwell and streak can never move the needle in these tests: their
 * hidden weights are zero, so they do not reach the one live unit.
 *
 * The unit is `z = 3.270049·tanh(2·x − 0.532005) + 0.006227`, the curve through
 * those three (x, logit) points. It is strictly increasing on [0, 1] (`tanh` is
 * monotone, the output weight is positive), so a probe at any other switch
 * count still lands where you would expect.
 */
export function switchProbeWeights(): ForecastWeightsFile {
  const hiddenWeights = new Array<number>(FORECAST_HIDDEN_DIM * FORECAST_INPUT_DIM).fill(0);
  const hiddenBias = new Array<number>(FORECAST_HIDDEN_DIM).fill(0);
  const outputWeights = new Array<number>(FORECAST_HIDDEN_DIM).fill(0);
  const switch15 = FORECAST_FEATURE_KEYS.indexOf("switch15");
  hiddenWeights[switch15] = 2; // unit 0, row 0 of the hidden layer
  hiddenBias[0] = -0.532005;
  outputWeights[0] = 3.270049;
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
    layers: {
      hidden: { weights: hiddenWeights, bias: hiddenBias },
      output: { weights: outputWeights, bias: [0.006227] },
    },
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
