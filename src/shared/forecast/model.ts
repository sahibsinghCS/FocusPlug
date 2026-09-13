import { fnv1a32 } from "./hash";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  type ForecastFeatureKey,
  type ForecastLayer,
  type ForecastWeightsFile,
} from "./types";

/**
 * The shipped Focus Forecast head: a single-hidden-layer **tanh MLP** over the
 * encoded features — `FORECAST_INPUT_DIM` → `FORECAST_HIDDEN_DIM` → 1, with
 * `FORECAST_PARAM_COUNT` trainable parameters.
 *
 * The hidden layer is not a design guess. The trainer fits
 * `FORECAST_ENSEMBLE_MEMBERS` independent `d→12→1` members on disjoint
 * cross-validation folds and blends their logits affinely; an affine blend of
 * tanh nets that share one input standardizer collapses EXACTLY into one
 * `d→(members × 12)→1` net, so what ships is a plain two-layer forward pass and
 * not an ensemble loop. `scripts/forecast/train.ts` asserts the collapse to
 * 1e-12 before it writes the artifact.
 *
 * Width is DERIVED from `FORECAST_FEATURE_KEYS`, never written down twice:
 * growing the feature list grows the input layer, renames `FORECAST_BASIS` and
 * moves `FORECAST_BASIS_SHA`, so a weights file fitted on the old basis is
 * rejected rather than silently misread.
 *
 * WHY THIS AND NOT THE 190-PARAMETER GLM IT REPLACED. Round 8's bake-off shipped
 * a pairwise logistic regression because on 48 held-out sessions the paired
 * session-clustered SE of a model-vs-model lead-AUC difference was ≈ 0.009 and
 * nothing non-linear cleared it — an underpowered shrug, and the honest call at
 * the time. Round 10 re-ran the identical contest on a 900-session / 1 230-onset
 * corpus where that SE is 0.0032. The answer inverted: the tuned + bagged MLP
 * beats a plain additive logistic by +0.0082 [+0.0043, +0.0116], beats the
 * strongest linear model by +0.0048 [+0.0005, +0.0095], and beats the GLM that
 * shipped by +0.0122 [+0.0069, +0.0178] — every interval excluding zero. The
 * GLM, meanwhile, FAILED the re-anchored gate on that corpus (−0.0051 against a
 * converged plain 24-feature logistic). See `scripts/forecast/GAUNTLET.md`
 * rounds 10–11 and `docs/FORECAST.md`.
 *
 * Everything here is pure TypeScript with no dependencies:
 *
 *   h_j    = tanh( b1_j + Σ_i W1_ji · x_i )       (one multiply-add per weight)
 *   z      = b2 + Σ_j W2_j · h_j
 *   risk   = σ(a·z + b)                           (Platt, fit on held-out sessions)
 *
 * The z-score standardizer the trainer fitted on the features is FOLDED into
 * the hidden layer (`W1_ji ← θ_ji/s_i`, `b1_j ← β_j − Σ_i θ_ji·m_i/s_i`), so the
 * shipped payload really is `FORECAST_PARAM_COUNT` floats plus the Platt pair —
 * no hidden 2N-float scaler riding alongside an understated parameter count.
 *
 * `parseForecastWeights` is the fail-closed gate: any violation returns null,
 * the monitor stays `ready:false`, and the session runs exactly as today. A
 * corrupt-but-parseable file must never produce a fabricated risk.
 */

/** Feature-vector width — derived, never a literal, so the head follows the keys. */
export const FORECAST_INPUT_DIM = FORECAST_FEATURE_KEYS.length;

/** Bagged members the trainer fits (one per cross-validation fold). */
export const FORECAST_ENSEMBLE_MEMBERS = 3;

/** Hidden width of ONE member, as selected by the mlp-tuned sweep. */
export const FORECAST_MEMBER_HIDDEN_DIM = 12;

/**
 * Hidden width of the SHIPPED net. The members collapse exactly, so this is
 * `members × member width` and the artifact carries one flat layer.
 */
