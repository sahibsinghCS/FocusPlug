import { fnv1a32 } from "./hash";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  type ForecastFeatureKey,
  type ForecastTerm,
  type ForecastWeightsFile,
} from "./types";

/**
 * The shipped Focus Forecast head: an L2-regularized multivariate LOGISTIC
 * REGRESSION over the 18 encoded features plus every pairwise product and
 * square — 189 basis terms, 190 trainable parameters (189 coefficients + one
 * intercept). It is a GLM: linear in its basis, convex, one global optimum.
 *
 * Why this and not the 18→12→1 TinyMLP that shipped before: the bake-off in
 * `scripts/forecast/GAUNTLET.md` scored five model families on one fixed
 * dataset and one fixed metric. Nothing non-linear beat the strongest linear
 * result by a margin this eval set can resolve (paired session-clustered SE
 * ≈ 0.009 on 48 held-out sessions), while a plain 19-parameter logistic
 * already beat the MLP on the headline metric. So the simpler, convex,
 * readable model ships and the honest gate is published beside it.
 *
 * Everything here is pure TypeScript with no dependencies:
 *
 *   z      = intercept + Σ_k c_k · t_k(x)          (189 multiply-adds)
 *   risk   = σ(a·z + b)                            (Platt, fit on validation)
 *
 * The standardizer the trainer fitted on the expanded design is FOLDED into
 * `coefficients` / `intercept` (c_k = θ_k/s_k, intercept = b − Σ θ_k m_k/s_k),
 * so the shipped payload really is 190 floats plus the Platt pair.
 *
 * `parseForecastWeights` is the fail-closed gate: any violation returns null,
 * the monitor stays `ready:false`, and the session runs exactly as today. A
 * corrupt-but-parseable file must never produce a fabricated risk.
 */

export const FORECAST_INPUT_DIM = 18;

/** The shipped basis. Bumping this invalidates every existing weights file. */
export const FORECAST_BASIS = "lr18+pairwise";

/**
 * Canonical basis order: the 18 linear terms in `FORECAST_FEATURE_KEYS`
 * order, then every product `x_i · x_j` for `i ≤ j` in lexicographic order
 * (171 of them, squares included). The trainer imports this list, so the
 * column order can never disagree between fitting and serving.
 */
export const FORECAST_TERMS: readonly ForecastTerm[] = buildTerms();

function buildTerms(): ForecastTerm[] {
  const terms: ForecastTerm[] = [];
  for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
    terms.push({ i, j: null });
  }
  for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
    for (let j = i; j < FORECAST_INPUT_DIM; j += 1) {
      terms.push({ i, j });
    }
  }
  return terms;
}

/** 18 linear + 171 products/squares = 189. */
export const FORECAST_TERM_COUNT = FORECAST_TERMS.length;

/** 189 coefficients + 1 intercept = 190 trainable parameters. */
export const FORECAST_PARAM_COUNT = FORECAST_TERM_COUNT + 1;

/** Human-readable term names, same order — `deskConfMean30*deskConfStd30`, `otherDwell30^2`, … */
export const FORECAST_TERM_KEYS: readonly string[] = FORECAST_TERMS.map((term) =>
  termName(term, FORECAST_FEATURE_KEYS),
);

export function termName(term: ForecastTerm, keys: readonly string[]): string {
  if (term.j === null) {
    return keys[term.i] as string;
  }
  return term.i === term.j ? `${keys[term.i]}^2` : `${keys[term.i]}*${keys[term.j]}`;
}

/**
 * Checksum of the canonical basis. A weights file carries it, and the parser
 * refuses any file whose basis does not hash to the same value — so a future
 * reordering of `FORECAST_TERMS` fails closed instead of silently mapping
 * coefficients onto the wrong products.
 */
export const FORECAST_BASIS_SHA = fnv1a32(
  `${FORECAST_BASIS}|${FORECAST_TERM_KEYS.join(",")}`,
)
  .toString(16)
  .padStart(8, "0");

/** Term indices touching each feature: 1 linear + 18 products = 19 per feature. */
const TERMS_BY_FEATURE: ReadonlyArray<readonly number[]> = buildTermsByFeature();

function buildTermsByFeature(): number[][] {
  const out: number[][] = Array.from({ length: FORECAST_INPUT_DIM }, () => []);
  FORECAST_TERMS.forEach((term, index) => {
    (out[term.i] as number[]).push(index);
    if (term.j !== null && term.j !== term.i) {
      (out[term.j] as number[]).push(index);
    }
  });
  return out;
}

