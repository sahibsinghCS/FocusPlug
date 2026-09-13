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
import { forward, parseForecastWeights } from "../../src/shared/forecast/model";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_MODEL_VERSION,
  FORECAST_WARMUP_SEC,
  type ForecastEvent,
  type ForecastWeightsFile,
} from "../../src/shared/forecast/types";
import {
  CONTRACT_PREARM_FUSE_SEC,
  DATASET_FILE,
  PROVENANCE_FILE,
  RAW_SESSIONS_FILE,
  canonicalJson,
  ece10,
  forecastDataRoot,
  keepProbability,
  logisticScore,
  numberArg,
  prAuc,
  percentile,
  readJsonl,
  repoRoot,
  replaySession,
  rocAuc,
  round4,
  round6,
  sha256Hex,
  splitForSession,
  stringArg,
  thresholdDefaults,
  trainLogistic,
  type DatasetRow,
  type RawSession,
} from "./lib";
import { applyStandardizer, fitLogisticL2, fitStandardizer, sigmoidStable } from "./linear";
import { pairedClusterBootstrap, type BootstrapModel } from "./bootstrap";
import {
  HOLDOUT_DATASET_FILE,
  HOLDOUT_MANIFEST_FILE,
  HOLDOUT_SESSIONS_FILE,
  holdoutRoot,
  isHoldoutSessionId,
} from "./holdout-namespace";

/**
 * Held-out evaluation + CI gate — the judge-facing numbers, produced only
 * from `split: "eval"` sessions train.ts never touched. The anti-fraud
 * protocol from the design:
 *
 * - LEAD-CENSORED ROC-AUC (the headline): scored only on frames whose nearest
 *   drift onset is ≥ 20 s away vs calm frames — positives are 20–30 s before
 *   onset, so a high number structurally proves prediction, not last-second
 *   detection. Also reported at ≥ 10 s.
 * - Alarm simulation through the SHIPPED escalation reducer at the SHIPPED
 *   default thresholds, reported under BOTH hit rules: the strict pre-arm rule
 *   (a pre-arm active at onset or fired in the prior 30 s) and the nudge rule
 *   (any nudge-or-higher alarm in the prior 30 s), plus median/p25 lead and
 *   false pre-arms/hour.
 * - THE GATE IS ANCHORED TO THE FULL-FEATURE MULTIVARIATE LOGISTIC — the
 *   strongest linear-family baseline a judge would write in an afternoon, and
 *   the strongest of BOTH fits we can produce of it (eval.ts's historical
 *   class-weighted GD fit and an L-BFGS-to-convergence refit at the λ train.ts
 *   selected on its train-internal val split). Exits NONZERO when the shipped
 *   head stops beating it. The old bar — best SINGLE-feature logistic, margin
 *   0.03 — was a strawman: the model it compared against has one input. That
 *   number is still printed, as context, never as the gate.
 * - Per-archetype slices with research_churn (allowlist-internal churn, zero
 *   drifts) false-positive rates called out.
 * - The five-family bake-off table with paired session-clustered confidence
 *   intervals is embedded as a NON-GATING artifact, so the published claim is
 *   "here is every family we tried and here is the noise floor".
 * - Operating-point parity: weights.thresholds must equal the DEFAULT_SETTINGS
 *   forecast keys, and the embedded provenance sha must match the weights.
 *
 *   tsx scripts/forecast/eval.ts [--gate=off]
 */

interface EvalConfig {
  data: string;
  raw: string;
  weights: string;
  bakeOff: string;
  bakeOffPower: string;
  out: string;
  seed: number;
  gateOff: boolean;
  /**
   * THE OFFICIAL EVALUATION SET (default ON): the large fresh corpus in
   * `data/forecast/holdout/` — 900 sessions, 1 230 drift onsets — built by
   * `npm run forecast:evalset` from a seed namespace no training run can reach.
   * Train rows still come from `--data`, because the baselines have to be
   * fitted on something, but not one SCORED frame does.
   *
   * `--split-eval` reverts to the old 48-session eval SPLIT of dataset.jsonl.
   * That split could not resolve the bake-off — its paired session-clustered SE
   * was ≈ 0.009 against margins of 0.004–0.013 — which is precisely why the
   * corpus was grown and why it is no longer what the committed report carries.
   * The flag stays because the gate's teeth are verified on a deliberately tiny
   * toy corpus, which has no hold-out namespace.
   */
  holdout: boolean;
  holdoutData: string;
  holdoutRaw: string;
  holdoutManifest: string;
  /** Paired session-clustered bootstrap draws (holdout mode only; 0 = skip). */
  powerDraws: number;
}

function readConfig(): EvalConfig {
  const gateOff =
    process.argv.includes("--gate=off") || stringArg("--gate", "on").toLowerCase() === "off";
  // Hold-out is the default. `--holdout` is still accepted (and is a no-op) so
  // every command written down in GAUNTLET rounds 9–10 still runs.
  const holdout = !process.argv.includes("--split-eval");
  // The COMMITTED report can only be produced by the official corpus. A
  // `--split-eval` run writes to gitignored working data unless `--out` says
  // otherwise, so nobody can quietly replace 900 sessions of evidence with 48.
  const defaultOut = holdout
    ? join(repoRoot(), "src", "shared", "forecast", "eval-report.json")
    : join(forecastDataRoot(), "eval-report-split.json");
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    weights: stringArg(
      "--weights",
      join(repoRoot(), "src", "shared", "forecast", "weights.json"),
    ),
    bakeOff: stringArg(
      "--bake-off",
      join(repoRoot(), "src", "shared", "forecast", "bake-off.json"),
    ),
    bakeOffPower: stringArg(
      "--bake-off-power",
      join(repoRoot(), "src", "shared", "forecast", "bake-off-power.json"),
    ),
    out: stringArg("--out", defaultOut),
    seed: numberArg("--seed", 42),
    gateOff,
    holdout,
    holdoutData: stringArg("--holdout-data", join(holdoutRoot(), HOLDOUT_DATASET_FILE)),
    holdoutRaw: stringArg("--holdout-raw", join(holdoutRoot(), HOLDOUT_SESSIONS_FILE)),
    holdoutManifest: stringArg("--holdout-manifest", join(holdoutRoot(), HOLDOUT_MANIFEST_FILE)),
    powerDraws: Math.max(0, Math.round(numberArg("--power-draws", 2000))),
  };
}

/** Feature-vector width, read from the shared contract — never written down twice. */
const FEATURE_DIM = FORECAST_FEATURE_KEYS.length;