export const FORECAST_HIDDEN_DIM = FORECAST_ENSEMBLE_MEMBERS * FORECAST_MEMBER_HIDDEN_DIM;

/**
 * The shipped basis name. Derived from the two widths, so growing
 * `FORECAST_FEATURE_KEYS` renames the basis AND changes `FORECAST_BASIS_SHA`
 * below — every existing weights file then fails `parseForecastWeights` closed
 * instead of being served against a basis it was not fitted on.
 */
export const FORECAST_BASIS = `mlp${FORECAST_INPUT_DIM}-${FORECAST_HIDDEN_DIM}-1`;

/** Hidden activation. A literal here and in the basis checksum, so it cannot drift silently. */
export const FORECAST_ACTIVATION = "tanh";

/** `H·D` hidden weights + `H` hidden biases + `H` output weights + 1 output bias. */
export const FORECAST_PARAM_COUNT =
  FORECAST_HIDDEN_DIM * FORECAST_INPUT_DIM + FORECAST_HIDDEN_DIM + FORECAST_HIDDEN_DIM + 1;

/**
 * Multiply-accumulates in ONE forward pass — the honest on-device 1 Hz cost,
 * `H·D + H`, plus `H` tanh. Published so the cost claim in the docs is a
 * derived number rather than a remembered one. (The GLM this replaced was
 * 324 MACs; the MLP that shipped before THAT was 228 MACs plus 12 tanh. All
 * three are sub-microsecond — see `docs/FORECAST.md`.)
 */
export const FORECAST_FORWARD_MACS = FORECAST_HIDDEN_DIM * FORECAST_INPUT_DIM + FORECAST_HIDDEN_DIM;

/**
 * Checksum of the shipped architecture: the basis name, the activation and the
 * canonical feature-key order. A weights file carries it, and the parser
 * refuses any file whose architecture does not hash to the same value — so a
 * future change of width, activation or feature order fails closed instead of
 * silently mapping weights onto the wrong inputs.
 */
export const FORECAST_BASIS_SHA = fnv1a32(
  `${FORECAST_BASIS}|${FORECAST_ACTIVATION}|${FORECAST_FEATURE_KEYS.join(",")}`,
)
  .toString(16)
  .padStart(8, "0");

export interface ForecastForward {
  /** Pre-calibration z. */
  logit: number;
  /** Calibrated σ(a·z + b), unsmoothed. */
  rawRisk: number;
  /**
   * The hidden layer's activations, length `FORECAST_HIDDEN_DIM`. These are
   * ANONYMOUS units — a learned basis, not one cell per feature — so the UI
   * labels them as an activation strip and puts the named, signed per-feature
   * numbers in `attributions` instead.
   */
  hidden: number[];
}

export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVector(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

function parseLayer(value: unknown, outDim: number, inDim: number): ForecastLayer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as { weights?: unknown; bias?: unknown };
  if (!isFiniteVector(raw.weights, outDim * inDim) || !isFiniteVector(raw.bias, outDim)) {
    return null;
  }
  return { weights: [...raw.weights], bias: [...raw.bias] };
}

/**
 * Validates an untrusted weights payload against the frozen `ForecastWeightsFile`
 * shape. Null on ANY violation — wrong version, wrong basis, wrong layer shape,
 * non-finite entries, reordered feature keys, degenerate scales. The returned
 * object is a defensive deep copy of the input.
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
  // Architecture identity: the name AND a checksum over width + activation +
  // feature order, so a silent change to any of the three fails closed.
  if (raw.basis !== FORECAST_BASIS || raw.basisSha !== FORECAST_BASIS_SHA) {
    return null;
  }
  const layers = raw.layers as { hidden?: unknown; output?: unknown } | null | undefined;
  if (typeof layers !== "object" || layers === null || Array.isArray(layers)) {
    return null;
  }
  const hidden = parseLayer(layers.hidden, FORECAST_HIDDEN_DIM, FORECAST_INPUT_DIM);
  const output = parseLayer(layers.output, 1, FORECAST_HIDDEN_DIM);
  if (hidden === null || output === null) {
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
    basis: FORECAST_BASIS,
    basisSha: FORECAST_BASIS_SHA,
    layers: { hidden, output },
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
 * Fills `pre` with the hidden pre-activations and returns the logit. Split out
 * so `attributions` can reuse the base pass instead of re-running it 24 times.
 */
