# Focus Forecast — Frozen-Contracts Appendix (exact)

`src/shared/types.ts` receives ZERO changes (byte-locked by `scripts/check-contracts.mjs` against the docs/CONTRACTS.md Types fence). Everything below is additive, outside the fence.

## 1. New shared types — `src/shared/forecast/types.ts` (complete source)

```ts
import type { Decision } from "../types";

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
| `forecastNudgeRisk` | number | `0.55` | finite → clamp [0.05, 0.90] else default |
| `forecastPrearmRisk` | number | `0.80` | finite → clamp [0.10, 0.95] else default; then raised to ≥ forecastNudgeRisk + 0.05 |
| `forecastPrearmFuseSec` | number | `5` | finite → Math.round, clamp [3, 600] else default (runtime additionally caps at settings.countdownSec) |

`DEFAULT_SETTINGS` in `src/shared/defaults.ts` gains all five. `requirePatch` in `src/main/session/controller.ts` gains matching finite-number/boolean validations in the existing style. `eval.ts` asserts `weights.thresholds.nudge === 0.55 && weights.thresholds.prearm === 0.80` against `DEFAULT_SETTINGS` (operating-point parity).

## 4. Dataset JSONL schema — `data/forecast/dataset.jsonl` (one object per 1 Hz frame)

Fields: `v` (schema version, 1) · `session_id` (string; split key) · `source` ∈ `"synthetic" | "recorded" | "augmented:local" | "augmented:adaption" | "invented:adaption"` · `archetype` (string; `"unknown"` for recorded) · `split` ∈ `"train" | "eval"` (assigned per SESSION, never per frame) · `t` (seconds since session start) · `features` (18 floats, `FORECAST_FEATURE_KEYS` order, encoded pre-normalization) · `raw` (human-unit map, debugging + prompt building) · `label` (0|1: drift onset within next 30 s) · `secs_to_drift` (number|null) · `drift_type` (`"tab_out" | "walk_away" | null`) · `prompt` (string; deterministic compact serialization for Adaption `column_mapping`) · `completion` (`"DRIFT" | "STAY"`).

Example line (single line in the file):

```json
{"v":1,"session_id":"syn-000042","source":"synthetic","archetype":"burst_switcher","split":"train","t":913,"features":[0.375,0.45,0.62,0.21,0.55,0.30,0.40,0.375,0.18,0.33,0.92,0.87,0.12,0.0,0.30,0.2,0.5,0.42],"raw":{"switch15":3,"switch60":9,"switchAccel":2.5,"dwellCur":11,"fracAllow60":0.55,"fracOther60":0.30,"otherDwell30":12,"distinct60":3,"sinceBlock":600,"streak":41,"deskPresent30":0.92,"deskConfMean30":0.87,"deskConfStd30":0.03,"deskFlicker60":0,"sessionMin":15.2,"priorDrifts":1,"titleChurn30":6,"titleChurn60":10},"label":1,"secs_to_drift":17,"drift_type":"tab_out","prompt":"fp-forecast v1 | sw15=3 sw60=9 acc=2.5 dwell=11 allow60=0.55 other60=0.30 od30=12 dis=3 sb=600 stk=41 dp30=0.92 dc30=0.87 ds30=0.03 df60=0 min=15.2 pd=1 tc30=6 tc60=10","completion":"DRIFT"}
```

Recorder output (`<userData>/forecast-sessions/<sessionId>.jsonl`, `FOCUSPLUG_FORECAST_RECORD=1`): same frame fields with `label`/`secs_to_drift`/`drift_type` as `null` (filled offline by build-dataset) and process/title identity present only as FNV-1a hashes (`procHash`, `titleHash`) — never raw strings.

## 5. npm scripts — `package.json` (exact)

```json
"forecast:simulate": "tsx --tsconfig tsconfig.node.json scripts/forecast/simulate.ts",
"forecast:data":     "tsx --tsconfig tsconfig.node.json scripts/forecast/build-dataset.ts",
"forecast:train":    "tsx --tsconfig tsconfig.node.json scripts/forecast/train.ts",
"forecast:eval":     "tsx --tsconfig tsconfig.node.json scripts/forecast/eval.ts",
"forecast:pipeline": "npm run forecast:simulate && npm run forecast:data && npm run forecast:train && npm run forecast:eval",
"test:forecast":     "vitest run src/shared/forecast src/main/forecast src/renderer/src/features/forecast",
"forecast:preview":  "vite --config scripts/forecast-preview.vite.ts"
```
Flags: `forecast:data -- --adaption` (sponsor path, auto-fallback on non-2xx, exit 0); `forecast:eval -- --gate=off` (bypasses the ≥0.03 AUC-lift gate and stamps `"gate":{"enforced":false}` into eval-report.json).

## 6. Definitive file list

NEW — shared (pure; purity test forbids fs/path/electron/window/document):
`src/shared/forecast/types.ts` · `hash.ts` · `ring.ts` + `ring.test.ts` · `features.ts` + `features.test.ts` · `labels.ts` + `labels.test.ts` · `model.ts` + `model.test.ts` · `escalate.ts` + `escalate.test.ts` · `purity.test.ts` · `index.ts` · `weights.json` (committed artifact) · `eval-report.json` (committed artifact, embeds provenance) · `fixtures/golden.json`

NEW — main: `src/main/forecast/monitor.ts` + `monitor.test.ts` · `tap.ts` + `tap.test.ts` · `recorder.ts` + `recorder.test.ts` · `integration.test.ts` · `index.ts`

NEW — renderer: `src/renderer/src/features/forecast/ForecastPanel.tsx` · `RiskMeter.tsx` · `InternalsPanel.tsx` · `NudgeToast.tsx` · `model.ts` + `model.test.ts` · `copy.ts` · `replay.ts` · `forecast.css`

NEW — scripts/docs/data: `scripts/forecast/{lib,simulate,build-dataset,adaption,augment-local,train,eval}.ts` · `scripts/forecast/GAUNTLET.md` · `scripts/forecast-preview.vite.ts` · `docs/FORECAST.md` · `data/forecast/` (gitignored)

MODIFIED (exhaustive): `src/shared/ipc.ts` (channels, maps, api, 5 settings keys, re-exports) · `src/shared/defaults.ts` (5 defaults) · `src/main/store/appStore.ts` (normalizeSettings clamps) · `src/main/session/controller.ts` (`forecast?: ForecastHook` option; `beforeStep` call in `evaluateOnce`; optional `countdownOverrideSec` param on `buildPolicyInput`; `requirePatch` keys) · `src/main/session/runtime.ts` (construct + wrap + pass hook) · `src/main/index.ts` (FORECAST_GET_STATE handler, two push broadcasts) · `src/preload/index.ts` + `index.d.ts` · `src/renderer/src/state/AppState.tsx` · `src/renderer/src/pages/SessionPage.tsx` · `src/renderer/src/pages/SettingsPage.tsx` (cuttable) · `src/renderer/src/features/session/model.ts` (add `"forecast"` to `PREVIEW_KINDS`; `kind === "forecast" → "cause"` branch in `classifySessionEvent`) · `src/renderer/src/features/session/SessionClock.tsx` (pre-arm plate + 10s→5s chip) · `src/renderer/src/components/CountdownOverlay.tsx` (optional `forecastLeadSec` receipt line) · `src/renderer/src/lib/mockApi.ts` · `package.json` · `.gitignore` (`data/`) · `docs/CONTRACTS.md` (append-only "## Focus Forecast (Phase 4)" section BELOW the frozen Types fence)

UNTOUCHED (asserted by tests/CI): `src/shared/types.ts` · `src/shared/policy/**` · `src/main/session/push.ts` (`SessionPush` unchanged) · `src/main/kill/**` · `src/main/desk/**` · `src/main/plugs/**` · the CONTRACTS.md Types fence.