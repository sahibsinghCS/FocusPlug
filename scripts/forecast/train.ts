import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";
import {
  INITIAL_ESCALATION_STATE,
  smoothRisk,
  stepEscalation,
  type EscalationSettings,
  type EscalationState,
} from "../../src/shared/forecast/escalate";
import { findDriftOnsets, type DecisionFrame } from "../../src/shared/forecast/labels";
import {
  FORECAST_BASIS,
  FORECAST_BASIS_SHA,
  FORECAST_ENSEMBLE_MEMBERS,
  FORECAST_FORWARD_MACS,
  FORECAST_HIDDEN_DIM,
  FORECAST_INPUT_DIM,
  FORECAST_MEMBER_HIDDEN_DIM,
  FORECAST_PARAM_COUNT,
  forward,
  parseForecastWeights,
} from "../../src/shared/forecast/model";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  FORECAST_WARMUP_SEC,
  type ForecastEvent,
  type ForecastWeightsFile,
} from "../../src/shared/forecast/types";
import {
  ALARM_BUDGET_REFERENCE_NUDGE_RISK,
  ALARM_BUDGET_REFERENCE_PREARM_RISK,
  ALARM_LOAD_ALLOWANCE,
  AUGMENT_PARENTS_FILE,
  CHURN_FPR_CEILING,
  CONTRACT_PREARM_FUSE_SEC,
  DATASET_FILE,
  FALSE_PREARM_CEILING_PER_HOUR,
  MANIFEST_FILE,
  PROVENANCE_FILE,
  RAW_SESSIONS_FILE,
  canonicalJson,
  forecastDataRoot,
  keepProbability,
  mulberry32,
  numberArg,
  readJsonl,
  repoRoot,
  replaySession,
  rocAuc,
  round4,
  round6,
  sha256Hex,
  shuffled,
  splitForSession,
  stringArg,
  thresholdDefaults,
  type DatasetManifest,
  type DatasetRow,
  type RawSession,
} from "./lib";
import {
  applyStandardizer,
  fitLogisticL2,
  fitPlatt,
  fitStandardizer,
  rowLogit,
  type Standardizer,
} from "./linear";
import {
  forwardNet,
  gradientCheck as netGradientCheck,
  makeScratch,
  paramCount as netParamCount,
  trainNet,
  type Net,
  type NetSpec,
  type Scratch,
} from "./mlp";

/**
 * Deterministic trainer for the shipped Focus Forecast head: a tanh MLP,
 * `FORECAST_INPUT_DIM` → `FORECAST_HIDDEN_DIM` → 1, `FORECAST_PARAM_COUNT`
 * parameters. Only `split: "train"` rows are ever read; the held-out corpus is
 * scored exclusively by eval.ts.
 *
 * WHY AN MLP AND NOT THE 190-PARAMETER GLM IT REPLACED. Round 8's bake-off
 * shipped a pairwise logistic regression, honestly, because on 48 held-out
 * sessions the paired session-clustered SE of a model-vs-model lead-AUC
 * difference was ≈ 0.009 and no non-linear family cleared it. Round 10 re-ran
 * the identical contest on 900 sessions / 1 230 onsets, where that SE is
 * 0.0032, and the answer inverted: this recipe beats a plain additive logistic
 * by +0.0082 [+0.0043, +0.0116] and the GLM that shipped by +0.0122 [+0.0069,
 * +0.0178], while the GLM itself FAILED the re-anchored gate on that corpus.
 * `scripts/forecast/GAUNTLET.md` rounds 10–11 is the record.
 *
 * THE RECIPE (the `mlp-tuned` contender's, pinned from its committed
 * `data/forecast/candidates/mlp-tuned/metrics.json` — its 10-stage
 * hyper-parameter sweep is NOT re-run here, so nothing is re-selected against
 * the corpus the model is then scored on):
 *
 * - the train split is cut into a CALIBRATION slice (15 % of synthetic train
 *   sessions, in no fold's fit set) plus `FORECAST_ENSEMBLE_MEMBERS`
 *   cross-validation folds. Member `f` trains on every fold but `f`;
 * - **augmented sessions are assigned to their PARENT's fold** and dropped when
 *   their parents straddle folds or descend from the calibration slice. The
 *   round-7 trainer did not do this: it put jittered/time-warped copies of its
 *   own validation sessions into the fit set, so every early-stopping decision
 *   it made was read off an optimistic number. `augment-parents.json` (written
 *   by build-dataset.ts) is the augmenter's own lineage record, so this is
 *   bookkeeping, not re-derivation;
 * - each member is a `d→12→1` tanh net, Adam, lr 0.01, batch 256, L2 3e-3, no
 *   dropout, constant schedule, ≤ 60 epochs, patience 30, evaluated every 5;
 * - **early stopping maximises fold-val lead≥20 s ROC-AUC + 0.1 × nudge
 *   recall@30 s** through the SHIPPED escalation reducer on the fold's own
 *   validation SESSIONS — train-internal rows only, and the same metric eval.ts
 *   gates on;
 * - the members' logits are standardized on the calibration slice and averaged.
 *   An affine blend of tanh nets over one shared input standardizer collapses
 *   EXACTLY into a single `d→(members × 12)→1` net; the collapse is asserted to
 *   1e-12 against the ensemble scorer before the artifact is written, so what
 *   ships is one dense layer and not an ensemble loop;
 * - **the standardizer is folded in.** `W1_ji ← θ_ji/s_i`,
 *   `b1_j ← β_j − Σ_i θ_ji·m_i/s_i`, so the payload is
 *   `FORECAST_PARAM_COUNT` floats plus the Platt pair rather than weights plus
 *   a hidden 2N-float scaler. `norm.mean` still ships as the occlusion baseline
 *   the UI attributions use;
 * - **Platt** `σ(a·z + b)` on the calibration slice only — rows no member ever
 *   trained on — by the robust Newton of Lin–Weng–Keerthi. The plain Newton
 *   iteration is not safe here: on a near-separable slice the curvature
 *   underflows and one overshooting step pins `a` at ~1e7, a step-function
 *   "calibrator" that silently wrecks every threshold downstream.
 *
 * The plain additive logistic (d + 1 params) is also fitted and recorded in
 * provenance: it is the "did you try logistic regression?" reference point and
 * the model eval.ts's gate is anchored to.
 *
 * Output: src/shared/forecast/weights.json (must pass parseForecastWeights)
 * plus data/forecast/provenance.json, whose sha256 is embedded in the weights
 * and asserted by eval.ts (provenance can be skipped, never faked).
 *
 *   tsx scripts/forecast/train.ts --seed 42
 */

interface TrainConfig {
  data: string;
  raw: string;
  out: string;
  seed: number;
  iters: number;
  valFraction: number;
  posWeightPower: number;
  maxEpochs: number;
}

function readConfig(): TrainConfig {
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    out: stringArg("--out", join(repoRoot(), "src", "shared", "forecast", "weights.json")),
    seed: numberArg("--seed", 42),
    // L-BFGS iterations for the plain-logistic reference fit only.
    iters: numberArg("--iters", 300),
    // Calibration slice, as a fraction of synthetic TRAIN sessions.
    valFraction: numberArg("--val", 0.15),
    posWeightPower: numberArg("--pos-weight-power", 0.5),
    maxEpochs: numberArg("--epochs", 60),
  };
}

/** Name of the plain additive reference fit — the "did you try logistic regression?" model. */
const PLAIN_BASIS = `lr${FORECAST_INPUT_DIM}`;

/** Warm-started regularization path for the reference logistic, strong → weak. */
const LAMBDAS = [1, 1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6];
/** Lead-censoring used for MODEL SELECTION on train-internal rows — eval.ts's gate metric. */
const SELECTION_LEAD_SEC = 20;

