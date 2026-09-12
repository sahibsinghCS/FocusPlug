export const FORECAST_HORIZON_SEC = 30;
export const FORECAST_WARMUP_SEC = 15;
export const FORECAST_MODEL_VERSION = "ff-1";

export type ForecastBand = "calm" | "elevated" | "prearm";

export type ForecastFeatureKey =
  | "switch15" | "switch60" | "switchAccel" | "dwellCur"
  | "fracAllow60" | "fracOther60" | "otherDwell30" | "distinct60"
  | "sinceBlock" | "streak" | "deskPresent30" | "deskConfMean30"
  | "deskConfStd30" | "deskFlicker60" | "sessionMin" | "priorDrifts"
  | "titleChurn30" | "titleChurn60";

export const FORECAST_FEATURE_KEYS: readonly ForecastFeatureKey[] = [
  "switch15", "switch60", "switchAccel", "dwellCur",
  "fracAllow60", "fracOther60", "otherDwell30", "distinct60",
  "sinceBlock", "streak", "deskPresent30", "deskConfMean30",
  "deskConfStd30", "deskFlicker60", "sessionMin", "priorDrifts",
  "titleChurn30", "titleChurn60",
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
  features: ForecastFeatureView[]; // length 18, FORECAST_FEATURE_KEYS order
  hidden: number[];             // length 12, tanh activations
  prearmedAt: number | null;    // epoch ms, null unless pre-armed
  effectiveFuseSec: number;     // countdownSec policy sees this step (latched during a burn)
  baseFuseSec: number;          // settings.countdownSec
  modelVersion: string;         // FORECAST_MODEL_VERSION
  paramCount: number;           // 241
}

export type ForecastEvent =
  | { type: "forecast_nudge"; ts: number; risk: number; topFeatures: ForecastFeatureKey[] }
  | { type: "forecast_prearm"; ts: number; risk: number; fuseSec: number }
  | { type: "forecast_clear"; ts: number; risk: number; wasPrearmed: boolean }
  | { type: "forecast_hit"; ts: number; leadSec: number }
  | { type: "forecast_miss"; ts: number };

export type DriftType = "tab_out" | "walk_away";

/** Shape of src/shared/forecast/weights.json. parseForecastWeights returns null on any violation. */
export interface ForecastWeightsFile {
  version: string;              // "ff-1"
  createdAt: string;            // ISO
  seed: number;
  featureKeys: ForecastFeatureKey[];       // must deep-equal FORECAST_FEATURE_KEYS
  norm: { mean: number[]; scale: number[] }; // length 18 each
  layers: [
    { W: number[][]; b: number[] },        // 12x18, 12
    { W: number[][]; b: number[] },        // 1x12, 1
  ];
  calibration: { a: number; b: number };   // Platt, fit on validation
  horizonSec: number;           // 30
  thresholds: { nudge: number; prearm: number; clear: number }; // evaluated operating point;
                                // eval.ts asserts nudge/prearm match DEFAULT_SETTINGS forecast keys
  paramCount: number;           // 241
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