function preActivations(
  weights: ForecastWeightsFile,
  encoded: readonly number[],
  pre: number[],
): number {
  const w1 = weights.layers.hidden.weights;
  const b1 = weights.layers.hidden.bias;
  const w2 = weights.layers.output.weights;
  let logit = weights.layers.output.bias[0] ?? 0;
  for (let j = 0; j < FORECAST_HIDDEN_DIM; j += 1) {
    let sum = b1[j] ?? 0;
    const row = j * FORECAST_INPUT_DIM;
    for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
      sum += (w1[row + i] ?? 0) * (encoded[i] ?? 0);
    }
    pre[j] = sum;
    logit += (w2[j] ?? 0) * Math.tanh(sum);
  }
  return logit;
}

/**
 * Forward pass on encoded [0,1] features: one dense layer, tanh, one dot
 * product, Platt-calibrate. Throws on a wrong-length input — callers hold
 * validated weights and a length-`FORECAST_INPUT_DIM` vector by construction
 * (the monitor try/catches every entry point regardless).
 */
export function forward(weights: ForecastWeightsFile, encoded: readonly number[]): ForecastForward {
  if (encoded.length !== FORECAST_INPUT_DIM) {
    throw new Error(
      `forecast forward expects ${FORECAST_INPUT_DIM} features, got ${encoded.length}`,
    );
  }
  const pre = new Array<number>(FORECAST_HIDDEN_DIM);
  const logit = preActivations(weights, encoded, pre);
  const rawRisk = sigmoid(weights.calibration.a * logit + weights.calibration.b);
  return { logit, rawRisk, hidden: pre.map((value) => Math.tanh(value)) };
}

/**
 * Occlusion attribution: `risk(x) − risk(x with feature i at its training
 * mean)`, per feature. Signed; a contribution estimate — the deltas do not sum
 * to the logit, and the UI says so.
 *
 * A hidden layer makes this a genuinely non-linear question, so unlike the GLM
 * this replaced there is no exact closed form as a sum of per-term
 * coefficients: occluding a feature moves EVERY hidden unit. It is still cheap
 * and exact rather than approximate, because replacing `x_f` with `m_f` shifts
 * each pre-activation by exactly `W1_jf · (m_f − x_f)` — so each occluded logit
 * costs `FORECAST_HIDDEN_DIM` multiply-adds and tanh calls off the cached base
 * pre-activations, not a full re-expansion. `model.test.ts` asserts the delta
 * form equals a naive re-forward to 1e-12.
 */
export function attributions(
  weights: ForecastWeightsFile,
  encoded: readonly number[],
): number[] {
  if (encoded.length !== FORECAST_INPUT_DIM) {
    throw new Error(
      `forecast attributions expect ${FORECAST_INPUT_DIM} features, got ${encoded.length}`,
    );
  }
  const pre = new Array<number>(FORECAST_HIDDEN_DIM);
  const baseLogit = preActivations(weights, encoded, pre);
  const { a, b } = weights.calibration;
  const baseRisk = sigmoid(a * baseLogit + b);
  const w1 = weights.layers.hidden.weights;
  const w2 = weights.layers.output.weights;
  const outBias = weights.layers.output.bias[0] ?? 0;
  const out = new Array<number>(FORECAST_INPUT_DIM);
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    const shift = (weights.norm.mean[f] ?? 0) - (encoded[f] ?? 0);
    let logit = outBias;
    for (let j = 0; j < FORECAST_HIDDEN_DIM; j += 1) {
      const occluded = (pre[j] as number) + (w1[j * FORECAST_INPUT_DIM + f] ?? 0) * shift;
      logit += (w2[j] ?? 0) * Math.tanh(occluded);
    }
    out[f] = baseRisk - sigmoid(a * logit + b);
  }
  return out;
}
