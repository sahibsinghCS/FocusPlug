import {
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
 * whose risk responds ONLY to `switch15`, through two saturating hidden
 * units, so escalation arcs are exactly scriptable from proc-switch counts:
 *
 *   switch15 = 0  (calm)          → risk ≈ 0.17   (below clear at 0.45)
 *   switch15 = 3  (medium churn)  → risk ≈ 0.67   (nudge zone, < pre-arm 0.80)
 *   switch15 ≥ 7  (heavy churn)   → risk ≈ 0.94   (pre-arm zone)
 *
 * All other features carry zero weight, so desk noise, dwell, and streak can
 * never move the needle in these tests.
 */
export function switchProbeWeights(): ForecastWeightsFile {
  const w1: number[][] = [];
  const b1: number[] = [];
  for (let j = 0; j < FORECAST_HIDDEN_DIM; j += 1) {
    const row = new Array<number>(FORECAST_INPUT_DIM).fill(0);
    if (j === 0) {
      row[0] = 4; // medium detector: tanh(4·x − 1)
    }
    if (j === 1) {
      row[0] = 10; // heavy detector: tanh(10·x − 6)
    }
    w1.push(row);
    b1.push(j === 0 ? -1 : j === 1 ? -6 : 0);
  }
  const w2 = new Array<number>(FORECAST_HIDDEN_DIM).fill(0);
  w2[0] = 1.86;
  w2[1] = 0.565;
  return {
    version: FORECAST_MODEL_VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
    seed: 7,
    featureKeys: [...FORECAST_FEATURE_KEYS] as ForecastFeatureKey[],
    norm: {
      mean: new Array<number>(FORECAST_INPUT_DIM).fill(0),
      scale: new Array<number>(FORECAST_INPUT_DIM).fill(1),
    },
    layers: [
      { W: w1, b: b1 },
      { W: [w2], b: [0.394] },
    ],
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
