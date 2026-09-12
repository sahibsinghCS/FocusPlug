import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  type ForecastFeatureKey,
  type ForecastWeightsFile,
} from "./types";

/**
 * TinyMLP 18→12→1, 241 params — hand-rolled forward pass, weights shipped as
 * JSON. `parseForecastWeights` is the fail-closed gate: any violation returns
 * null, the monitor stays `ready:false`, and the session runs exactly as
 * today. A corrupt-but-parseable file must never produce a fabricated risk.
 */

export const FORECAST_INPUT_DIM = 18;
export const FORECAST_HIDDEN_DIM = 12;
/** 12×18 + 12 + 1×12 + 1 = 241 trainable parameters. */
export const FORECAST_PARAM_COUNT = 241;

export interface ForecastForward {
  /** Pre-calibration z. */
  logit: number;
  /** Calibrated σ(a·z + b), unsmoothed. */
  rawRisk: number;
  /** tanh activations, length 12. */
  hidden: number[];
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVector(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

function isFiniteMatrix(value: unknown, rows: number, cols: number): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length === rows &&
    value.every((row) => isFiniteVector(row, cols))
  );
}

/**
 * Validates an untrusted weights payload against the frozen `ForecastWeightsFile`
 * shape. Null on ANY violation — wrong version, wrong dimensions, non-finite
 * entries, reordered feature keys, degenerate scales. The returned object is
 * a defensive deep copy of the input.
 */
export function parseForecastWeights(value: unknown): ForecastWeightsFile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== FORECAST_MODEL_VERSION) {
    return null;
  }
  if (typeof raw.createdAt !== "string") {
    return null;
  }
  if (!isFiniteNumber(raw.seed)) {
    return null;
  }
  // featureKeys must deep-equal FORECAST_FEATURE_KEYS — same names, same
  // order. A reordered file would silently map features to wrong weights.
  const featureKeys = raw.featureKeys;
  if (
    !Array.isArray(featureKeys) ||
    featureKeys.length !== FORECAST_FEATURE_KEYS.length ||
    !featureKeys.every((key, i) => key === FORECAST_FEATURE_KEYS[i])
  ) {
    return null;
  }
  const norm = raw.norm as { mean?: unknown; scale?: unknown } | null | undefined;
  if (
    typeof norm !== "object" ||
    norm === null ||
    !isFiniteVector(norm.mean, FORECAST_INPUT_DIM) ||
    !isFiniteVector(norm.scale, FORECAST_INPUT_DIM) ||
    !norm.scale.every((scale) => scale > 0)
  ) {
    return null;
  }
  const layers = raw.layers;
  if (!Array.isArray(layers) || layers.length !== 2) {
    return null;
  }
  const layer0 = layers[0] as { W?: unknown; b?: unknown } | null | undefined;
  const layer1 = layers[1] as { W?: unknown; b?: unknown } | null | undefined;
  if (
    typeof layer0 !== "object" ||
    layer0 === null ||
    !isFiniteMatrix(layer0.W, FORECAST_HIDDEN_DIM, FORECAST_INPUT_DIM) ||
    !isFiniteVector(layer0.b, FORECAST_HIDDEN_DIM)
  ) {
    return null;
  }
  if (
    typeof layer1 !== "object" ||
    layer1 === null ||
    !isFiniteMatrix(layer1.W, 1, FORECAST_HIDDEN_DIM) ||
    !isFiniteVector(layer1.b, 1)
  ) {
    return null;
  }
  const calibration = raw.calibration as { a?: unknown; b?: unknown } | null | undefined;
  if (
    typeof calibration !== "object" ||
    calibration === null ||
    !isFiniteNumber(calibration.a) ||
    !isFiniteNumber(calibration.b)
  ) {
    return null;
  }
  if (raw.horizonSec !== FORECAST_HORIZON_SEC) {
    return null;
  }
  const thresholds = raw.thresholds as
    | { nudge?: unknown; prearm?: unknown; clear?: unknown }
    | null
    | undefined;
  if (
    typeof thresholds !== "object" ||
    thresholds === null ||
    !isFiniteNumber(thresholds.nudge) ||
    !isFiniteNumber(thresholds.prearm) ||
    !isFiniteNumber(thresholds.clear) ||
    thresholds.nudge < 0 ||
    thresholds.nudge > 1 ||
    thresholds.prearm < 0 ||
    thresholds.prearm > 1 ||
    thresholds.clear < 0 ||
    thresholds.clear > 1
  ) {
    return null;
  }
  if (raw.paramCount !== FORECAST_PARAM_COUNT) {
    return null;
  }
  if (typeof raw.trainProvenanceSha !== "string") {
    return null;
  }
  return {
    version: FORECAST_MODEL_VERSION,
    createdAt: raw.createdAt,
    seed: raw.seed,
    featureKeys: [...FORECAST_FEATURE_KEYS] as ForecastFeatureKey[],
    norm: { mean: [...norm.mean], scale: [...norm.scale] },
    layers: [
      { W: layer0.W.map((row) => [...row]), b: [...layer0.b] },
      { W: layer1.W.map((row) => [...row]), b: [...layer1.b] },
    ],
    calibration: { a: calibration.a, b: calibration.b },
    horizonSec: FORECAST_HORIZON_SEC,
    thresholds: {
      nudge: thresholds.nudge,
      prearm: thresholds.prearm,
      clear: thresholds.clear,
    },
    paramCount: FORECAST_PARAM_COUNT,
    trainProvenanceSha: raw.trainProvenanceSha,
  };
}

