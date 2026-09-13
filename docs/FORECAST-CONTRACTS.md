# Focus Forecast — Frozen-Contracts Appendix (exact)

`src/shared/types.ts` receives ZERO changes (byte-locked by `scripts/check-contracts.mjs` against the docs/CONTRACTS.md Types fence). Everything below is additive, outside the fence.

## 1. New shared types — `src/shared/forecast/types.ts` (complete source)

```ts
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
```

Escalation reducer (in `src/shared/forecast/escalate.ts`, exported constants):

```ts
export const NUDGE_SUSTAIN_TICKS = 3;
export const PREARM_SUSTAIN_TICKS = 2;
export const CLEAR_SUSTAIN_TICKS = 5;
export const NUDGE_COOLDOWN_SEC = 30;
export const CLEAR_HYSTERESIS = 0.10;      // clear threshold = nudgeRisk - 0.10
export const PREARM_FUSE_FLOOR_SEC = 3;
export const RISK_EMA_ALPHA = 0.5;

export interface EscalationSettings {
  nudgeRisk: number;      // settings.forecastNudgeRisk
  prearmRisk: number;     // settings.forecastPrearmRisk
  prearmEnabled: boolean; // settings.forecastPrearmEnabled
  prearmFuseSec: number;  // settings.forecastPrearmFuseSec
  baseFuseSec: number;    // settings.countdownSec
}

export interface EscalationState {
  band: ForecastBand;
  ticksAboveNudge: number;
  ticksAbovePrearm: number;
  ticksBelowClear: number;
  lastNudgeAt: number | null;
  prearmedAt: number | null;
  latchedFuseSec: number | null; // non-null exactly while a policy countdown burns
  drifted: boolean;              // decision currently DISTRACTED/AWAY
}

export interface EscalationInput {
  ts: number;
  risk: number;          // smoothed
  ready: boolean;
  decision: Decision;    // from tapped status events
  countdownActive: boolean;
  policySignal: "start_countdown" | "cancel_countdown" | "kill" | "unlock" | null;
  settings: EscalationSettings;
}

export function stepEscalation(
  state: EscalationState,
  input: EscalationInput,
): { state: EscalationState; events: ForecastEvent[] };

/** max(3, min(baseFuseSec, prearmFuseSec)) while pre-armed; latchedFuseSec wins while burning; null otherwise. */
export function effectiveFuseSec(state: EscalationState, settings: EscalationSettings): number | null;
```

## 2. IPC additions — `src/shared/ipc.ts` (exact strings)

```ts
// IPC_INVOKE addition
FORECAST_GET_STATE: "focusplug:forecast:getState",   // args: [] → ForecastSnapshot | null

// IPC_PUSH additions
FORECAST_SNAPSHOT: "focusplug:forecast:snapshot",    // ForecastSnapshot, 1 Hz + band changes
FORECAST_EVENT: "focusplug:forecast:event",          // ForecastEvent

// IpcInvokeChannelMap entry
"focusplug:forecast:getState": { args: []; result: ForecastSnapshot | null };

// IpcPushChannelMap entries
"focusplug:forecast:snapshot": ForecastSnapshot;
"focusplug:forecast:event": ForecastEvent;

// FocusPlugApi additions
forecastGetState(): Promise<ForecastSnapshot | null>;
onForecastSnapshot(cb: (snap: ForecastSnapshot) => void): () => void;
onForecastEvent(cb: (event: ForecastEvent) => void): () => void;
```
`src/shared/ipc.ts` re-exports `ForecastSnapshot`, `ForecastEvent`, `ForecastBand` from `./forecast/types`. Preload (`src/preload/index.ts` + `index.d.ts`) and `src/renderer/src/lib/mockApi.ts` mirror the existing channel plumbing. There is no forecast settings invoke — settings flow through the existing `focusplug:settings:set` patch.

## 3. Settings keys — `AppSettings` in `src/shared/ipc.ts` (flat, house style)

| key | type | default | normalizeSettings clamp (src/main/store/appStore.ts) |
|---|---|---|---|
| `forecastEnabled` | boolean | `true` | boolean else default |
| `forecastPrearmEnabled` | boolean | `true` | boolean else default |
| `forecastNudgeRisk` | number | `0.50` | finite → clamp [0.05, 0.90] else default |
| `forecastPrearmRisk` | number | `0.65` | finite → clamp [0.10, 0.95] else default; then raised to ≥ forecastNudgeRisk + 0.05 |
| `forecastPrearmFuseSec` | number | `5` | finite → Math.round, clamp [3, 600] else default (runtime additionally caps at settings.countdownSec) |