export interface ForecastForward {
  /** Pre-calibration z. */
  logit: number;
  /** Calibrated σ(a·z + b), unsmoothed. */
  rawRisk: number;
  /**
   * Term-group activations, length 18: `tanh` of the summed signed
   * contribution of every basis term containing that feature. Product terms
   * count toward BOTH of their features, so these do not sum to the logit —
   * the UI labels them as an activation strip, not a decomposition.
   */
  hidden: number[];
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Expands an encoded 18-vector into the 189 canonical basis values. Shared by
 * the trainer (`scripts/forecast/train.ts`) and runtime inference — the same
 * train/serve-skew guarantee `extractFeatures` gives the features themselves.
 */
export function expandBasis(
  encoded: readonly number[],
  out: number[] | Float64Array,
): void {
  for (let k = 0; k < FORECAST_TERM_COUNT; k += 1) {
    const term = FORECAST_TERMS[k] as ForecastTerm;
    const xi = encoded[term.i] ?? 0;
    out[k] = term.j === null ? xi : xi * (encoded[term.j] ?? 0);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVector(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

/**
 * Validates an untrusted weights payload against the frozen `ForecastWeightsFile`
 * shape. Null on ANY violation — wrong version, wrong basis, wrong term count,
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
  // Basis identity: the name AND a checksum of the canonical term list, so a
  // silent reordering of FORECAST_TERMS can never be served with old weights.
  if (raw.basis !== FORECAST_BASIS || raw.basisSha !== FORECAST_BASIS_SHA) {
    return null;
  }
  if (!isFiniteVector(raw.coefficients, FORECAST_TERM_COUNT)) {
    return null;
  }
  if (!isFiniteNumber(raw.intercept)) {
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
    coefficients: [...raw.coefficients],
    intercept: raw.intercept,
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
 * Forward pass on encoded [0,1] features: expand into the 189-term basis, one
 * dot product, Platt-calibrate. Throws on a wrong-length input — callers hold
 * validated weights and a length-18 vector by construction (the monitor
 * try/catches every entry point regardless).
 */
export function forward(weights: ForecastWeightsFile, encoded: readonly number[]): ForecastForward {
  if (encoded.length !== FORECAST_INPUT_DIM) {
    throw new Error(`forecast forward expects ${FORECAST_INPUT_DIM} features, got ${encoded.length}`);
  }
  const coefficients = weights.coefficients;
  const groups = new Array<number>(FORECAST_INPUT_DIM).fill(0);
  let logit = weights.intercept;
  for (let k = 0; k < FORECAST_TERM_COUNT; k += 1) {
    const term = FORECAST_TERMS[k] as ForecastTerm;
    const xi = encoded[term.i] ?? 0;
    const value = term.j === null ? xi : xi * (encoded[term.j] ?? 0);
    const contribution = (coefficients[k] ?? 0) * value;
    logit += contribution;
    groups[term.i] = (groups[term.i] as number) + contribution;
    if (term.j !== null && term.j !== term.i) {
      groups[term.j] = (groups[term.j] as number) + contribution;
    }
  }
  const rawRisk = sigmoid(weights.calibration.a * logit + weights.calibration.b);
  return { logit, rawRisk, hidden: groups.map((value) => Math.tanh(value)) };
}

/**
 * Occlusion attribution: `risk(x) − risk(x with feature i at its training
 * mean)`, per feature. Signed; a contribution estimate — the deltas do not
 * sum to the logit, the UI says so.
 *
 * The GLM makes this exact AND cheap: replacing x_i touches only the 19 terms
 * that contain feature i, so each occluded logit is the base logit minus a
 * 19-term delta rather than a full re-expansion. `model.test.ts` asserts the
 * delta form equals a naive re-forward to 1e-12.
 */
export function attributions(
  weights: ForecastWeightsFile,
  encoded: readonly number[],
): number[] {
  const base = forward(weights, encoded);
  const { a, b } = weights.calibration;
  const coefficients = weights.coefficients;
  const out = new Array<number>(FORECAST_INPUT_DIM);
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    const xf = encoded[f] ?? 0;
    const mf = weights.norm.mean[f] ?? 0;
    let delta = 0;
    for (const k of TERMS_BY_FEATURE[f] as readonly number[]) {
      const term = FORECAST_TERMS[k] as ForecastTerm;
      const coefficient = coefficients[k] ?? 0;
      if (term.j === null) {
        delta += coefficient * (xf - mf);
      } else if (term.i === term.j) {
        delta += coefficient * (xf * xf - mf * mf);
      } else {
        const other = encoded[term.i === f ? term.j : term.i] ?? 0;
        delta += coefficient * other * (xf - mf);
      }
    }
    out[f] = base.rawRisk - sigmoid(a * (base.logit - delta) + b);
  }
  return out;
}