/** The pinned mlp-tuned hyper-parameters (its metrics.json `selection.chosen`). */
const MLP_RECIPE = {
  arch: `${FORECAST_INPUT_DIM}-${FORECAST_MEMBER_HIDDEN_DIM}-1 tanh`,
  lr: 0.01,
  batch: 256,
  l2: 0.003,
  dropout: 0,
  schedule: "const" as const,
  warmupFrac: 0,
  patienceFrac: 0.5,
  evalEvery: 5,
  /** Weight on the reducer-level nudge recall in the early-stopping score. */
  recallWeight: 0.1,
  selected:
    "18-12-1 tanh lr0.01 b256 l20.003 do0 const pw0.5 lead:flat e60 k1/fold " +
    "(data/forecast/candidates/mlp-tuned/metrics.json, selection.chosen)",
};

/** Candidate operating points. The pre-arm axis is searched too — see below. */
const NUDGE_GRID = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
const PREARM_GRID = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
/** A pre-arm band that is not clearly above the nudge band is not a band. */
const MIN_BAND_GAP = 0.1;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface LoadedRows {
  base: Float64Array; // n × d, encoded (pre-standardization)
  y: Uint8Array;
  secs: Float64Array; // NaN ⇒ no onset ahead
  importance: Float64Array; // 1/keep-probability
  augmented: Uint8Array;
  sessionOf: Int32Array;
  sessions: string[];
  n: number;
}

async function loadTrainRows(file: string): Promise<LoadedRows> {
  const base: number[] = [];
  const y: number[] = [];
  const secs: number[] = [];
  const importance: number[] = [];
  const augmented: number[] = [];
  const sessionOf: number[] = [];
  const sessions: string[] = [];
  const sessionIndex = new Map<string, number>();
  for await (const row of readJsonl<DatasetRow>(file)) {
    if (row.split !== "train") {
      continue;
    }
    let index = sessionIndex.get(row.session_id);
    if (index === undefined) {
      index = sessions.length;
      sessionIndex.set(row.session_id, index);
      sessions.push(row.session_id);
    }
    for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
      base.push(row.features[i] ?? 0);
    }
    y.push(row.label);
    secs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
    importance.push(1 / keepProbability(row.label, row.secs_to_drift));
    augmented.push(row.source.startsWith("augmented") || row.source.startsWith("invented") ? 1 : 0);
    sessionOf.push(index);
  }
  return {
    base: Float64Array.from(base),
    y: Uint8Array.from(y),
    secs: Float64Array.from(secs),
    importance: Float64Array.from(importance),
    augmented: Uint8Array.from(augmented),
    sessionOf: Int32Array.from(sessionOf),
    sessions,
    n: y.length,
  };
}

/** Replayed TRAIN session: per-frame features + the decision stream the reducer needs. */
interface ReplayedSession {
  id: string;
  archetype: string;
  durationSec: number;
  /** Frame features, row-major `n × FORECAST_INPUT_DIM`. */
  feats: Float64Array;
  frames: DecisionFrame[];
  onsets: ReturnType<typeof findDriftOnsets>;
  /** 1 ⇒ an onset lands within the horizon ahead of this frame. */
  labels: Int8Array;
}

function replayForTraining(session: RawSession): ReplayedSession {
  const replayed = replaySession(session);
  const frames: DecisionFrame[] = replayed.map((frame) => ({
    t: frame.t,
    decision: frame.decision,
    countdownActive: frame.countdownActive,
  }));
  const onsets = findDriftOnsets(frames);
  const feats = new Float64Array(replayed.length * FORECAST_INPUT_DIM);
  const labels = new Int8Array(replayed.length);
  for (let i = 0; i < replayed.length; i += 1) {
    const values = (replayed[i] as { values: number[] }).values;
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      feats[i * FORECAST_INPUT_DIM + f] = values[f] ?? 0;
    }
    const t = (replayed[i] as { t: number }).t;
    const next = onsets.find((onset) => onset.t > t);
    labels[i] = next !== undefined && next.t - t <= FORECAST_HORIZON_SEC ? 1 : 0;
  }
  return {
    id: session.id,
    archetype: session.archetype,
    durationSec: session.durationSec,
    feats,
    frames,
    onsets,
    labels,
  };
}

// ---------------------------------------------------------------------------
// Folds — mlp-tuned's partition, with augmented rows pinned to their parent
// ---------------------------------------------------------------------------

const CAL_GROUP = -1;

interface FoldSetup {
  /** All train rows, z-scored with ONE shared mean/scale (what makes the collapse exact). */
  norm: Float64Array;
  mean: Float64Array;
  scale: Float64Array;
  folds: Array<{ fitIndex: Int32Array; valIndex: Int32Array; valSessions: string[] }>;
  calIndex: Int32Array;
  calSessions: string[];
  attachedAugmented: number;
  droppedAugmented: number;
}

function buildFolds(
  rows: LoadedRows,
  parents: Map<string, string[]>,
  options: { seed: number; folds: number; calFraction: number },
): FoldSetup {
  const sessionIndexOf = new Map<string, number>(rows.sessions.map((id, i) => [id, i]));
  const synthetic: number[] = [];
  const augmented: number[] = [];
  for (let s = 0; s < rows.sessions.length; s += 1) {
    (parents.has(rows.sessions[s] as string) ? augmented : synthetic).push(s);
  }

  // Deterministic assignment: calibration slice first, then round-robin folds.
  const rand = mulberry32(options.seed ^ 0x5eed);
  const order = shuffled(synthetic, rand);
  const calCount = Math.max(1, Math.round(synthetic.length * options.calFraction));
  const groupOf = new Map<number, number>();
  order.forEach((session, position) => {
    groupOf.set(session, position < calCount ? CAL_GROUP : (position - calCount) % options.folds);
  });

  // THE LEAK FIX: an augmented session belongs wherever its parents do. If its
  // parents disagree, or descend from the calibration slice, it is dropped
  // entirely — a near-copy of a val session inside a fit set makes that fold's
  // number optimistic, which is exactly how the round-7 trainer early-stopped.
  let attached = 0;
  let dropped = 0;
  for (const s of augmented) {
    const family = (parents.get(rows.sessions[s] as string) ?? []).map(
      (id) => sessionIndexOf.get(id) ?? -1,
    );
    const groups = new Set(family.map((parent) => groupOf.get(parent)));
    const only = [...groups];
    if (
      family.length === 0 ||
      family.some((parent) => parent < 0) ||
      only.length !== 1 ||
      only[0] === undefined ||
      only[0] === CAL_GROUP
    ) {
      dropped += 1;
      continue;
    }
    groupOf.set(s, only[0]);
    attached += 1;
  }

  const calIndexList: number[] = [];
  const fitLists: number[][] = Array.from({ length: options.folds }, () => []);
  const valLists: number[][] = Array.from({ length: options.folds }, () => []);
  for (let i = 0; i < rows.n; i += 1) {
    const group = groupOf.get(rows.sessionOf[i] as number);
    if (group === undefined) {
      continue; // dropped augmented session — in no fit set and no val set
    }
    if (group === CAL_GROUP) {
      calIndexList.push(i);
      continue;
    }
    const isAugmented = (rows.augmented[i] as number) === 1;
    for (let f = 0; f < options.folds; f += 1) {
      if (f === group) {
        // Val is measured on REAL sessions only; an augmented copy would make
        // the val number a statement about the augmenter.
        if (!isAugmented) {
          (valLists[f] as number[]).push(i);
        }
      } else {
        (fitLists[f] as number[]).push(i);
      }
    }
  }

  // One shared z-score over EVERY train row. Members must agree on the input
  // transform or the affine blend cannot collapse into a single net.
  const mean = new Float64Array(FORECAST_INPUT_DIM);
  const scale = new Float64Array(FORECAST_INPUT_DIM);
  for (let i = 0; i < rows.n; i += 1) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      mean[f] = (mean[f] as number) + (rows.base[i * FORECAST_INPUT_DIM + f] as number);
    }
  }
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    mean[f] = (mean[f] as number) / Math.max(1, rows.n);
  }
  for (let i = 0; i < rows.n; i += 1) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      const diff = (rows.base[i * FORECAST_INPUT_DIM + f] as number) - (mean[f] as number);
      scale[f] = (scale[f] as number) + diff * diff;
    }
  }
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    const s = Math.sqrt((scale[f] as number) / Math.max(1, rows.n));
    scale[f] = s > 1e-6 ? s : 1;
  }
  const norm = new Float64Array(rows.n * FORECAST_INPUT_DIM);
  for (let i = 0; i < rows.n; i += 1) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      norm[i * FORECAST_INPUT_DIM + f] =
        ((rows.base[i * FORECAST_INPUT_DIM + f] as number) - (mean[f] as number)) /
        (scale[f] as number);
    }
  }

  const sessionIdsOf = (group: number): string[] =>
    [...groupOf.entries()]
      .filter(([session, g]) => g === group && !parents.has(rows.sessions[session] as string))
      .map(([session]) => rows.sessions[session] as string);

  return {
    norm,
    mean,
    scale,
    folds: Array.from({ length: options.folds }, (_, f) => ({
      fitIndex: Int32Array.from(fitLists[f] as number[]),
      valIndex: Int32Array.from(valLists[f] as number[]),
      valSessions: sessionIdsOf(f),
    })),
    calIndex: Int32Array.from(calIndexList),
    calSessions: sessionIdsOf(CAL_GROUP),
    attachedAugmented: attached,
    droppedAugmented: dropped,
  };
}