/**
 * Forward pass on encoded [0,1] features: normalize, tanh hidden layer,
 * linear logit, Platt-calibrated risk. Throws on a wrong-length input —
 * callers hold validated weights and a length-18 vector by construction
 * (the monitor try/catches every entry point regardless).
 */
export function forward(weights: ForecastWeightsFile, encoded: readonly number[]): ForecastForward {
  if (encoded.length !== FORECAST_INPUT_DIM) {
    throw new Error(`forecast forward expects ${FORECAST_INPUT_DIM} features, got ${encoded.length}`);
  }
  const x = new Array<number>(FORECAST_INPUT_DIM);
  for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
    const scale = weights.norm.scale[i] ?? 1;
    x[i] = ((encoded[i] ?? 0) - (weights.norm.mean[i] ?? 0)) / (scale > 0 ? scale : 1);
  }
  const layer0 = weights.layers[0];
  const layer1 = weights.layers[1];
  const hidden = new Array<number>(FORECAST_HIDDEN_DIM);
  for (let j = 0; j < FORECAST_HIDDEN_DIM; j += 1) {
    let sum = layer0.b[j] ?? 0;
    const row = layer0.W[j] ?? [];
    for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
      sum += (row[i] ?? 0) * (x[i] ?? 0);
    }
    hidden[j] = Math.tanh(sum);
  }
  let logit = layer1.b[0] ?? 0;
  const outRow = layer1.W[0] ?? [];
  for (let j = 0; j < FORECAST_HIDDEN_DIM; j += 1) {
    logit += (outRow[j] ?? 0) * (hidden[j] ?? 0);
  }
  const rawRisk = sigmoid(weights.calibration.a * logit + weights.calibration.b);
  return { logit, rawRisk, hidden };
}

/**
 * Occlusion attribution: `risk(x) − risk(x with feature i at its training
 * mean)`, per feature. Signed; a contribution estimate — the deltas do not
 * sum to the logit, the UI says so. 18 extra forward passes, microseconds.
 */
export function attributions(
  weights: ForecastWeightsFile,
  encoded: readonly number[],
): number[] {
  const base = forward(weights, encoded).rawRisk;
  const out = new Array<number>(FORECAST_INPUT_DIM);
  const probe = [...encoded];
  for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
    const kept = probe[i] ?? 0;
    probe[i] = weights.norm.mean[i] ?? 0;
    out[i] = base - forward(weights, probe).rawRisk;
    probe[i] = kept;
  }
  return out;
}