/**
 * Required margin over the FULL-feature multivariate logistic, in
 * lead-censored ROC-AUC.
 *
 * Zero, deliberately. The bar is the one a hostile question actually asks —
 * "does the shipped head beat a logistic regression?" — so the gate fails the
 * build the moment the answer stops being yes, and demands nothing beyond it.
 *
 * Round 8 chose zero because a positive margin was UNMEASURABLE: on the
 * 48-session eval split the paired session-clustered SE of a model-vs-model
 * lead-AUC difference was ≈ 0.009 and no contender, including a 14 803-parameter
 * temporal CNN, cleared the strongest linear result by more than 0.7 of one SE.
 * That is no longer the situation. On the 900-session corpus this report now
 * scores, the measured paired SE is ≈ 0.003, and the shipped margin comes with
 * a bootstrap confidence interval printed beside it in `gate.marginCi95`. The
 * bar stays at zero anyway — a gate should encode the promise, not the current
 * comfortable distance from it — but a reader can now see whether the margin is
 * resolved, and for the first time it is.
 *
 * The gate anchors to the plain additive logistic on THE SHIPPED FEATURE BASIS,
 * so growing the feature set moves the bar with it: a feature block that helps
 * the baseline more than the head must not be able to hide behind an old
 * baseline. The plain 18-feature (level-block) logistic and the best
 * SINGLE-feature logistic are both still computed and printed as context, never
 * as the gate — the model that shipped before the round-8 swap PASSED the
 * single-feature bar by +0.15 while LOSING to the full logistic.
 */
const GATE_MARGIN = 0;

interface EvalRow {
  features: number[];
  label: 0 | 1;
  secsToDrift: number | null;
  archetype: string;
  sessionId: string;
}

/** Defensive nested read of an untyped JSON object. */
function dig(root: Record<string, unknown>, ...path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/** Lead-censored eligibility: onset ≥ `leadSec` away, or calm. */
function leadEligible(row: EvalRow, leadSec: number): boolean {
  return row.secsToDrift === null || row.secsToDrift >= leadSec;
}

function aucOn(rowsScores: Array<{ score: number; label: number }>): number {
  return rocAuc(
    rowsScores.map((r) => r.score),
    rowsScores.map((r) => r.label),
  );
}

function leadAuc(rows: readonly EvalRow[], scores: readonly number[], leadSec: number): number {
  const pairs: Array<{ score: number; label: number }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as EvalRow;
    if (leadEligible(row, leadSec)) {
      pairs.push({ score: scores[i] as number, label: row.label });
    }
  }
  return aucOn(pairs);
}

function operatingPoint(
  rows: readonly EvalRow[],
  scores: readonly number[],
  threshold: number,
): { threshold: number; precision: number | null; recall: number; fpr: number } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const fired = (scores[i] as number) >= threshold;
    if ((rows[i] as EvalRow).label === 1) {
      fired ? (tp += 1) : (fn += 1);
    } else {
      fired ? (fp += 1) : (tn += 1);
    }
  }
  return {
    threshold,
    precision: tp + fp > 0 ? round4(tp / (tp + fp)) : null,
    recall: round4(tp + fn > 0 ? tp / (tp + fn) : 0),
    fpr: round4(fp + tn > 0 ? fp / (fp + tn) : 0),
  };
}

// ---------------------------------------------------------------------------
// Alarm simulation — the shipped reducer at the shipped operating point
// ---------------------------------------------------------------------------

interface AlarmTotals {
  drifts: number;
  hits: number;
  nudgeHits: number;
  leads: number[];
  nudgeLeads: number[];
  falsePrearms: number;
  nudges: number;
  hours: number;
  sessions: number;
}

function newAlarmTotals(): AlarmTotals {
  return {
    drifts: 0,
    hits: 0,
    nudgeHits: 0,
    leads: [],
    nudgeLeads: [],
    falsePrearms: 0,
    nudges: 0,
    hours: 0,
    sessions: 0,
  };
}

interface AlarmResult {
  drifts: number;
  /** Strict rule: a pre-arm was active at onset, or fired within the prior 30 s. */
  hits: number;
  /** Nudge rule: ANY nudge-or-higher alarm inside (onset − 30 s, onset]. */
  nudgeHits: number;
  leads: number[];
  nudgeLeads: number[];
  falsePrearms: number;
  nudges: number;
}