`DEFAULT_SETTINGS` in `src/shared/defaults.ts` gains all five. `requirePatch` in `src/main/session/controller.ts` gains matching finite-number/boolean validations in the existing style. `eval.ts` asserts `weights.thresholds.nudge === DEFAULT_SETTINGS.forecastNudgeRisk && weights.thresholds.prearm === DEFAULT_SETTINGS.forecastPrearmRisk` (operating-point parity). **Amended after the bake-off (round 8):** `forecastNudgeRisk` moved `0.55 → 0.45`. **Amended again after the model swap (round 11):** `forecastNudgeRisk` `0.45 → 0.50` and `forecastPrearmRisk` `0.80 → 0.65`. Neither value is a design guess — `train.ts` re-selects BOTH on 3-fold cross-fitted TRAIN sessions (192 sessions, 242 onsets) in two stages, each against the budget that governs it (nudge line: recall@30 s under an alarm-load ratio ceiling; pre-arm line: pre-arm recall@30 s under the < 2 false pre-arms/hour budget and a floor on the nudge line's recall). It prints a WARN when `DEFAULT_SETTINGS` disagrees with its pick, and records the whole search grid in the provenance embedded in `eval-report.json`. The pre-arm axis had to move: 0.80 was a cut on the previous GLM's risk scale, and the MLP that ships now scores 0.3358 pre-arm recall there against 0.5748 at its own re-derived line.

## 4. Dataset JSONL schema — `data/forecast/dataset.jsonl` (one object per 1 Hz frame)

Fields: `v` (schema version, 1) · `session_id` (string; split key) · `source` ∈ `"synthetic" | "recorded" | "augmented:local" | "augmented:adaption" | "invented:adaption"` · `archetype` (string; `"unknown"` for recorded) · `split` ∈ `"train" | "eval"` (assigned per SESSION, never per frame) · `t` (seconds since session start) · `features` (one float per `FORECAST_FEATURE_KEYS` entry — 24 today, in that order, encoded pre-normalization; the key list is APPEND-ONLY so an existing index never moves) · `raw` (human-unit map, debugging + prompt building) · `label` (0|1: drift onset within next 30 s) · `secs_to_drift` (number|null) · `drift_type` (`"tab_out" | "walk_away" | null`) · `prompt` (string; deterministic compact serialization for Adaption `column_mapping`) · `completion` (`"DRIFT" | "STAY"`).

Example line (single line in the file):

```json
{"v":1,"session_id":"syn-000096","source":"synthetic","archetype":"burst_switcher","split":"train","t":169,"features":[0.625,0.5,0.485849,0.247733,0.8,0.2,0.4,0.625,0,0.211463,1,0.873633,0.219496,0,0.056333,0,0.666667,0.375,0.08931,0.708716,0.432292,0.118369,0,0],"raw":{"switch15":5,"switch60":10,"switchAccel":1.9434,"dwellCur":3.88,"fracAllow60":0.8,"fracOther60":0.2,"otherDwell30":12,"distinct60":5,"sinceBlock":600,"streak":3.88,"deskPresent30":1,"deskConfMean30":0.8736,"deskConfStd30":0.0549,"deskFlicker60":0,"sessionMin":2.8167,"priorDrifts":0,"titleChurn30":8,"titleChurn60":9,"deskSagSlope30":0.1072,"dwellShrink30v90":2.8349,"titleChurnAccel":1.7292,"greyLeaky120":0.1184,"absenceRun60":0,"deskConfDrop120":0},"label":1,"secs_to_drift":18,"drift_type":"tab_out","prompt":"fp-forecast v1 | sw15=5 sw60=10 acc=1.94 dwell=3.88 allow60=0.8 other60=0.2 od30=12 dis=5 sb=600 stk=3.88 dp30=1 dc30=0.87 ds30=0.05 df60=0 min=2.82 pd=0 tc30=8 tc60=9 sag=0.11 dsh=2.83 tca=1.73 gl120=0.12 arun=0 dcd=0","completion":"DRIFT"}
```

The `prompt` short names, in `FORECAST_FEATURE_KEYS` order (`scripts/forecast/lib.ts`, `PROMPT_FIELDS`): `sw15 sw60 acc dwell allow60 other60 od30 dis sb stk dp30 dc30 ds30 df60 min pd tc30 tc60` for the level block, then `sag dsh tca gl120 arun dcd` for the trend block. `lib.encodeRaw` re-encodes a parsed prompt with the same formulas `extractFeatures` uses and `build-dataset.ts` asserts the two agree to 1e-9 on every run; `lib.RAW_BOUNDS` gives a `[min, max]` in human units for EVERY key and `rawInBounds` throws if the table ever misses one, so a new feature cannot ship without a validation range for untrusted downloaded rows.

Recorder output (`<userData>/forecast-sessions/<sessionId>.jsonl`, `FOCUSPLUG_FORECAST_RECORD=1`): same frame fields with `label`/`secs_to_drift`/`drift_type` as `null` (filled offline by build-dataset) and process/title identity present only as FNV-1a hashes (`procHash`, `titleHash`) — never raw strings.

## 5. npm scripts — `package.json` (exact)

```json
"forecast:simulate":         "tsx --tsconfig tsconfig.node.json scripts/forecast/simulate.ts",
"forecast:data":             "tsx --tsconfig tsconfig.node.json scripts/forecast/build-dataset.ts",
"forecast:evalset":          "tsx --tsconfig tsconfig.node.json scripts/forecast/build-evalset.ts",
"forecast:train":            "tsx --tsconfig tsconfig.node.json scripts/forecast/train.ts",
"forecast:eval":             "node --max-old-space-size=8192 --import tsx scripts/forecast/eval.ts",
"forecast:pipeline":         "npm run forecast:simulate && npm run forecast:data && npm run forecast:evalset && npm  ...",
"forecast:holdout:bakeoff":  "node --max-old-space-size=12288 --import tsx scripts/forecast/holdout-bakeoff.ts",
"forecast:bakeoff:publish":  "tsx --tsconfig tsconfig.node.json scripts/forecast/bakeoff-publish.ts",
"forecast:features":         "tsx --tsconfig tsconfig.node.json scripts/forecast/feature-mine.ts",
"forecast:features:abtest":  "tsx --tsconfig tsconfig.node.json scripts/forecast/feature-abtest.ts",
"forecast:fixtures":         "tsx --tsconfig tsconfig.node.json scripts/forecast/make-fixtures.ts",
"test:forecast":             "vitest run src/shared/forecast src/main/forecast src/renderer/src/features/forecast",
"forecast:preview":          "vite --config scripts/forecast-preview.vite.ts",
"forecast:features:confirm": "tsx ... scripts/forecast/feature-confirm.ts --sets \"...\"",
"forecast:eval:holdout": "npm run forecast:eval",   // alias, kept so round-10 commands still run
"forecast:power":        "npm run forecast:evalset && npm run forecast:eval"
```
Flags: `forecast:data -- --adaption` (sponsor path, auto-fallback on non-2xx, exit 0); `forecast:eval -- --gate=off` (bypasses the gate and stamps `"gate":{"enforced":false}` into eval-report.json); `forecast:eval -- --split-eval` (scores the old 48-session eval SPLIT instead of the 900-session corpus — kept because the gate's teeth are verified on a deliberately tiny toy corpus, which has no hold-out namespace).

**Amended after the bake-off (round 8):** the gate baseline is the FULL multivariate logistic on the SAME feature basis the shipped head sees (strongest of a class-weighted GD fit and an L-BFGS-converged one), required margin 0 — so growing `FORECAST_FEATURE_KEYS` raises the bar as well as the model — not the old "+0.03 over the best single-feature logistic", which is still printed as context. **Amended round 11:** `forecast:pipeline` now builds and scores the 900-session evaluation corpus end to end (`forecast:evalset` is a pipeline stage, not a side experiment), and the committed `eval-report.json` is its output. The gate margin ships with a measured bootstrap CI. See docs/FORECAST.md § Stage 4.

## 6. Definitive file list

**Amended after the bake-off** (see `scripts/forecast/GAUNTLET.md` round 8): the shipped head was a
190-parameter GLM, not the 241-parameter TinyMLP. Three files joined the list —
`src/shared/forecast/bake-off.json` (committed non-gating bake-off table with paired
session-clustered CIs, embedded verbatim into `eval-report.json`), `scripts/forecast/linear.ts`
(L-BFGS + weighted-L2 logistic + robust Platt, shared by train.ts and eval.ts), and
`scripts/forecast/candidates/` (the five contender scripts, kept as the bake-off record).

**Amended again after the model swap** (round 11): the shipped head is a **937-parameter tanh MLP
`mlp24-36-1`**. Five more files join — `src/shared/forecast/bake-off-power.json` (the 17-model
re-run of that contest on the 900-session corpus, also embedded verbatim),
`scripts/forecast/mlp.ts` (forward/backward + Adam + gradient check, promoted verbatim from the
winning contender exactly as `linear.ts` was), `scripts/forecast/pairwise.ts` (the round-8 GLM
basis, moved OUT of the shared core when it stopped shipping — nothing under `src/` imports it),
`scripts/forecast/holdout-namespace.ts` + `build-evalset.ts` (the evaluation corpus and its three
contamination barriers), and `scripts/forecast/bakeoff-publish.ts`.
`src/shared/forecast/model.ts` no longer exports `FORECAST_TERMS` / `expandBasis`; it exports
`FORECAST_HIDDEN_DIM` / `FORECAST_ENSEMBLE_MEMBERS` / `FORECAST_FORWARD_MACS` instead, all derived
from `FORECAST_FEATURE_KEYS` and the member count — the architecture is shared between train and
serve exactly the way `extractFeatures` is, and `FORECAST_BASIS_SHA` now checksums width +
activation + feature order so a change to any of the three fails closed.

`src/shared/forecast/types.ts` · `hash.ts` · `ring.ts` + `ring.test.ts` · `features.ts` + `features.test.ts` · `labels.ts` + `labels.test.ts` · `model.ts` + `model.test.ts` · `escalate.ts` + `escalate.test.ts` · `purity.test.ts` · `index.ts` · `weights.json` (committed artifact) · `eval-report.json` (committed artifact, embeds provenance) · `bake-off.json` + `bake-off-power.json` (committed non-gating artifacts) · `fixtures/golden.json`

NEW — main: `src/main/forecast/monitor.ts` + `monitor.test.ts` · `tap.ts` + `tap.test.ts` · `recorder.ts` + `recorder.test.ts` · `integration.test.ts` · `index.ts`

NEW — renderer: `src/renderer/src/features/forecast/ForecastPanel.tsx` · `RiskMeter.tsx` · `InternalsPanel.tsx` · `NudgeToast.tsx` · `model.ts` + `model.test.ts` · `copy.ts` · `replay.ts` · `forecast.css`

NEW — scripts/docs/data: `scripts/forecast/{lib,simulate,build-dataset,adaption,augment-local,train,eval}.ts` · `scripts/forecast/GAUNTLET.md` · `scripts/forecast-preview.vite.ts` · `docs/FORECAST.md` · `data/forecast/` (gitignored)

MODIFIED (exhaustive): `src/shared/ipc.ts` (channels, maps, api, 5 settings keys, re-exports) · `src/shared/defaults.ts` (5 defaults) · `src/main/store/appStore.ts` (normalizeSettings clamps) · `src/main/session/controller.ts` (`forecast?: ForecastHook` option; `beforeStep` call in `evaluateOnce`; optional `countdownOverrideSec` param on `buildPolicyInput`; `requirePatch` keys) · `src/main/session/runtime.ts` (construct + wrap + pass hook) · `src/main/index.ts` (FORECAST_GET_STATE handler, two push broadcasts) · `src/preload/index.ts` + `index.d.ts` · `src/renderer/src/state/AppState.tsx` · `src/renderer/src/pages/SessionPage.tsx` · `src/renderer/src/pages/SettingsPage.tsx` (cuttable) · `src/renderer/src/features/session/model.ts` (add `"forecast"` to `PREVIEW_KINDS`; `kind === "forecast" → "cause"` branch in `classifySessionEvent`) · `src/renderer/src/features/session/SessionClock.tsx` (pre-arm plate + 10s→5s chip) · `src/renderer/src/components/CountdownOverlay.tsx` (optional `forecastLeadSec` receipt line) · `src/renderer/src/lib/mockApi.ts` · `package.json` · `.gitignore` (`data/`) · `docs/CONTRACTS.md` (append-only "## Focus Forecast (Phase 4)" section BELOW the frozen Types fence)

UNTOUCHED (asserted by tests/CI): `src/shared/types.ts` · `src/shared/policy/**` · `src/main/session/push.ts` (`SessionPush` unchanged) · `src/main/kill/**` · `src/main/desk/**` · `src/main/plugs/**` · the CONTRACTS.md Types fence.
Feature-selection scripts (train-split only, never gating): `scripts/forecast/feature-mine.ts` (backward elimination on an additive logistic → `data/forecast/feature-mine.json`) · `feature-confirm.ts` (the same candidate sets re-fitted on the SHIPPED pairwise basis → `feature-confirm.json`) · `feature-abtest.ts` (paired session-clustered before/after on the eval split, reporting only → `feature-abtest.json`) · `make-fixtures.ts` (regenerates the width-dependent halves of `fixtures/golden.json`; refuses to overwrite a previously pinned value).
