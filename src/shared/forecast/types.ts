export const FORECAST_HORIZON_SEC = 30;
export const FORECAST_WARMUP_SEC = 15;
export const FORECAST_MODEL_VERSION = "ff-1";

export type ForecastBand = "calm" | "elevated" | "prearm";

/**
 * Feature keys, in basis order. Indices 0–17 are the original LEVEL block
 * (counts, fractions, means, σ over one fixed window); 18–23 are the TREND
 * block (a slope, two short-vs-long rate ratios, a leaky occupancy, a run
 * length, a two-window drop) that the level aggregates flatten by
 * construction — see `features.ts` for what each one is and why it is here.
 * The list is APPEND-ONLY: an existing index never moves, so a stale
 * `weights.json` fails on `basisSha` rather than silently mapping
 * coefficients onto the wrong inputs.
 */
export type ForecastFeatureKey =
  | "switch15" | "switch60" | "switchAccel" | "dwellCur"
  | "fracAllow60" | "fracOther60" | "otherDwell30" | "distinct60"
  | "sinceBlock" | "streak" | "deskPresent30" | "deskConfMean30"
  | "deskConfStd30" | "deskFlicker60" | "sessionMin" | "priorDrifts"
  | "titleChurn30" | "titleChurn60"
  | "deskSagSlope30" | "dwellShrink30v90" | "titleChurnAccel"
  | "greyLeaky120" | "absenceRun60" | "deskConfDrop120";

export const FORECAST_FEATURE_KEYS: readonly ForecastFeatureKey[] = [
  "switch15", "switch60", "switchAccel", "dwellCur",
  "fracAllow60", "fracOther60", "otherDwell30", "distinct60",
  "sinceBlock", "streak", "deskPresent30", "deskConfMean30",
  "deskConfStd30", "deskFlicker60", "sessionMin", "priorDrifts",
  "titleChurn30", "titleChurn60",
  "deskSagSlope30", "dwellShrink30v90", "titleChurnAccel",
  "greyLeaky120", "absenceRun60", "deskConfDrop120",
];

export interface ForecastFeatureView {
  key: ForecastFeatureKey;
  raw: number;          // human units (e.g. 6 switches, 18 s)
  value: number;        // encoded [0,1], pre-normalization
  attribution: number;  // signed occlusion delta on calibrated risk
}

export interface ForecastSnapshot {
  ts: number;
  ready: boolean;
  warmupRemainingSec: number;   // 0 when ready
  risk: number;                 // EMA-smoothed calibrated risk
  rawRisk: number;              // calibrated, unsmoothed
  logit: number;                // pre-calibration z
  band: ForecastBand;
  horizonSec: number;           // FORECAST_HORIZON_SEC
  features: ForecastFeatureView[]; // one per FORECAST_FEATURE_KEYS entry, in that order
  hidden: number[];             // the head's hidden activations, whatever length the shipped
                                // head has (FORECAST_HIDDEN_DIM): tanh pre-activations of the
                                // collapsed 24→36→1 net. Anonymous units, and the UI says so.
  prearmedAt: number | null;    // epoch ms, null unless pre-armed
  effectiveFuseSec: number;     // countdownSec policy sees this step (latched during a burn)
  baseFuseSec: number;          // settings.countdownSec
  modelVersion: string;         // FORECAST_MODEL_VERSION
  paramCount: number;           // FORECAST_PARAM_COUNT
}

export type ForecastEvent =
  | { type: "forecast_nudge"; ts: number; risk: number; topFeatures: ForecastFeatureKey[] }
  | { type: "forecast_prearm"; ts: number; risk: number; fuseSec: number }
  | { type: "forecast_clear"; ts: number; risk: number; wasPrearmed: boolean }
  | { type: "forecast_hit"; ts: number; leadSec: number }
  | { type: "forecast_miss"; ts: number };

export type DriftType = "tab_out" | "walk_away";

/**
 * One dense layer of the shipped head, row-major. `weights` is
 * `outDim × inDim`; `bias` is `outDim`. The shapes are DERIVED from
 * `FORECAST_FEATURE_KEYS` and `FORECAST_HIDDEN_DIM` in `model.ts`, and a
 * weights file whose layer shapes disagree fails `parseForecastWeights`
 * closed rather than being served against a basis it was not fitted on.
 */
export interface ForecastLayer {
  weights: number[];
  bias: number[];
}

/** Shape of src/shared/forecast/weights.json. parseForecastWeights returns null on any violation. */
export interface ForecastWeightsFile {
  version: string;              // "ff-1"
  createdAt: string;            // ISO
  seed: number;
  featureKeys: ForecastFeatureKey[];       // must deep-equal FORECAST_FEATURE_KEYS
  norm: { mean: number[]; scale: number[] }; // one entry per feature — train-split stats.
                                // `mean` is the occlusion baseline the attributions use;
                                // `scale` is published dispersion. The model's own
                                // z-score standardizer is FOLDED into the hidden layer,
                                // so the forward pass needs neither.
  basis: string;                // FORECAST_BASIS — `mlp{FORECAST_INPUT_DIM}-{FORECAST_HIDDEN_DIM}-1`
  basisSha: string;             // FORECAST_BASIS_SHA: fnv1a32 of arch + activation + feature keys
  layers: {
    hidden: ForecastLayer;      // weights FORECAST_HIDDEN_DIM × FORECAST_INPUT_DIM (row-major),
                                // bias FORECAST_HIDDEN_DIM — tanh; standardizer folded in
    output: ForecastLayer;      // weights 1 × FORECAST_HIDDEN_DIM, bias 1 — linear logit;
                                // the bagged blend's affine mix is folded in
  };
  calibration: { a: number; b: number };   // Platt, fit on held-out calibration sessions
  horizonSec: number;           // 30
  thresholds: { nudge: number; prearm: number; clear: number }; // evaluated operating point;
                                // eval.ts asserts nudge/prearm match DEFAULT_SETTINGS forecast keys
  paramCount: number;           // FORECAST_PARAM_COUNT = every float in `layers`
  trainProvenanceSha: string;   // sha256 of embedded provenance in eval-report.json
}

/** Optional seam on SessionControllerOptions. Called once per evaluateOnce, before
 * buildPolicyInput, only on the active-session path. Returns the countdownSec policy
 * should see this step, or null for "no override" (controller uses settings.countdownSec).
 * Pure read of latched monitor state; must never throw (implementations try/catch). */
export interface ForecastHook {
  beforeStep(now: number, baseCountdownSec: number): number | null;
}

/** Main-process fan-out for forecast channels (SessionPush is NOT modified). */
export interface ForecastPush {
  snapshot(snap: ForecastSnapshot): void;
  event(event: ForecastEvent): void;
}