// ---------------------------------------------------------------------------
// Alarm replay through the SHIPPED reducer — shared by the early-stop score
// and the operating-point search, so both speak the product's language.
// ---------------------------------------------------------------------------

interface AlarmTotals {
  drifts: number;
  nudgeHits: number;
  prearmHits: number;
  nudges: number;
  alarms: number;
  falsePrearms: number;
  hours: number;
  churnNegatives: number;
  churnFires: number;
}

function emptyTotals(): AlarmTotals {
  return {
    drifts: 0,
    nudgeHits: 0,
    prearmHits: 0,
    nudges: 0,
    alarms: 0,
    falsePrearms: 0,
    hours: 0,
    churnNegatives: 0,
    churnFires: 0,
  };
}

function accumulateAlarms(
  totals: AlarmTotals,
  session: ReplayedSession,
  risks: Float64Array,
  settings: EscalationSettings,
): void {
  let state: EscalationState = { ...INITIAL_ESCALATION_STATE };
  let smoothed: number | null = null;
  const events: ForecastEvent[] = [];
  for (let i = 0; i < session.frames.length; i += 1) {
    const frame = session.frames[i] as DecisionFrame;
    smoothed = smoothRisk(smoothed, risks[i] as number);
    const stepped = stepEscalation(state, {
      ts: frame.t * 1000,
      risk: smoothed,
      ready: frame.t >= FORECAST_WARMUP_SEC,
      decision: frame.decision,
      countdownActive: frame.countdownActive,
      policySignal: null,
      settings,
    });
    state = stepped.state;
    events.push(...stepped.events);
    if (session.archetype === "research_churn" && (session.labels[i] as number) === 0) {
      totals.churnNegatives += 1;
      if ((risks[i] as number) >= settings.nudgeRisk) {
        totals.churnFires += 1;
      }
    }
  }
  const alarmTimes = events
    .filter((event) => event.type === "forecast_nudge" || event.type === "forecast_prearm")
    .map((event) => event.ts / 1000);
  const prearms = events.filter((event) => event.type === "forecast_prearm");
  const hitEvents = events.filter((event) => event.type === "forecast_hit");
  for (const onset of session.onsets) {
    totals.drifts += 1;
    if (alarmTimes.some((t) => t <= onset.t && onset.t - t <= 30)) {
      totals.nudgeHits += 1;
    }
    const receipt = hitEvents.find(
      (event) => event.type === "forecast_hit" && Math.abs(event.ts / 1000 - onset.t) <= 1.5,
    );
    if (receipt !== undefined) {
      totals.prearmHits += 1;
      continue;
    }
    if (prearms.some((event) => event.ts / 1000 <= onset.t && onset.t - event.ts / 1000 <= 30)) {
      totals.prearmHits += 1;
    }
  }
  totals.falsePrearms += events.filter(
    (event) =>
      event.type === "forecast_clear" &&
      event.wasPrearmed &&
      !session.onsets.some(
        (onset) => onset.t >= event.ts / 1000 && onset.t - event.ts / 1000 <= 30,
      ),
  ).length;
  totals.nudges += events.filter((event) => event.type === "forecast_nudge").length;
  totals.alarms += alarmTimes.length;
  totals.hours += session.durationSec / 3600;
}

function escalationSettingsAt(nudgeRisk: number, prearmRisk: number): EscalationSettings {
  return {
    nudgeRisk,
    prearmRisk,
    prearmEnabled: true,
    prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  };
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Lead-censored AUC over a row subset, calm negatives repeated by importance. */
function leadAucOverRows(
  logits: Float64Array,
  index: Int32Array,
  rows: LoadedRows,
  leadSec: number,
): number {
  const s: number[] = [];
  const l: number[] = [];
  for (let k = 0; k < index.length; k += 1) {
    const i = index[k] as number;
    const secs = rows.secs[i] as number;
    if (!(Number.isNaN(secs) || secs >= leadSec)) {
      continue;
    }
    const repeats = Math.max(1, Math.round(rows.importance[i] as number));
    for (let r = 0; r < repeats; r += 1) {
      s.push(logits[k] as number);
      l.push(rows.y[i] as number);
    }
  }
  return rocAuc(s, l);
}

/** σ(a · (β + Σ α_m · logit_m) + b) over already-normalized features. */
function ensembleScorer(
  nets: readonly Net[],
  alpha: readonly number[],
  beta: number,
  mean: Float64Array,
  scale: Float64Array,
  calibration: { a: number; b: number },
): (feats: ArrayLike<number>, offset: number) => number {
  const scratches = nets.map((net) => makeScratch(net));
  const buf = new Float64Array(FORECAST_INPUT_DIM);
  return (feats, offset) => {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      buf[f] = ((feats[offset + f] as number) - (mean[f] as number)) / (scale[f] as number);
    }
    let z = beta;
    for (let m = 0; m < nets.length; m += 1) {
      z += (alpha[m] as number) * forwardNet(nets[m] as Net, buf, 0, scratches[m] as Scratch, false);
    }
    return 1 / (1 + Math.exp(-(calibration.a * z + calibration.b)));
  };
}

interface ThresholdRow {
  nudgeRisk: number;
  prearmRisk: number;
  recallAt30sNudge: number;
  recallAt30sPrearm: number;
  nudgesPerHour: number;
  alarmsPerHour: number;
  falsePrearmsPerHour: number;
  researchChurnFprAtNudge: number;
  admissible?: boolean;
}