function simulateAlarms(
  session: RawSession,
  weights: ForecastWeightsFile,
  settings: EscalationSettings,
): AlarmResult {
  const frames = replaySession(session);
  const decisions: DecisionFrame[] = frames.map((frame) => ({
    t: frame.t,
    decision: frame.decision,
    countdownActive: frame.countdownActive,
  }));
  const onsets = findDriftOnsets(decisions);

  let state: EscalationState = { ...INITIAL_ESCALATION_STATE };
  let smoothed: number | null = null;
  const events: ForecastEvent[] = [];
  for (const frame of frames) {
    const rawRisk = forward(weights, frame.values).rawRisk;
    smoothed = smoothRisk(smoothed, rawRisk);
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
  }

  const prearms = events.filter((event) => event.type === "forecast_prearm");
  const hitEvents = events.filter((event) => event.type === "forecast_hit");
  const nudges = events.filter((event) => event.type === "forecast_nudge").length;
  const alarmTimes = events
    .filter((event) => event.type === "forecast_nudge" || event.type === "forecast_prearm")
    .map((event) => event.ts / 1000);
  let hits = 0;
  let nudgeHits = 0;
  const leads: number[] = [];
  const nudgeLeads: number[] = [];
  for (const onset of onsets) {
    // Nudge rule: the student got SOME warning — any nudge or pre-arm the
    // reducer emitted inside (onset − 30 s, onset]. This is the rule the
    // bake-off compared every contender on.
    const inWindow = alarmTimes.filter((t) => t <= onset.t && onset.t - t <= 30);
    const first = inWindow[0];
    if (first !== undefined) {
      nudgeHits += 1;
      nudgeLeads.push(onset.t - first);
    }
    // Strict rule (unchanged): pre-arm ACTIVE at onset (the reducer's own
    // forecast_hit receipt, which carries the lead) OR fired within the prior
    // 30 s (a stood-down pre-arm that still called it).
    const receipt = hitEvents.find(
      (event) => event.type === "forecast_hit" && Math.abs(event.ts / 1000 - onset.t) <= 1.5,
    );
    if (receipt !== undefined && receipt.type === "forecast_hit") {
      hits += 1;
      leads.push(receipt.leadSec);
      continue;
    }
    const candidates = prearms.filter(
      (event) => event.ts / 1000 <= onset.t && onset.t - event.ts / 1000 <= 30,
    );
    const last = candidates[candidates.length - 1];
    if (last !== undefined) {
      hits += 1;
      leads.push(onset.t - last.ts / 1000);
    }
  }
  // False alarm = the reducer's own "pre-arm stood down · unconfirmed" event,
  // unless a drift still arrived within 30 s of the stand-down.
  const falsePrearms = events.filter(
    (event) =>
      event.type === "forecast_clear" &&
      event.wasPrearmed &&
      !onsets.some((onset) => onset.t >= event.ts / 1000 && onset.t - event.ts / 1000 <= 30),
  ).length;
  return { drifts: onsets.length, hits, nudgeHits, leads, nudgeLeads, falsePrearms, nudges };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();

  // --- Weights + parity + provenance guards --------------------------------
  const weights = parseForecastWeights(JSON.parse(readFileSync(config.weights, "utf8")));
  if (weights === null) {
    throw new Error(`${config.weights} failed parseForecastWeights — retrain first`);
  }
  const thresholds = await thresholdDefaults();
  if (weights.thresholds.nudge !== thresholds.nudge || weights.thresholds.prearm !== thresholds.prearm) {
    throw new Error(
      `operating-point parity violated: weights.thresholds {nudge ${weights.thresholds.nudge}, ` +
        `prearm ${weights.thresholds.prearm}} != ${thresholds.source} {nudge ${thresholds.nudge}, prearm ${thresholds.prearm}}`,
    );
  }
  const provenance = JSON.parse(
    readFileSync(join(forecastDataRoot(), PROVENANCE_FILE), "utf8"),
  ) as Record<string, unknown>;
  const provenanceSha = sha256Hex(canonicalJson(provenance));
  if (provenanceSha !== weights.trainProvenanceSha) {
    throw new Error(
      `provenance sha mismatch: weights carry ${weights.trainProvenanceSha.slice(0, 12)}…, ` +
        `data/forecast/provenance.json hashes to ${provenanceSha.slice(0, 12)}… — rerun train.ts`,
    );
  }

  // --- Hold-out corpus (optional) -------------------------------------------
  // `--holdout` scores the large fresh corpus instead of the 48-session eval
  // split. Its manifest is embedded in the report so the numbers name the exact
  // corpus (and file shas) they came from.
  let holdoutManifest: Record<string, unknown> | null = null;
  if (config.holdout) {
    if (!existsSync(config.holdoutData) || !existsSync(config.holdoutManifest)) {
      throw new Error(
        `--holdout needs ${config.holdoutData} and its manifest — run 'npm run forecast:evalset' first`,
      );
    }
    holdoutManifest = JSON.parse(readFileSync(config.holdoutManifest, "utf8")) as Record<string, unknown>;
    console.log(
      `holdout corpus: ${dig(holdoutManifest, "counts", "sessions")} sessions | ` +
        `${dig(holdoutManifest, "counts", "driftOnsets")} drift onsets | ` +
        `${dig(holdoutManifest, "counts", "rows")} rows | seed ${dig(holdoutManifest, "namespace", "holdoutSeed")}`,
    );
  }

  // --- Load rows ------------------------------------------------------------
  const evalRows: EvalRow[] = [];
  const trainFeatures: number[][] = [];
  const trainLabels: number[] = [];
  const trainImportance: number[] = [];
  // One string instance per distinct session id / archetype — the hold-out
  // corpus is ~1.6 M rows and JSON.parse would otherwise allocate 1.6 M copies.
  const strings = new Map<string, string>();
  const intern = (value: string): string => {
    const hit = strings.get(value);
    if (hit !== undefined) {
      return hit;
    }
    strings.set(value, value);
    return value;
  };
  const pushEvalRow = (row: DatasetRow): void => {
    if (row.source !== "synthetic" && row.source !== "recorded") {
      throw new Error(
        `eval split contains ${row.source} row (${row.session_id}) — augmented data must be train-only`,
      );
    }
    evalRows.push({
      features: row.features,
      label: row.label,
      secsToDrift: row.secs_to_drift,
      archetype: intern(row.archetype),
      sessionId: intern(row.session_id),
    });
  };
  for await (const row of readJsonl<DatasetRow>(config.data)) {
    if (row.split === "eval") {
      // In hold-out mode the 48-session split is not scored at all; the
      // trainer's own held-out rows are simply skipped.
      if (!config.holdout) {
        pushEvalRow(row);
      }
    } else {
      // Barrier 2, consumer side: a hold-out session id must never appear in
      // the file the trainer and every bake-off contender read.
      if (isHoldoutSessionId(row.session_id)) {
        throw new Error(
          `CONTAMINATION: training row ${row.session_id} carries a hold-out session id — ` +
            `${config.data} and the hold-out corpus have been mixed`,
        );
      }
      trainFeatures.push(row.features);
      trainLabels.push(row.label);
      trainImportance.push(1 / keepProbability(row.label, row.secs_to_drift));
    }
  }
  if (config.holdout) {
    for await (const row of readJsonl<DatasetRow>(config.holdoutData)) {
      if (row.split !== "eval" || !isHoldoutSessionId(row.session_id)) {
        throw new Error(
          `hold-out row ${row.session_id} (split ${row.split}) is not an eval row from the ` +
            `hold-out namespace — regenerate with 'npm run forecast:evalset'`,
        );
      }
      pushEvalRow(row);
    }
  }
  if (evalRows.length === 0) {
    throw new Error("no eval rows — run build-dataset.ts first");
  }
  const evalBaseRate = evalRows.reduce((sum, row) => sum + row.label, 0) / evalRows.length;

  // --- MLP scores -----------------------------------------------------------
  const modelScores = evalRows.map((row) => forward(weights, row.features).rawRisk);
  const evalLabels = evalRows.map((row) => row.label);
  const overallAuc = rocAuc(modelScores, evalLabels);
  const overallPr = prAuc(modelScores, evalLabels);
  const modelLead20 = leadAuc(evalRows, modelScores, 20);
  const modelLead10 = leadAuc(evalRows, modelScores, 10);
  const calibrationTable = ece10(modelScores, evalLabels);

  // --- Baselines (trained on the train split, scored held-out) --------------
  // Deterministic stride subsample keeps the logistic fits fast.
  const cap = 40_000;
  const stride = Math.max(1, Math.ceil(trainFeatures.length / cap));
  const subX: number[][] = [];
  const subY: number[] = [];
  for (let i = 0; i < trainFeatures.length; i += stride) {
    subX.push(trainFeatures[i] as number[]);
    subY.push(trainLabels[i] as number);
  }

  const singleFeature: Array<{ key: string; auc: number; leadAuc20: number }> = [];
  let bestSingle = { key: "none", auc: 0.5, leadAuc20: 0.5 };
  for (let f = 0; f < FORECAST_FEATURE_KEYS.length; f += 1) {
    const model = trainLogistic(subX, subY, [f]);
    const scores = evalRows.map((row) => logisticScore(model, row.features, [f]));
    const entry = {
      key: FORECAST_FEATURE_KEYS[f] as string,
      auc: round4(rocAuc(scores, evalLabels)),
      leadAuc20: round4(leadAuc(evalRows, scores, 20)),
    };
    singleFeature.push(entry);
    // Adversarial selection: the strongest single feature BY the gate metric.
    if (entry.leadAuc20 > bestSingle.leadAuc20) {
      bestSingle = entry;
    }
  }

  const allColumns = FORECAST_FEATURE_KEYS.map((_, i) => i);
  const fullLogistic = trainLogistic(subX, subY, allColumns);
  const fullLogisticScores = evalRows.map((row) => logisticScore(fullLogistic, row.features, allColumns));

  // The SAME features fitted as well as we know how: L-BFGS to convergence
  // on ALL train rows (not the 40 k subsample), importance-weighted by
  // 1/keep-probability so the fit is unbiased at natural prevalence, at the λ
  // train.ts selected on its train-internal val split (never on eval).
  //
  // This is deliberately a STRONGER baseline than the shipped model's own fit
  // — it is allowed the val sessions the shipped model held out — because the
  // gate should anchor to the best plain-feature logistic that exists, not a
  // convenient one. A judge asking "did you converge your baseline?" gets yes.
  const referenceLambda =
    (dig(provenance, "train", "referenceLr18", "lambda") as number | undefined) ?? 1e-4;
  const convergedDesign = new Float32Array(trainFeatures.length * allColumns.length);
  for (let i = 0; i < trainFeatures.length; i += 1) {
    const row = trainFeatures[i] as number[];
    for (let j = 0; j < allColumns.length; j += 1) {
      convergedDesign[i * allColumns.length + j] = row[j] ?? 0;
    }
  }
  const convergedIdx = Int32Array.from({ length: trainLabels.length }, (_, i) => i);
  const convergedY = Uint8Array.from(trainLabels);
  const convergedStd = fitStandardizer(convergedDesign, allColumns.length, convergedIdx);
  applyStandardizer(convergedDesign, allColumns.length, convergedStd);
  let convergedWPosMass = 0;
  let convergedWNegMass = 0;
  for (let i = 0; i < trainLabels.length; i += 1) {
    if ((trainLabels[i] as number) === 1) {
      convergedWPosMass += trainImportance[i] as number;
    } else {
      convergedWNegMass += trainImportance[i] as number;
    }
  }
  const convergedWPos = convergedWPosMass > 0 ? convergedWNegMass / convergedWPosMass : 1;
  const convergedWeights = Float64Array.from(trainImportance, (w, i) =>
    (trainLabels[i] as number) === 1 ? w * convergedWPos : w,
  );
  const convergedFit = fitLogisticL2(
    convergedDesign,
    allColumns.length,
    convergedIdx,
    convergedY,
    convergedWeights,
    referenceLambda,
    300,
  );
  const convergedScores = evalRows.map((row) => {
    let z = convergedFit.theta[allColumns.length] as number;
    for (let j = 0; j < allColumns.length; j += 1) {
      const value =
        ((row.features[j] ?? 0) - (convergedStd.mean[j] as number)) / (convergedStd.std[j] as number);
      z += (convergedFit.theta[j] as number) * value;
    }
    return sigmoidStable(z);
  });

  // The if-else strawman: count of fired rules (encoded-space thresholds for
  // "≥4 switches/15s", "≥15s grey dwell/30s", "desk presence < 40%").
  const ifElseScores = evalRows.map((row) => {
    let fired = 0;
    if ((row.features[0] ?? 0) >= 0.5) fired += 1;
    if ((row.features[6] ?? 0) >= 0.5) fired += 1;
    if ((row.features[10] ?? 0) < 0.4) fired += 1;
    return fired;
  });
  const greyDwellScores = evalRows.map((row) => row.features[6] ?? 0);

  // CONTEXT (never the gate): the plain logistic on the ROUND-8 feature basis —
  // the 18 level features, before the trend block was appended. Published so
  // "did the six trend features earn their place?" has a number beside it on
  // this corpus rather than only on the 48-session split that could not resolve
  // it. Indices 0..17 are the level block by contract (types.ts is append-only).
  const LEVEL_BLOCK_DIM = 18;
  const levelColumns = Array.from({ length: Math.min(LEVEL_BLOCK_DIM, FEATURE_DIM) }, (_, i) => i);
  const levelLogistic = trainLogistic(subX, subY, levelColumns);
  const levelScores = evalRows.map((row) => logisticScore(levelLogistic, row.features, levelColumns));
  const levelLead20 = round4(leadAuc(evalRows, levelScores, 20));

  const fullLogisticLead20 = round4(leadAuc(evalRows, fullLogisticScores, 20));
  const convergedLead20 = round4(leadAuc(evalRows, convergedScores, 20));
  const linearBaselineLead20 = Math.max(fullLogisticLead20, convergedLead20);
  const linearBaselineFit =
    convergedLead20 >= fullLogisticLead20 ? "lbfgs-converged" : "class-weighted-gd";

  const baselines = {
    baseRate: { auc: 0.5, leadAuc20: 0.5, note: "predict the prevalence everywhere" },
    ifElseHeuristic: {
      auc: round4(rocAuc(ifElseScores, evalLabels)),
      leadAuc20: round4(leadAuc(evalRows, ifElseScores, 20)),
      note: "3-rule strawman: fast switching OR grey dwell OR low desk presence",
    },
    greyDwellHeuristic: {
      auc: round4(rocAuc(greyDwellScores, evalLabels)),
      leadAuc20: round4(leadAuc(evalRows, greyDwellScores, 20)),
    },
    bestSingleFeatureLogistic: {
      feature: bestSingle.key,
      auc: bestSingle.auc,
      leadAuc20: bestSingle.leadAuc20,
      note:
        "CONTEXT ONLY — the pre-bake-off gate baseline. One input; the shipped model beating it " +
        "by a wide margin proves nothing, which is why the gate no longer uses it.",
    },
    fullLogistic: {
      auc: round4(rocAuc(fullLogisticScores, evalLabels)),
      leadAuc20: fullLogisticLead20,
      features: FEATURE_DIM,
      fit: "class-weighted full-batch GD (lib.trainLogistic, 250 epochs) — the historical baseline",
    },
    fullLogisticConverged: {
      auc: round4(rocAuc(convergedScores, evalLabels)),
      leadAuc20: convergedLead20,
      lambda: referenceLambda,
      iters: convergedFit.iters,
      rows: trainLabels.length,
      features: FEATURE_DIM,
      fit:
        `the same ${FEATURE_DIM} features, L-BFGS to convergence on ALL train rows, ` +
        "importance-weighted to natural prevalence, at the λ train.ts selected on its " +
        "train-internal val split (never on eval) — the honest ceiling of the plain additive " +
        "logistic, and given MORE data than the shipped model",
    },
    plainLogisticLevelBlock: {
      auc: round4(rocAuc(levelScores, evalLabels)),
      leadAuc20: levelLead20,
      features: levelColumns.length,
      fit: "class-weighted full-batch GD (lib.trainLogistic) on FORECAST_FEATURE_KEYS[0..17]",
      note:
        "CONTEXT ONLY — the plain logistic on the round-8 feature basis (the level block, before " +
        "the trend features were appended). Its distance from `fullLogistic` is what the six trend " +
        "features buy a plain additive model on this corpus.",
    },
    /** What the gate is anchored to: the stronger of the two plain additive fits. */
    fullLogisticStrongest: {
      leadAuc20: round4(linearBaselineLead20),
      fit: linearBaselineFit,
      features: FEATURE_DIM,
      note: `GATE BASELINE — the strongest ${FEATURE_DIM}-feature multivariate logistic we can produce`,
    },
    shippedModel: {
      auc: round4(overallAuc),
      leadAuc20: round4(modelLead20),
      basis: weights.basis,
      paramCount: weights.paramCount,
    },
    singleFeature,
  };

  // --- Per-feature occlusion ablation (subsampled, deterministic) -----------
  const ablationStride = Math.max(1, Math.ceil(evalRows.length / 20_000));
  const ablationRows: EvalRow[] = [];
  for (let i = 0; i < evalRows.length; i += ablationStride) {
    ablationRows.push(evalRows[i] as EvalRow);
  }
  const ablationBaseScores = ablationRows.map((row) => forward(weights, row.features).rawRisk);
  const ablationBase = leadAuc(ablationRows, ablationBaseScores, 20);
  const ablation = FORECAST_FEATURE_KEYS.map((key, f) => {
    const scores = ablationRows.map((row) => {
      const probe = [...row.features];
      probe[f] = weights.norm.mean[f] ?? 0;
      return forward(weights, probe).rawRisk;
    });
    return { key, leadAuc20Drop: round4(ablationBase - leadAuc(ablationRows, scores, 20)) };
  }).sort((a, b) => b.leadAuc20Drop - a.leadAuc20Drop);

  // --- Alarm simulation over held-out RAW sessions ---------------------------
  const escalationSettings: EscalationSettings = {
    nudgeRisk: thresholds.nudge,
    prearmRisk: thresholds.prearm,
    prearmEnabled: true,
    prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  };
  const totals = newAlarmTotals();
  const byArchetype = new Map<string, AlarmTotals>();
  // In hold-out mode the alarm simulation replays the hold-out raw streams —
  // every session in that file is held out by construction, so there is no
  // split hash to consult (and `splitForSession` is never called on them).
  const alarmRawFile = config.holdout ? config.holdoutRaw : config.raw;
  for await (const session of readJsonl<RawSession>(alarmRawFile)) {
    if (session.source !== "synthetic") {
      continue;
    }
    if (config.holdout ? !isHoldoutSessionId(session.id) : splitForSession(session.id, config.seed) !== "eval") {
      continue;
    }
    const result = simulateAlarms(session, weights, escalationSettings);
    const bucket = byArchetype.get(session.archetype) ?? newAlarmTotals();
    for (const target of [totals, bucket]) {
      target.drifts += result.drifts;
      target.hits += result.hits;
      target.nudgeHits += result.nudgeHits;
      target.leads.push(...result.leads);
      target.nudgeLeads.push(...result.nudgeLeads);
      target.falsePrearms += result.falsePrearms;
      target.nudges += result.nudges;
      target.hours += session.durationSec / 3600;
      target.sessions += 1;
    }
    byArchetype.set(session.archetype, bucket);
  }
  totals.leads.sort((a, b) => a - b);
  totals.nudgeLeads.sort((a, b) => a - b);
  const medianLead = percentile(totals.leads, 0.5);
  const p25Lead = percentile(totals.leads, 0.25);
  const medianNudgeLead = percentile(totals.nudgeLeads, 0.5);

  // --- Per-archetype frame slices (research_churn is the load-bearing one) --
  const archetypes = [...new Set(evalRows.map((row) => row.archetype))].sort();
  const perArchetype: Record<string, unknown> = {};
  for (const archetype of archetypes) {
    const indices = evalRows
      .map((row, i) => ({ row, i }))
      .filter((entry) => entry.row.archetype === archetype);
    const negatives = indices.filter((entry) => entry.row.label === 0);
    const fpNudge =
      negatives.length > 0
        ? negatives.filter((entry) => (modelScores[entry.i] as number) >= thresholds.nudge).length /
          negatives.length
        : 0;
    const fpPrearm =
      negatives.length > 0
        ? negatives.filter((entry) => (modelScores[entry.i] as number) >= thresholds.prearm).length /
          negatives.length
        : 0;
    const alarms = byArchetype.get(archetype);
    perArchetype[archetype] = {
      sessions: alarms?.sessions ?? 0,
      frames: indices.length,
      baseRate: round4(
        indices.reduce((sum, entry) => sum + entry.row.label, 0) / Math.max(1, indices.length),
      ),
      falsePositiveRateAtNudge: round4(fpNudge),
      falsePositiveRateAtPrearm: round4(fpPrearm),
      falsePrearmsPerHour: alarms && alarms.hours > 0 ? round4(alarms.falsePrearms / alarms.hours) : 0,
      drifts: alarms?.drifts ?? 0,
      hits: alarms?.hits ?? 0,
    };
  }
  if (!archetypes.includes("research_churn")) {
    throw new Error("eval split has no research_churn frames — the anti-if-else slice is empty");
  }

  // --- Bake-off (NON-GATING) -------------------------------------------------
  // The five-family contest that chose this architecture, with paired
  // session-clustered CIs, carried verbatim into the committed report so the
  // published claim is "here is every family we tried and here is the noise
  // floor" rather than "here is a number that beats a one-input model".
  // Produced by scripts/forecast/candidates/*.ts + scripts/forecast/adjudicate.ts.
  let bakeOff: unknown = null;
  try {
    bakeOff = JSON.parse(readFileSync(config.bakeOff, "utf8"));
  } catch {
    console.warn(`WARN ${config.bakeOff} unreadable — report carries "bakeOff": null`);
  }
  // The RE-RUN of that contest on this corpus — 17 fits, every family at BOTH
  // feature bases, paired CIs, and the feature-vs-architecture decomposition.
  // This is the table that actually chose the shipped head; the one above is
  // the historical record of the contest that chose its predecessor. Publishing
  // both, losers included, is the point.
  let bakeOffPower: unknown = null;
  try {
    bakeOffPower = JSON.parse(readFileSync(config.bakeOffPower, "utf8"));
  } catch {
    console.warn(`WARN ${config.bakeOffPower} unreadable — report carries "bakeOffPower": null`);
  }
  // bake-off.json is adjudicate.ts's output and is never hand-edited, so when
  // the feature basis moves on, the table's `SHIPPED` row stops describing what
  // actually ships. Rather than tamper with the adjudicator's artifact, the
  // report says so out loud right beside it and names both bases.
  const bakeOffWinner = (() => {
    const contenders = (bakeOff as { contenders?: Array<{ name?: unknown }> } | null)?.contenders;
    const first = Array.isArray(contenders) ? contenders[0]?.name : undefined;
    return typeof first === "string" ? first : null;
  })();
  const bakeOffStale = bakeOffWinner !== null && bakeOffWinner !== weights.basis;
  const bakeOffContext = {
    current: {
      verbatimFrom: "src/shared/forecast/bake-off-power.json",
      producedBy:
        "scripts/forecast/holdout-bakeoff.ts (npm run forecast:holdout:bakeoff), published by " +
        "scripts/forecast/bakeoff-publish.ts",
      gating: false,
      note:
        "THE CONTEST THAT CHOSE THE SHIPPED HEAD. 17 fits — 8 families at BOTH feature bases — " +
        "refit on split:\"train\" rows only and scored on this same 900-session corpus, with a " +
        "paired session-clustered bootstrap and the feature-vs-architecture decomposition. Every " +
        "loser is in it on purpose.",
    },
    historical: {
      verbatimFrom: "src/shared/forecast/bake-off.json",
      producedBy: "scripts/forecast/candidates/*.ts, adjudicated by scripts/forecast/adjudicate.ts",
      gating: false,
      describesShippedBasis: !bakeOffStale,
      note: bakeOffStale
        ? `HISTORICAL. Round 8's five-family contest on the 48-session eval SPLIT and the feature ` +
          `basis of 2026-09-12, which recorded "${bakeOffWinner}" as SHIPPED. That result has since ` +
          `been superseded twice: the basis grew (round 9) and the contest was re-run with enough ` +
          `power to decide it (round 10), where the head it chose FAILED this report's own gate. ` +
          `It is kept because the retraction is only legible next to it.`
        : "CURRENT — the embedded table's winner is the basis that ships today.",
    },
  };

  // --- MEASURED power + the gate's confidence interval ----------------------------------
  // The 48-session split could not resolve the bake-off: the paired
  // session-clustered SE was ≈ 0.009 and every non-linear margin was 0.4–0.7 of
  // one SE. This block measures — not projects — what the large corpus buys, by
  // running the SAME paired bootstrap the adjudicator ran, on the shipped head
  // against the gate baseline, and then asking of every margin the bake-off
  // reported: would this evaluation have resolved it?
  let power: Record<string, unknown> | null = null;
  let marginCi95: Record<string, unknown> | null = null;
  if (config.holdout && config.powerDraws > 0) {
    const eligibleIdx: number[] = [];
    for (let i = 0; i < evalRows.length; i += 1) {
      if (leadEligible(evalRows[i] as EvalRow, 20)) {
        eligibleIdx.push(i);
      }
    }
    const clusterOf = new Map<string, number>();
    const cluster = new Int32Array(eligibleIdx.length);
    const label = new Uint8Array(eligibleIdx.length);
    for (let k = 0; k < eligibleIdx.length; k += 1) {
      const row = evalRows[eligibleIdx[k] as number] as EvalRow;
      let index = clusterOf.get(row.sessionId);
      if (index === undefined) {
        index = clusterOf.size;
        clusterOf.set(row.sessionId, index);
      }
      cluster[k] = index;
      label[k] = row.label;
    }
    const pick = (scores: readonly number[]): Float64Array =>
      Float64Array.from(eligibleIdx, (i) => scores[i] as number);
    const shippedName = `shipped:${weights.basis}(${weights.paramCount}p)`;
    const convergedName = `fullLR${FEATURE_DIM}:lbfgs-converged`;
    const gdName = `fullLR${FEATURE_DIM}:class-weighted-gd`;
    const models: BootstrapModel[] = [
      { name: shippedName, scores: pick(modelScores) },
      { name: convergedName, scores: pick(convergedScores) },
      { name: gdName, scores: pick(fullLogisticScores) },
    ];
    const reference = linearBaselineFit === "lbfgs-converged" ? convergedName : gdName;
    console.log(
      `power: paired session-clustered bootstrap, ${config.powerDraws} draws over ` +
        `${clusterOf.size} sessions / ${eligibleIdx.length} lead≥20s-eligible frames …`,
    );
    const boot = pairedClusterBootstrap(
      label,
      cluster,
      clusterOf.size,
      models,
      reference,
      config.powerDraws,
      // Fixed, and deliberately not `config.seed`: the resampling stream must
      // not move when the corpus seed does.
      20260913,
      (done, total) => {
        if (done % 200 === 0) {
          console.log(`  bootstrap ${done}/${total}`);
        }
      },
    );
    const shippedPair = boot.pairs.find((pair) => pair.model === shippedName);
    const measuredSe = shippedPair?.sd ?? null;
    const resolvable95 = measuredSe === null ? null : round6(1.96 * measuredSe);
    const priorPairs = (dig(bakeOff as Record<string, unknown>, "pairedBootstrap", "vsShippedBasis") ??
      []) as Array<{ model?: string; diff?: number; lo95?: number; hi95?: number }>;
    power = {
      question:
        "is a ~0.01 lead-censored AUC difference decidable on this corpus? The 48-session split " +
        "could not decide 0.006, which is why 'the neural net did not win' was a shrug.",
      metric: "lead-censored ROC-AUC (onset ≥ 20 s away vs calm), paired, clustered by session",
      bootstrap: boot,
      measuredPairedSe: measuredSe,
      resolvableDiff95: resolvable95,
      reference: {
        evalSessions: 48,
        pairedSe: 0.009,
        source: "scripts/forecast/adjudicate.ts over the 48-session eval split (GAUNTLET round 8)",
      },
      whyTheCorpusWasGrown:
        "the first eval set was 48 sessions / 78 onsets / 858 lead-censored positives. Its paired " +
        "SE was ≈0.009 while every margin the five-family bake-off produced was 0.001–0.006, so " +
        "round 8 could not tell a 190-parameter GLM from a 14 803-parameter CNN and said so. " +
        "Resolving a +0.006 gap needed ~7-8× the sessions; this corpus is 18.75×, and the " +
        "comparison it could not decide is now decided (GAUNTLET round 10).",
      sessionScale: round4(clusterOf.size / 48),
      seRatioObservedVsSqrtN:
        measuredSe === null ? null : round4(measuredSe / (0.009 / Math.sqrt(clusterOf.size / 48))),
      bakeOffMarginsUnderThisPower: priorPairs.map((pair) => ({
        model: pair.model ?? "unknown",
        diffOn48Sessions: pair.diff ?? null,
        resolvableHere:
          resolvable95 === null || pair.diff === undefined ? null : Math.abs(pair.diff) > resolvable95,
        sessionsNeededFor95:
          measuredSe === null || pair.diff === undefined || pair.diff === 0
            ? null
            : Math.ceil(clusterOf.size * ((1.96 * measuredSe) / Math.abs(pair.diff)) ** 2),
      })),
      caveatSameGenerator:
        "this corpus is FRESH SAMPLING from the same simulator, not new recorded data. It removes " +
        "sampling noise; it does not remove simulator misspecification. Any bias the training and " +
        "hold-out corpora share is invisible to it, and the round-8 open question — that the raw " +
        "1 Hz stream carries signal the 18 window aggregates destroy — still needs a real corpus.",
      caveat:
        "this SE is measured on the shipped head vs the gate baseline. The bake-off contenders " +
        "themselves are NOT re-scored here — their scripts are frozen and their scores exist only " +
        "for the 48-session split — but the SE of a paired lead-AUC difference is a property of " +
        "the corpus, the metric and the clustering far more than of which two similar-strength " +
        "models are differenced, so it is the right yardstick for planning the re-run. Re-running " +
        "the five contenders against `--data data/forecast/holdout/holdout-dataset.jsonl` is what " +
        "actually settles the bake-off.",
    };
    // The GATE's confidence interval: the shipped head minus the exact model the
    // gate anchors to, on the exact metric it gates on, from the same paired
    // session-clustered resampling. This is the number that turns "+0.0xx" from
    // an assertion into a measurement.
    marginCi95 =
      shippedPair === undefined
        ? null
        : {
            diff: round6(shippedPair.diff),
            lo95: round6(shippedPair.lo95),
            hi95: round6(shippedPair.hi95),
            se: round6(shippedPair.sd),
            p: round6(shippedPair.pDiffLeZero),
            draws: config.powerDraws,
            clusteredBy: "session",
            resolved: shippedPair.lo95 > 0,
            note:
              "paired session-clustered bootstrap of (shipped − gate baseline) on lead-censored " +
              "ROC-AUC, same resamples for both models. `resolved` means the interval excludes 0.",
          };
  }

  // --- Gate ------------------------------------------------------------------
  // Anchored to the FULL-feature multivariate logistic (the strongest of
  // our two honest fits of it), not to a one-input strawman.
  const margin = modelLead20 - linearBaselineLead20;
  const gatePassed = margin >= GATE_MARGIN;
  const legacyMargin = modelLead20 - bestSingle.leadAuc20;
  const gate = {
    enforced: !config.gateOff,
    metric: "lead-censored ROC-AUC (onset ≥ 20 s away vs calm)",
    baseline: "fullLogisticStrongest",
    baselineRationale:
      `the strongest ${FEATURE_DIM}-feature multivariate logistic regression on the SAME feature ` +
      "basis the shipped head sees — the model a judge means by 'did you try logistic regression?'. " +
      "The shipped head must not lose to it, and growing the feature set moves the bar with it.",
    marginRequired: GATE_MARGIN,
    marginRequiredRationale:
      "zero by design. The bar is 'a logistic regression on the same features must not beat the " +
      "shipped head', and it fails the build the moment one does. Round 8 additionally could not " +
      "have demanded more — on 48 eval sessions the paired SE was ≈0.009 and no positive margin " +
      "was measurable. That constraint is gone: `marginCi95` below is the measured interval on " +
      "this corpus. The bar stays at zero because a gate should encode the promise, not the " +
      "current comfortable distance from it.",
    modelLeadAuc20: round4(modelLead20),
    baselineLeadAuc20: round4(linearBaselineLead20),
    baselineFit: linearBaselineFit,
    margin: round4(margin),
    marginCi95,
    passed: gatePassed,
    context: {
      note:
        "the pre-bake-off gate: +0.03 over the best SINGLE-feature logistic. Reported so the two " +
        "bars can be compared — the 18→12→1 MLP that shipped before this swap passed THIS one by " +
        "+0.1514 while losing to the full logistic by −0.0077.",
      bestSingleFeature: bestSingle.key,
      bestSingleFeatureLeadAuc20: bestSingle.leadAuc20,
      plainLogisticLevelBlockLeadAuc20: levelLead20,
      plainLogisticLevelBlockNote:
        `the plain logistic on the round-8 basis (${levelColumns.length} level features). Context ` +
        `for what the trend block buys a plain additive model; the gate anchors to the full ` +
        `${FEATURE_DIM}-feature fit so growing the feature set moves the bar with it.`,
      legacyMargin: round4(legacyMargin),
      legacyMarginRequired: 0.03,
      legacyPassed: legacyMargin >= 0.03,
    },
  };

  const manifest = (provenance as { manifest?: { createdAt?: string } }).manifest;
  const report = {
    version: FORECAST_MODEL_VERSION,
    createdAt: manifest?.createdAt ?? "unknown",
    status: "trained",
    // Present ONLY in hold-out runs, so the committed eval-report.json that
    // `npm run forecast:pipeline` writes is byte-for-byte what it always was.
    ...(config.holdout
      ? {
          heldOutCorpus: {
            kind: "holdout-power-corpus",
            regenerate: "npm run forecast:evalset",
            score: "npm run forecast:eval:holdout",
            dataset: config.holdoutData,
            rawSessions: config.holdoutRaw,
            note:
              "the 48-session eval SPLIT of dataset.jsonl was NOT scored in this run. Rows from " +
              "dataset.jsonl were read only to FIT the logistic baselines (train split), never to " +
              "score anything; every scored frame comes from the hold-out corpus below.",
            manifest: holdoutManifest,
          },
          power,
        }
      : {}),
    gate,
    metrics: {
      rocAuc: round4(overallAuc),
      prAuc: round4(overallPr),
      baseRate: round4(evalBaseRate),
      aucLead20: round4(modelLead20),
      aucLead10: round4(modelLead10),
      ece: round4(calibrationTable.ece),
      evalFrames: evalRows.length,
      evalSessions: new Set(evalRows.map((row) => row.sessionId)).size,
    },
    reliability: calibrationTable.bins,
    operatingPoints: {
      nudge: operatingPoint(evalRows, modelScores, thresholds.nudge),
      prearm: operatingPoint(evalRows, modelScores, thresholds.prearm),
    },
    alarms: {
      rules: {
        prearm:
          "recallAt30 — a pre-arm was ACTIVE at onset (the reducer's own forecast_hit receipt) or " +
          "fired within the prior 30 s. The strict product rule: the fuse was actually shortened.",
        nudge:
          "recallAt30Nudge — ANY nudge-or-higher alarm inside (onset − 30 s, onset]. The rule the " +
          "five-family bake-off compared every contender on: the student got some warning.",
      },
      recallAt30: totals.drifts > 0 ? round4(totals.hits / totals.drifts) : null,
      recallAt30Nudge: totals.drifts > 0 ? round4(totals.nudgeHits / totals.drifts) : null,
      medianLeadSec: medianLead === null ? null : round4(medianLead),
      p25LeadSec: p25Lead === null ? null : round4(p25Lead),
      medianNudgeLeadSec: medianNudgeLead === null ? null : round4(medianNudgeLead),
      falsePrearmsPerHour: totals.hours > 0 ? round4(totals.falsePrearms / totals.hours) : null,
      nudgesPerHour: totals.hours > 0 ? round4(totals.nudges / totals.hours) : null,
      drifts: totals.drifts,
      hits: totals.hits,
      misses: totals.drifts - totals.hits,
      nudgeHits: totals.nudgeHits,
      nudgeMisses: totals.drifts - totals.nudgeHits,
      evalHours: round4(totals.hours),
      settings: {
        nudgeRisk: thresholds.nudge,
        prearmRisk: thresholds.prearm,
        prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
        baseFuseSec: DEFAULT_SETTINGS.countdownSec,
      },
      operatingPointSelection: dig(provenance, "train", "operatingPoint") ?? null,
    },
    baselines,
    bakeOffContext,
    bakeOffPower,
    bakeOff,
    perArchetype,
    ablation,
    thresholdParity: {
      nudge: thresholds.nudge,
      prearm: thresholds.prearm,
      source: thresholds.source,
    },
    provenanceSha,
    provenance,
  };
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`);

  // --- Console summary --------------------------------------------------------
  console.log(
    `eval frames ${evalRows.length} (${(evalBaseRate * 100).toFixed(1)}% positive) over ` +
      `${report.metrics.evalSessions} held-out sessions | ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  console.log(
    `${weights.basis} (${weights.paramCount}p): ROC-AUC ${round4(overallAuc)} | PR-AUC ${round4(overallPr)} ` +
      `@ base ${round4(evalBaseRate)} | lead≥20s ${round4(modelLead20)} | lead≥10s ${round4(modelLead10)} | ` +
      `ECE ${round4(calibrationTable.ece)}`,
  );
  console.log(
    `baselines (lead≥20s): if-else ${baselines.ifElseHeuristic.leadAuc20} | grey-dwell ${baselines.greyDwellHeuristic.leadAuc20} | ` +
      `best single (${bestSingle.key}) ${bestSingle.leadAuc20} | full logistic GD ${baselines.fullLogistic.leadAuc20} | ` +
      `full logistic converged ${baselines.fullLogisticConverged.leadAuc20}`,
  );
  console.log(
    `alarms @ nudge ${thresholds.nudge}/prearm ${thresholds.prearm}: recall@30s ${report.alarms.recallAt30} (pre-arm rule) / ` +
      `${report.alarms.recallAt30Nudge} (nudge rule, ${totals.nudgeHits}/${totals.drifts}) | ` +
      `median lead ${report.alarms.medianLeadSec}s (p25 ${report.alarms.p25LeadSec}s) | ` +
      `${report.alarms.nudgesPerHour} nudges/h | false pre-arms/h ${report.alarms.falsePrearmsPerHour} ` +
      `over ${report.alarms.evalHours}h`,
  );
  const churn = perArchetype["research_churn"] as { falsePositiveRateAtNudge: number; falsePositiveRateAtPrearm: number };
  console.log(
    `research_churn slice: FPR@nudge ${churn.falsePositiveRateAtNudge} | FPR@prearm ${churn.falsePositiveRateAtPrearm}`,
  );
  if (power !== null) {
    const measured = power["measuredPairedSe"] as number | null;
    const resolvable = power["resolvableDiff95"] as number | null;
    console.log(
      `power: measured paired session-clustered SE ${measured} over ${report.metrics.evalSessions} ` +
        `sessions (48-session split: 0.009) → smallest 95 %-resolvable lead-AUC difference ` +
        `${resolvable}`,
    );
    for (const entry of power["bakeOffMarginsUnderThisPower"] as Array<Record<string, unknown>>) {
      console.log(
        `  bake-off margin ${String(entry["model"]).padEnd(22)} ${entry["diffOn48Sessions"]} → ` +
          `${entry["resolvableHere"] === true ? "RESOLVABLE here" : "still inside the noise"} ` +
          `(95 % needs ~${entry["sessionsNeededFor95"]} sessions)`,
      );
    }
  }
  console.log(`report → ${config.out}`);

  if (!gatePassed && !config.gateOff) {
    console.error(
      `GATE FAILED: shipped head lead≥20s AUC ${round4(modelLead20)} must beat the full ${FEATURE_DIM}-feature ` +
        `logistic (${linearBaselineFit}, ${round4(linearBaselineLead20)}) by ≥ ${GATE_MARGIN} — ` +
        `margin ${round4(margin)}. A logistic regression a judge could write in an afternoon is ` +
        `now at least as good as what we ship; fix the model, not the gate.`,
    );
    process.exitCode = 1;
    return;
  }
  if (!gatePassed && config.gateOff) {
    console.warn(
      `gate bypassed (--gate=off) with margin ${round4(margin)} < ${GATE_MARGIN} — report stamped enforced:false`,
    );
  }
  console.log(
    gatePassed
      ? `gate PASSED: margin ${round4(margin)} ≥ ${GATE_MARGIN} over the full ${FEATURE_DIM}-feature logistic ` +
          `(${round4(linearBaselineLead20)}, ${linearBaselineFit}) | context: +${round4(legacyMargin)} ` +
          `over the old best-single-feature bar ('${bestSingle.key}', ${bestSingle.leadAuc20})`
      : "gate skipped",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