function summarize(totals: AlarmTotals, nudgeRisk: number, prearmRisk: number): ThresholdRow {
  return {
    nudgeRisk,
    prearmRisk,
    recallAt30sNudge: round4(totals.drifts > 0 ? totals.nudgeHits / totals.drifts : 0),
    recallAt30sPrearm: round4(totals.drifts > 0 ? totals.prearmHits / totals.drifts : 0),
    nudgesPerHour: round4(totals.hours > 0 ? totals.nudges / totals.hours : 0),
    alarmsPerHour: round4(totals.hours > 0 ? totals.alarms / totals.hours : 0),
    falsePrearmsPerHour: round4(totals.hours > 0 ? totals.falsePrearms / totals.hours : 0),
    researchChurnFprAtNudge: round6(
      totals.churnNegatives > 0 ? totals.churnFires / totals.churnNegatives : 0,
    ),
  };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();

  // The optimizer is proved, not presumed: finite differences against the
  // analytic gradient of the SAME forward/backward code the members train with.
  const worstGrad = netGradientCheck();
  console.log(
    `gradient check ok (MLP forward/backward vs finite differences, worst rel err ${worstGrad.toExponential(2)})`,
  );

  const manifest = JSON.parse(
    readFileSync(join(forecastDataRoot(), MANIFEST_FILE), "utf8"),
  ) as DatasetManifest;
  const rows = await loadTrainRows(config.data);
  if (rows.n === 0) {
    throw new Error("no train rows found — run build-dataset.ts first");
  }

  // Augmentation lineage, written by build-dataset.ts. Absent ⇒ every augmented
  // session is dropped from the folds, which is the SAFE failure: it costs
  // training data, it cannot leak a val session into a fit set.
  const parentsFile = join(forecastDataRoot(), AUGMENT_PARENTS_FILE);
  let parents = new Map<string, string[]>();
  if (existsSync(parentsFile)) {
    parents = new Map(
      Object.entries(JSON.parse(readFileSync(parentsFile, "utf8")) as Record<string, string[]>),
    );
  } else {
    console.warn(
      `WARN ${AUGMENT_PARENTS_FILE} missing — every augmented session will be DROPPED from the ` +
        `folds rather than risk leaking a copy of a validation session into a fit set. Re-run ` +
        `'npm run forecast:data' to restore them.`,
    );
  }

  const setup = buildFolds(rows, parents, {
    seed: config.seed,
    folds: FORECAST_ENSEMBLE_MEMBERS,
    calFraction: config.valFraction,
  });
  console.log(
    `train rows ${rows.n} over ${rows.sessions.length} sessions | ${FORECAST_ENSEMBLE_MEMBERS} folds + ` +
      `calibration slice ${setup.calSessions.length} sessions / ${setup.calIndex.length} rows | ` +
      `augmented: ${setup.attachedAugmented} attached to a parent fold, ${setup.droppedAugmented} dropped | ` +
      `seed ${config.seed}`,
  );

  // --- Replay every TRAIN session once ---------------------------------------
  // Used twice: by the early-stopping score (the fold's own val sessions) and
  // by the operating-point search (all of them, cross-fitted). No eval row is
  // opened at any point in this file.
  const replays = new Map<string, ReplayedSession>();
  for await (const session of readJsonl<RawSession>(config.raw)) {
    if (session.source !== "synthetic" || splitForSession(session.id, config.seed) !== "train") {
      continue;
    }
    replays.set(session.id, replayForTraining(session));
  }
  console.log(`replayed ${replays.size} train sessions through the shared ring + extractor`);

  // --- Members ---------------------------------------------------------------
  const spec: NetSpec = {
    dims: [FORECAST_INPUT_DIM, FORECAST_MEMBER_HIDDEN_DIM],
    activation: "tanh",
  };
  const nets: Net[] = [];
  const memberLog: Array<{
    fold: number;
    fitRows: number;
    valRows: number;
    valSessions: number;
    valDrifts: number;
    bestEpoch: number;
    epochsRan: number;
    selectionScore: number;
  }> = [];
  const reducerSettings = escalationSettingsAt(
    ALARM_BUDGET_REFERENCE_NUDGE_RISK,
    ALARM_BUDGET_REFERENCE_PREARM_RISK,
  );

  setup.folds.forEach((fold, f) => {
    const valSessions = fold.valSessions
      .map((id) => replays.get(id))
      .filter((s): s is ReplayedSession => s !== undefined);
    let positives = 0;
    for (let k = 0; k < fold.fitIndex.length; k += 1) {
      positives += rows.y[fold.fitIndex[k] as number] as number;
    }
    // Tempered class weighting, power 0.5 — the sweep's pick, held fixed.
    const wPos =
      positives > 0
        ? Math.pow((fold.fitIndex.length - positives) / positives, config.posWeightPower)
        : 1;
    const weight = new Float64Array(rows.n);
    for (let i = 0; i < rows.n; i += 1) {
      weight[i] = (rows.y[i] as number) === 1 ? wPos : 1;
    }

    const scratchHolder: { scratch: Scratch | null } = { scratch: null };
    const riskBuf = new Float64Array(
      valSessions.reduce((max, s) => Math.max(max, s.frames.length), 1),
    );
    const score = (net: Net): number => {
      if (scratchHolder.scratch === null) {
        scratchHolder.scratch = makeScratch(net);
      }
      const scratch = scratchHolder.scratch;
      const logits = new Float64Array(fold.valIndex.length);
      for (let k = 0; k < fold.valIndex.length; k += 1) {
        logits[k] = forwardNet(
          net,
          setup.norm,
          (fold.valIndex[k] as number) * FORECAST_INPUT_DIM,
          scratch,
          false,
        );
      }
      const auc = leadAucOverRows(logits, fold.valIndex, rows, SELECTION_LEAD_SEC);
      // Reducer-level recall needs calibrated risks, so this member gets a
      // throwaway Platt on its own fold-val logits. It never ships.
      const calibration = fitPlatt(
        Array.from(logits),
        Array.from(fold.valIndex, (i) => rows.y[i as number] as number),
        Array.from(fold.valIndex, (i) => rows.importance[i as number] as number),
      );
      const scorer = ensembleScorer([net], [1], 0, setup.mean, setup.scale, calibration);
      const totals = emptyTotals();
      for (const session of valSessions) {
        for (let i = 0; i < session.frames.length; i += 1) {
          riskBuf[i] = scorer(session.feats, i * FORECAST_INPUT_DIM);
        }
        accumulateAlarms(totals, session, riskBuf, reducerSettings);
      }
      const recall = totals.drifts > 0 ? totals.nudgeHits / totals.drifts : 0;
      return auc + MLP_RECIPE.recallWeight * recall;
    };

    const result = trainNet(
      { x: setup.norm, y: rows.y, weight, fitIndex: fold.fitIndex },
      {
        spec,
        lr: MLP_RECIPE.lr,
        batch: MLP_RECIPE.batch,
        l2: MLP_RECIPE.l2,
        dropout: MLP_RECIPE.dropout,
        schedule: MLP_RECIPE.schedule,
        warmupFrac: MLP_RECIPE.warmupFrac,
        maxEpochs: config.maxEpochs,
        patience: Math.max(20, Math.round(config.maxEpochs * MLP_RECIPE.patienceFrac)),
        seed: config.seed,
        evalEvery: MLP_RECIPE.evalEvery,
        score,
      },
    );
    nets.push(result.net);
    const valDrifts = valSessions.reduce((sum, s) => sum + s.onsets.length, 0);
    memberLog.push({
      fold: f,
      fitRows: fold.fitIndex.length,
      valRows: fold.valIndex.length,
      valSessions: valSessions.length,
      valDrifts,
      bestEpoch: result.bestEpoch,
      epochsRan: result.epochsRan,
      selectionScore: round6(result.bestScore),
    });
    console.log(
      `  member ${f}: fit ${fold.fitIndex.length} rows | val ${valSessions.length} sessions / ` +
        `${valDrifts} onsets | best epoch ${result.bestEpoch}/${result.epochsRan} | ` +
        `selection score ${result.bestScore.toFixed(5)} (lead≥20s AUC + ${MLP_RECIPE.recallWeight} × nudge recall)`,
    );
  });

  // --- Blend: standardize each member's logits on the calibration slice ------
  // Affine ⇒ the blend still collapses into a single net.
  const alpha: number[] = [];
  let beta = 0;
  for (const net of nets) {
    const scratch = makeScratch(net);
    const logits = new Float64Array(setup.calIndex.length);
    let mean = 0;
    for (let k = 0; k < setup.calIndex.length; k += 1) {
      logits[k] = forwardNet(
        net,
        setup.norm,
        (setup.calIndex[k] as number) * FORECAST_INPUT_DIM,
        scratch,
        false,
      );
      mean += logits[k] as number;
    }
    mean /= Math.max(1, setup.calIndex.length);
    let variance = 0;
    for (let k = 0; k < setup.calIndex.length; k += 1) {
      const diff = (logits[k] as number) - mean;
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / Math.max(1, setup.calIndex.length)) || 1;
    alpha.push(1 / (nets.length * sd));
    beta -= mean / (nets.length * sd);
  }

  // --- Platt on the calibration slice ONLY (no member trained on it) ---------
  const blendScratches = nets.map((net) => makeScratch(net));
  const calLogits: number[] = [];
  const calLabels: number[] = [];
  const calWeights: number[] = [];
  for (let k = 0; k < setup.calIndex.length; k += 1) {
    const i = setup.calIndex[k] as number;
    let z = beta;
    for (let m = 0; m < nets.length; m += 1) {
      z +=
        (alpha[m] as number) *
        forwardNet(
          nets[m] as Net,
          setup.norm,
          i * FORECAST_INPUT_DIM,
          blendScratches[m] as Scratch,
          false,
        );
    }
    calLogits.push(z);
    calLabels.push(rows.y[i] as number);
    calWeights.push(rows.importance[i] as number);
  }
  const calibration = fitPlatt(calLogits, calLabels, calWeights);
  const calLeadAuc = leadAucOverRows(Float64Array.from(calLogits), setup.calIndex, rows, SELECTION_LEAD_SEC);
  console.log(
    `blend: ${nets.length} members → collapsed ${FORECAST_BASIS} (${FORECAST_PARAM_COUNT} params, ` +
      `${FORECAST_FORWARD_MACS} MACs + ${FORECAST_HIDDEN_DIM} tanh/tick) | calibration slice ` +
      `lead≥20s ${calLeadAuc.toFixed(4)} | Platt a ${calibration.a.toFixed(4)} b ${calibration.b.toFixed(4)}`,
  );

  // --- COLLAPSE: members + blend + standardizer → one d→H→1 net --------------
  // Member m contributes rows [m·12, (m+1)·12) of the hidden layer. Its output
  // weights are scaled by α_m, its output bias folded into the single output
  // bias with β. The z-score is folded into the hidden layer, so the shipped
  // payload is exactly FORECAST_PARAM_COUNT floats.
  const hiddenWeights = new Array<number>(FORECAST_HIDDEN_DIM * FORECAST_INPUT_DIM).fill(0);
  const hiddenBias = new Array<number>(FORECAST_HIDDEN_DIM).fill(0);
  const outputWeights = new Array<number>(FORECAST_HIDDEN_DIM).fill(0);
  let outputBias = beta;
  nets.forEach((net, m) => {
    const w1 = net.w[0] as Float64Array;
    const b1 = net.b[0] as Float64Array;
    const w2 = net.w[1] as Float64Array;
    const b2 = net.b[1] as Float64Array;
    const a = alpha[m] as number;
    for (let j = 0; j < FORECAST_MEMBER_HIDDEN_DIM; j += 1) {
      const unit = m * FORECAST_MEMBER_HIDDEN_DIM + j;
      let bias = b1[j] as number;
      for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
        const theta = w1[j * FORECAST_INPUT_DIM + i] as number;
        const s = setup.scale[i] as number;
        hiddenWeights[unit * FORECAST_INPUT_DIM + i] = theta / s;
        bias -= (theta * (setup.mean[i] as number)) / s;
      }
      hiddenBias[unit] = bias;
      outputWeights[unit] = a * (w2[j] as number);
    }
    outputBias += a * (b2[0] as number);
  });

  // --- Feature statistics shipped beside the model ---------------------------
  // `mean` is the occlusion baseline the runtime attributions use; `scale` is
  // published dispersion. Both are the same train-row statistics the fit used.
  const featureMean = Array.from(setup.mean);
  const featureScale = Array.from(setup.scale);

  const identity = (value: number): number => value;
  const precision8 = (value: number): number => Number(value.toPrecision(8));
  const thresholds = await thresholdDefaults();
  const buildWeights = (
    nudge: number,
    prearm: number,
    sha: string,
    round: (value: number) => number = precision8,
  ): ForecastWeightsFile => ({
    version: FORECAST_MODEL_VERSION,
    // Deterministic given the dataset: same seed + same data ⇒ byte-identical
    // weights.json (wall-clock time never enters the artifact).
    createdAt: manifest.createdAt,
    seed: config.seed,
    featureKeys: [...FORECAST_FEATURE_KEYS],
    norm: { mean: featureMean.map(round), scale: featureScale.map(round) },
    basis: FORECAST_BASIS,
    basisSha: FORECAST_BASIS_SHA,
    layers: {
      hidden: { weights: hiddenWeights.map(round), bias: hiddenBias.map(round) },
      output: { weights: outputWeights.map(round), bias: [round(outputBias)] },
    },
    calibration: { a: round(calibration.a), b: round(calibration.b) },
    horizonSec: FORECAST_HORIZON_SEC,
    thresholds: { nudge, prearm, clear: nudge - (thresholds.nudge - thresholds.clear) },
    paramCount: FORECAST_PARAM_COUNT,
    trainProvenanceSha: sha,
  });

  const draft = parseForecastWeights(
    JSON.parse(JSON.stringify(buildWeights(thresholds.nudge, thresholds.prearm, "pending"))),
  );
  if (draft === null) {
    throw new Error("trained weights failed parseForecastWeights — refusing to continue");
  }

  // --- Collapse proof --------------------------------------------------------
  // Two separate claims, checked separately because they have different
  // tolerances and conflating them would hide a real bug behind a rounding one:
  //
  //   1. the ALGEBRA is exact — one wider net IS the affine blend of the three
  //      members, to floating-point noise (1e-12);
  //   2. the ARTIFACT rounds to 8 significant digits on the way to JSON, which
  //      costs a bounded and reported amount of risk (< 1e-6).
  //
  // Both are checked on real train frames, not a toy vector, before writing.
  const exact = parseForecastWeights(
    JSON.parse(JSON.stringify(buildWeights(thresholds.nudge, thresholds.prearm, "exact", identity))),
  );
  if (exact === null) {
    throw new Error("full-precision collapsed weights failed parseForecastWeights");
  }
  const ensemble = ensembleScorer(nets, alpha, beta, setup.mean, setup.scale, calibration);
  let collapseMaxRiskError = 0;
  let roundingMaxRiskError = 0;
  let collapseChecked = 0;
  const probe = new Array<number>(FORECAST_INPUT_DIM);
  const stride = Math.max(1, Math.floor(setup.calIndex.length / 5000));
  for (let k = 0; k < setup.calIndex.length; k += stride) {
    const i = setup.calIndex[k] as number;
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      probe[f] = rows.base[i * FORECAST_INPUT_DIM + f] as number;
    }
    const theirs = ensemble(rows.base, i * FORECAST_INPUT_DIM);
    const exactRisk = forward(exact, probe).rawRisk;
    const shippedRisk = forward(draft, probe).rawRisk;
    collapseMaxRiskError = Math.max(collapseMaxRiskError, Math.abs(exactRisk - theirs));
    roundingMaxRiskError = Math.max(roundingMaxRiskError, Math.abs(shippedRisk - exactRisk));
    collapseChecked += 1;
  }
  if (collapseMaxRiskError > 1e-12) {
    throw new Error(
      `ensemble collapse is NOT exact: max |Δrisk| ${collapseMaxRiskError.toExponential(3)} over ` +
        `${collapseChecked} train frames. The shipped net must BE the ensemble, not an approximation.`,
    );
  }
  if (roundingMaxRiskError > 1e-6) {
    throw new Error(
      `8-significant-digit serialization moves the risk by ${roundingMaxRiskError.toExponential(3)} ` +
        `— too much to ship. Widen the artifact's precision.`,
    );
  }
  console.log(
    `collapse verified on ${collapseChecked} train frames: the single ${FORECAST_BASIS} net equals the ` +
      `${nets.length}-member ensemble to ${collapseMaxRiskError.toExponential(2)} risk, and 8-digit ` +
      `serialization costs a further ${roundingMaxRiskError.toExponential(2)}`,
  );

  // --- The plain additive logistic reference ---------------------------------
  // The "did you try logistic regression?" model and the baseline eval.ts's
  // gate is anchored to. Fitted on the same fold-0 fit rows, selected on the
  // calibration slice — never on eval.
  const plainDesign = Float32Array.from(rows.base);
  const plainFitIdx = (setup.folds[0] as { fitIndex: Int32Array }).fitIndex;
  const plainStd: Standardizer = fitStandardizer(plainDesign, FORECAST_INPUT_DIM, plainFitIdx);
  applyStandardizer(plainDesign, FORECAST_INPUT_DIM, plainStd);
  let plainWPos = 0;
  let plainWNeg = 0;
  for (let k = 0; k < plainFitIdx.length; k += 1) {
    const i = plainFitIdx[k] as number;
    if ((rows.y[i] as number) === 1) {
      plainWPos += rows.importance[i] as number;
    } else {
      plainWNeg += rows.importance[i] as number;
    }
  }
  const plainClassWeight = plainWPos > 0 ? Math.pow(plainWNeg / plainWPos, config.posWeightPower) : 1;
  const plainSampleWeights = Float64Array.from(rows.importance, (w, i) =>
    (rows.y[i] as number) === 1 ? w * plainClassWeight : w,
  );
  const plainSweep: Array<{ lambda: number; calLeadAuc20: number; iters: number }> = [];
  let plainBest: { lambda: number; auc: number; iters: number } | null = null;
  let warm: Float64Array | undefined;
  for (const lambda of LAMBDAS) {
    const fit = fitLogisticL2(
      plainDesign,
      FORECAST_INPUT_DIM,
      plainFitIdx,
      rows.y,
      plainSampleWeights,
      lambda,
      config.iters,
      warm,
    );
    warm = fit.theta;
    const logits = new Float64Array(setup.calIndex.length);
    for (let k = 0; k < setup.calIndex.length; k += 1) {
      logits[k] = rowLogit(plainDesign, FORECAST_INPUT_DIM, setup.calIndex[k] as number, fit.theta);
    }
    const auc = leadAucOverRows(logits, setup.calIndex, rows, SELECTION_LEAD_SEC);
    plainSweep.push({ lambda, calLeadAuc20: round6(auc), iters: fit.iters });
    if (plainBest === null || auc > plainBest.auc) {
      plainBest = { lambda, auc, iters: fit.iters };
    }
  }
  const plain = plainBest as { lambda: number; auc: number; iters: number };
  console.log(
    `${PLAIN_BASIS.padEnd(12)} d=${FORECAST_INPUT_DIM} λ=${plain.lambda} ` +
      `calibration-slice lead≥20s ${plain.auc.toFixed(4)} (${FORECAST_INPUT_DIM + 1} params, gate reference)`,
  );

  // --- Operating point, re-selected on CROSS-FITTED TRAIN sessions -----------
  // NON-NEGOTIABLE for this swap: the 0.45/0.80 pair that shipped was derived
  // for the GLM's risk scale, and a threshold is a cut on a scale. Round 10
  // measured every non-linear contender LOSING pre-arm recall at the inherited
  // 0.80 line purely because its calibrated risk saturates elsewhere. So BOTH
  // axes are re-searched here, on rows eval.ts never sees.
  //
  // Every train session is scored by a model that never saw it:
  //   - a fold-f session by MEMBER f (the only member whose fit set excluded
  //     it), rescaled so its calibration-slice logit spread matches the shipped
  //     blend's, then read through the SHIPPED Platt — the threshold is a cut
  //     on that scale, so every fold has to be read on it;
  //   - a calibration-slice session by the full shipped net, which is honestly
  //     out-of-sample for it: no member trained on the calibration slice.
  // No eval row is opened; no cross-fit model ships.
  let blendSd = 0;
  {
    let mean = 0;
    for (const z of calLogits) {
      mean += z;
    }
    mean /= Math.max(1, calLogits.length);
    let variance = 0;
    for (const z of calLogits) {
      variance += (z - mean) * (z - mean);
    }
    blendSd = Math.sqrt(variance / Math.max(1, calLogits.length)) || 1;
  }
  const memberScorers = nets.map((net, m) => {
    // Member m standardized on the calibration slice, then stretched to the
    // blend's spread so a cut at 0.45 means the same thing on both.
    const scratch = makeScratch(net);
    let mean = 0;
    const logits = new Float64Array(setup.calIndex.length);
    for (let k = 0; k < setup.calIndex.length; k += 1) {
      logits[k] = forwardNet(
        net,
        setup.norm,
        (setup.calIndex[k] as number) * FORECAST_INPUT_DIM,
        scratch,
        false,
      );
      mean += logits[k] as number;
    }
    mean /= Math.max(1, setup.calIndex.length);
    let variance = 0;
    for (let k = 0; k < setup.calIndex.length; k += 1) {
      const diff = (logits[k] as number) - mean;
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / Math.max(1, setup.calIndex.length)) || 1;
    void m;
    return ensembleScorer(
      [net],
      [blendSd / sd],
      -(blendSd * mean) / sd,
      setup.mean,
      setup.scale,
      calibration,
    );
  });

  const foldOfSession = new Map<string, number>();
  setup.folds.forEach((fold, f) => {
    for (const id of fold.valSessions) {
      foldOfSession.set(id, f);
    }
  });
  const shippedScorer = (feats: ArrayLike<number>, offset: number): number => {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      probe[f] = feats[offset + f] as number;
    }
    return forward(draft, probe).rawRisk;
  };

  interface CrossFitSession {
    session: ReplayedSession;
    risks: Float64Array;
    scoredBy: string;
  }
  const crossFit: CrossFitSession[] = [];
  const calSessionSet = new Set(setup.calSessions);
  for (const [id, session] of replays) {
    const fold = foldOfSession.get(id);
    const scorer =
      fold !== undefined
        ? (memberScorers[fold] as (feats: ArrayLike<number>, offset: number) => number)
        : calSessionSet.has(id)
          ? shippedScorer
          : null;
    if (scorer === null) {
      continue; // fully censored / unassigned — no fold, no cross-fit model
    }
    const risks = new Float64Array(session.frames.length);
    for (let i = 0; i < session.frames.length; i += 1) {
      risks[i] = scorer(session.feats, i * FORECAST_INPUT_DIM);
    }
    crossFit.push({
      session,
      risks,
      scoredBy: fold !== undefined ? `member${fold}` : "shipped-net (calibration slice)",
    });
  }
  const searchDrifts = crossFit.reduce((sum, entry) => sum + entry.session.onsets.length, 0);
  const searchHours = crossFit.reduce((sum, entry) => sum + entry.session.durationSec / 3600, 0);
  console.log(
    `operating-point search: ${crossFit.length} cross-fitted train sessions, ${searchDrifts} drift ` +
      `onsets, ${searchHours.toFixed(1)} h (ceilings: churn FPR ≤ ${CHURN_FPR_CEILING}, alarm load ` +
      `≤ ${ALARM_LOAD_ALLOWANCE}× the frozen ${ALARM_BUDGET_REFERENCE_NUDGE_RISK}/` +
      `${ALARM_BUDGET_REFERENCE_PREARM_RISK} point, ${FALSE_PREARM_CEILING_PER_HOUR} false pre-arms/h)`,
  );

  const scoreThreshold = (nudge: number, prearm: number): ThresholdRow => {
    const totals = emptyTotals();
    const settings = escalationSettingsAt(nudge, prearm);
    for (const entry of crossFit) {
      accumulateAlarms(totals, entry.session, entry.risks, settings);
    }
    return summarize(totals, nudge, prearm);
  };

  const grid: ThresholdRow[] = [];
  for (const nudge of NUDGE_GRID) {
    for (const prearm of PREARM_GRID) {
      if (prearm < nudge + MIN_BAND_GAP) {
        continue;
      }
      grid.push(scoreThreshold(nudge, prearm));
    }
  }
  // The alarm-load reference is this same model at the PRE-BAKE-OFF point
  // (0.55 / 0.80) on these same sessions: a ratio, so the cross-fit's own risk
  // scale cancels, and a FROZEN anchor, so re-running the trainer can never
  // ratchet the threshold down against its own previous answer.
  //
  // The ceiling is on NUDGES per hour, exactly as round 8 defined it, NOT on
  // nudges + pre-arms. A pre-arm is governed by its own stated budget — the
  // design's "< 2 false pre-arms/hour" — and putting it under the nudge ratio
  // as well double-counts it. That double-count is not academic: it was tried,
  // and because raising the pre-arm line DELETES pre-arm events it handed the
  // search free alarm-load headroom for lowering the nudge line, so the joint
  // ceiling selected the worst pre-arm threshold on the grid. `alarmsPerHour`
  // is still measured and published on every row; it just is not the ceiling.
  const reference =
    grid.find(
      (row) =>
        row.nudgeRisk === ALARM_BUDGET_REFERENCE_NUDGE_RISK &&
        row.prearmRisk === ALARM_BUDGET_REFERENCE_PREARM_RISK,
    ) ?? scoreThreshold(ALARM_BUDGET_REFERENCE_NUDGE_RISK, ALARM_BUDGET_REFERENCE_PREARM_RISK);
  const loadCeiling = reference.nudgesPerHour * ALARM_LOAD_ALLOWANCE;
  for (const row of grid) {
    row.admissible =
      row.researchChurnFprAtNudge <= CHURN_FPR_CEILING &&
      row.falsePrearmsPerHour <= FALSE_PREARM_CEILING_PER_HOUR &&
      row.nudgesPerHour <= loadCeiling;
  }
  // THE OBJECTIVE, in two stages, because the product makes two promises and
  // each has its own budget. One scalar objective cannot honour both: a single
  // "maximize nudge recall" rule over the joint grid was tried first and is
  // wrong for a mechanical reason — raising the pre-arm line DELETES pre-arm
  // events, which buys alarm-load headroom, which buys a lower nudge line — so
  // it selects the worst pre-arm threshold on the grid (0.90, pre-arm recall
  // 0.116) to win a little nudge recall. The axes are therefore selected in
  // order, each against the ceiling that actually governs it:
  //
  //   Stage 1 — the NUDGE line, with the pre-arm line held at its FROZEN
  //   reference. Max recall@30s under the nudge rule, subject to nudges/h ≤
  //   1.15× the frozen point. This is round 8's rule unchanged, so the nudge
  //   threshold stays comparable across the whole gauntlet.
  //
  //   Stage 2 — the PRE-ARM line, with the nudge line now fixed. Max recall@30s
  //   under the PRE-ARM rule (the fuse-shortening feature), subject to the
  //   design's own < 2 false pre-arms/hour AND a floor on stage 1's nudge
  //   recall, because an over-eager pre-arm consumes an escalation. This axis
  //   is what round 10 made the non-negotiable condition of the swap: 0.80 was
  //   derived for the previous GLM's risk scale, and every non-linear contender
  //   lost pre-arm recall at it for that reason alone.
  //
  // Ties go to the quieter (higher) threshold in both stages.
  const stage1 = grid.filter((row) => row.prearmRisk === ALARM_BUDGET_REFERENCE_PREARM_RISK);
  let selectedNudge = reference;
  for (const row of stage1) {
    if (row.admissible !== true) {
      continue;
    }
    if (
      selectedNudge.admissible !== true ||
      row.recallAt30sNudge > selectedNudge.recallAt30sNudge ||
      (row.recallAt30sNudge === selectedNudge.recallAt30sNudge &&
        row.nudgeRisk > selectedNudge.nudgeRisk)
    ) {
      selectedNudge = row;
    }
  }
  // Stage 2's guard rail. An over-eager pre-arm CONSUMES an escalation: the
  // reducer latches the pre-arm band, suppresses further nudges, and if the
  // needle then stands down before the onset the warning is spent for nothing.
  // So lowering the pre-arm line can cost NUDGE recall — the primary promise —
  // and the search must not be allowed to spend it. The tolerance is not a
  // guess: it is one standard error of a recall estimate on this search corpus,
  // sqrt(p(1−p)/onsets), because a difference smaller than that is not a
  // measurement. Anything outside it is a real loss and is refused.
  const recallSe =
    searchDrifts > 0
      ? Math.sqrt(
          (selectedNudge.recallAt30sNudge * (1 - selectedNudge.recallAt30sNudge)) / searchDrifts,
        )
      : 0;
  const nudgeRecallFloor = round4(selectedNudge.recallAt30sNudge - recallSe);
  const stage2 = grid.filter((row) => row.nudgeRisk === selectedNudge.nudgeRisk);
  let selected = selectedNudge;
  for (const row of stage2) {
    if (row.admissible !== true || row.recallAt30sNudge < nudgeRecallFloor) {
      continue;
    }
    if (
      selected.admissible !== true ||
      row.recallAt30sPrearm > selected.recallAt30sPrearm ||
      (row.recallAt30sPrearm === selected.recallAt30sPrearm && row.prearmRisk > selected.prearmRisk)
    ) {
      selected = row;
    }
  }
  console.log(
    `  stage 2 floor: nudge recall must stay ≥ ${nudgeRecallFloor} (stage 1's ` +
      `${selectedNudge.recallAt30sNudge} − 1 SE of ${round4(recallSe)} over ${searchDrifts} onsets)`,
  );
  console.log(
    `  reference (frozen ${ALARM_BUDGET_REFERENCE_NUDGE_RISK}/${ALARM_BUDGET_REFERENCE_PREARM_RISK}): ` +
      `${reference.nudgesPerHour.toFixed(2)} nudges/h ⇒ load ceiling ${loadCeiling.toFixed(2)}/h ` +
      `(×${ALARM_LOAD_ALLOWANCE}), recall ${reference.recallAt30sNudge.toFixed(4)} nudge / ` +
      `${reference.recallAt30sPrearm.toFixed(4)} pre-arm`,
  );
  console.log(
    `  stage 1 — the nudge line at the frozen pre-arm ${ALARM_BUDGET_REFERENCE_PREARM_RISK}:`,
  );
  for (const row of [...stage1, ...stage2]) {
    if (row === stage2[0]) {
      console.log(
        `  stage 2 — the pre-arm line at the selected nudge ${selectedNudge.nudgeRisk}:`,
      );
    }
    console.log(
      `    nudge ${row.nudgeRisk.toFixed(2)} / pre-arm ${row.prearmRisk.toFixed(2)} → recall ` +
        `${row.recallAt30sNudge.toFixed(4)} nudge / ${row.recallAt30sPrearm.toFixed(4)} pre-arm | ` +
        `${row.nudgesPerHour.toFixed(2)} nudges/h (${row.alarmsPerHour.toFixed(2)} alarms/h) | ` +
        `${row.falsePrearmsPerHour.toFixed(2)} false pre-arms/h | ` +
        `churn FPR ${row.researchChurnFprAtNudge.toFixed(4)}${row.admissible ? "" : "  (over budget)"}` +
        `${row === selected ? "  ← SELECTED" : row === selectedNudge ? "  ← nudge line" : ""}`,
    );
  }
  if (selected.nudgeRisk !== thresholds.nudge || selected.prearmRisk !== thresholds.prearm) {
    console.warn(
      `WARN operating point drifted: train-internal search selects nudge ${selected.nudgeRisk} / ` +
        `pre-arm ${selected.prearmRisk}, DEFAULT_SETTINGS says ${thresholds.nudge} / ${thresholds.prearm}. ` +
        `Update src/shared/defaults.ts (and docs/FORECAST-CONTRACTS.md §3) and re-run, or the shipped ` +
        `model runs off-optimum — eval.ts's parity assertion will fail first.`,
    );
  }

  // --- Provenance -----------------------------------------------------------
  const provenance = {
    manifest,
    train: {
      config: {
        seed: config.seed,
        epochs: config.maxEpochs,
        calibrationFraction: config.valFraction,
        posWeightPower: config.posWeightPower,
        lambdaPath: LAMBDAS,
        selectionMetric:
          `fold-val lead-censored (≥${SELECTION_LEAD_SEC}s) ROC-AUC + ${MLP_RECIPE.recallWeight} × ` +
          `nudge recall@30s through the shipped reducer — train-internal rows only`,
      },
      arch:
        `MLP ${FORECAST_BASIS} (${FORECAST_INPUT_DIM} features → ${FORECAST_HIDDEN_DIM} tanh units → 1 logit), ` +
        `${FORECAST_ENSEMBLE_MEMBERS} × ${FORECAST_INPUT_DIM}-${FORECAST_MEMBER_HIDDEN_DIM}-1 members ` +
        `collapsed EXACTLY into one net`,
      basisSha: FORECAST_BASIS_SHA,
      paramCount: FORECAST_PARAM_COUNT,
      paramsPerMember: netParamCount(spec.dims),
      forwardMultiplyAccumulates: FORECAST_FORWARD_MACS,
      optimizer: "Adam (β 0.9/0.999), weighted BCE + L2, bias unpenalized, constant LR",
      recipe: MLP_RECIPE,
      recipeSource:
        "hyper-parameters PINNED from data/forecast/candidates/mlp-tuned/metrics.json — the " +
        "contender's 10-stage sweep is NOT re-run here, so nothing is re-selected against the " +
        "corpus this model is then scored on",
      gradientCheckWorstRelErr: round6(worstGrad),
      rows: {
        total: rows.n,
        sessions: rows.sessions.length,
        calibrationRows: setup.calIndex.length,
        calibrationSessions: setup.calSessions.length,
        augmentedAttachedToParentFold: setup.attachedAugmented,
        augmentedDropped: setup.droppedAugmented,
        augmentationLineage: existsSync(parentsFile) ? AUGMENT_PARENTS_FILE : "MISSING",
      },
      leakFix:
        "augmented sessions are assigned to their PARENT's fold (or dropped when the parents " +
        "straddle folds / descend from the calibration slice). The round-7 trainer put jittered " +
        "and time-warped copies of its own validation sessions into its fit set, so every " +
        "early-stopping decision it made was read off an optimistic number.",
      members: memberLog,
      blend: {
        rule: "each member's logits z-scored on the calibration slice, then averaged",
        alpha: alpha.map(round6),
        beta: round6(beta),
        collapse: {
          exact: true,
          framesChecked: collapseChecked,
          maxRiskError: collapseMaxRiskError,
          serializationMaxRiskError: roundingMaxRiskError,
          note:
            "an affine blend of tanh nets over ONE shared input standardizer is a single " +
            "wider net; asserted against the ensemble scorer on real train frames before writing",
        },
      },
      calibration: {
        a: round6(calibration.a),
        b: round6(calibration.b),
        fittedOn: "the calibration slice only — rows no member ever trained on",
        method: "robust Newton of Lin–Weng–Keerthi (smoothed targets + backtracking line search)",
        calibrationSliceLeadAuc20: round6(calLeadAuc),
      },
      // The plain additive logistic (d + 1 params) — the "did you try logistic
      // regression?" reference and the model eval.ts's gate is anchored to.
      // Key name is historical; `basis` says which basis it actually is.
      referenceLr18: {
        basis: PLAIN_BASIS,
        params: FORECAST_INPUT_DIM + 1,
        lambda: plain.lambda,
        posWeightPower: config.posWeightPower,
        calLeadAuc20: round6(plain.auc),
        sweep: plainSweep,
      },
      operatingPoint: {
        rule:
          "TWO STAGES, because the product makes two promises with two budgets. Stage 1 picks the " +
          "NUDGE line at the frozen pre-arm reference: max recall@30s under the nudge rule (a " +
          "forecast_nudge or forecast_prearm event inside (onset−30s, onset]) subject to the " +
          "alarm-load ceiling — round 8's rule, unchanged. Stage 2 then picks the PRE-ARM line at " +
          "that nudge threshold: max recall@30s under the pre-arm rule (a pre-arm active at onset " +
          "or fired in the prior 30s — the fuse was actually shortened) subject to the design's " +
          "< 2 false pre-arms/hour and the same alarm-load ceiling. research_churn frame FPR ≤ " +
          "ceiling throughout. Ties go to the quieter threshold. A SINGLE joint objective on nudge " +
          "recall was tried first and is wrong: raising the pre-arm line deletes pre-arm events, " +
          "which buys alarm-load headroom, which buys a lower nudge threshold — so it selects the " +
          "worst pre-arm line on the grid (0.90, pre-arm recall 0.116) to win +0.07 of nudge recall.",
        bothAxes:
          "BOTH the nudge and the pre-arm threshold are searched. The inherited 0.80 pre-arm line " +
          "was derived for the previous GLM's risk scale; a threshold is a cut on a scale, and " +
          "round 10 measured every non-linear contender losing pre-arm recall at 0.80 for that " +
          "reason alone. Re-deriving it is the condition the round-10 recommendation made " +
          "non-negotiable before this swap.",
        selectedOn:
          `${FORECAST_ENSEMBLE_MEMBERS}-fold cross-fitted TRAIN sessions — a fold-f session is ` +
          "scored by member f (the only member whose fit set excluded it), rescaled to the shipped " +
          "blend's calibration-slice logit spread and read through the SHIPPED Platt; a " +
          "calibration-slice session is scored by the shipped net, which never trained on it. No " +
          "eval row is read here; no cross-fit model ships.",
        ceilings: {
          researchChurnFpr: CHURN_FPR_CEILING,
          alarmLoadAllowance: ALARM_LOAD_ALLOWANCE,
          referenceNudgeRisk: ALARM_BUDGET_REFERENCE_NUDGE_RISK,
          referencePrearmRisk: ALARM_BUDGET_REFERENCE_PREARM_RISK,
          referenceNudgesPerHour: reference.nudgesPerHour,
          nudgesPerHourCeiling: round4(loadCeiling),
          falsePrearmsPerHour: FALSE_PREARM_CEILING_PER_HOUR,
          loadMetric:
            "NUDGES per hour — the toast rate, exactly as round 8 defined it. Not nudges + " +
            "pre-arms: a pre-arm has its own stated budget (< 2 false pre-arms/hour) and putting " +
            "it under the nudge ratio as well double-counts it. Measured and tried: because " +
            "RAISING the pre-arm line deletes pre-arm events, a joint ceiling hands the search " +
            "free headroom to lower the nudge line and therefore selects the WORST pre-arm " +
            "threshold on the grid. alarmsPerHour is still reported on every row.",
          stage2NudgeRecallFloor: nudgeRecallFloor,
          stage2FloorRationale:
            "one standard error of a recall estimate on this search corpus, sqrt(p(1-p)/onsets). " +
            "An over-eager pre-arm consumes an escalation — the reducer latches the band, " +
            "suppresses nudges, and a stand-down before the onset spends the warning for nothing " +
            "— so the pre-arm axis is not allowed to measurably degrade the primary promise.",
        },
        searchSessions: crossFit.length,
        searchDrifts,
        searchHours: round4(searchHours),
        selectedNudgeRisk: selected.nudgeRisk,
        selectedPrearmRisk: selected.prearmRisk,
        stage1NudgeLine: selectedNudge,
        stage2: selected,
        shippedNudgeRisk: thresholds.nudge,
        shippedPrearmRisk: thresholds.prearm,
        matchesDefaultSettings:
          selected.nudgeRisk === thresholds.nudge && selected.prearmRisk === thresholds.prearm,
        reference,
        grid,
      },
    },
  };
  const provenanceSha = sha256Hex(canonicalJson(provenance));
  writeFileSync(join(forecastDataRoot(), PROVENANCE_FILE), JSON.stringify(provenance, null, 2));

  const weightsFile = buildWeights(thresholds.nudge, thresholds.prearm, provenanceSha);
  // The committed artifact must round-trip the fail-closed runtime parser.
  if (parseForecastWeights(JSON.parse(JSON.stringify(weightsFile))) === null) {
    throw new Error("trained weights failed parseForecastWeights — refusing to write");
  }
  writeFileSync(config.out, `${JSON.stringify(weightsFile, null, 2)}\n`);
  console.log(
    `weights → ${config.out} (${FORECAST_PARAM_COUNT} params, ${FORECAST_BASIS}@${FORECAST_BASIS_SHA}, ` +
      `provenance sha ${provenanceSha.slice(0, 12)}…, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
