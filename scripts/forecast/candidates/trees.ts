import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../../src/shared/defaults";
import type { EscalationSettings } from "../../../src/shared/forecast/escalate";
import { fnv1a32 } from "../../../src/shared/forecast/hash";
import { forward, parseForecastWeights } from "../../../src/shared/forecast/model";
import { FORECAST_FEATURE_KEYS } from "../../../src/shared/forecast/types";
import {
  CONTRACT_PREARM_FUSE_SEC,
  RAW_SESSIONS_FILE,
  boolFlag,
  ece10,
  forecastDataRoot,
  logisticScore,
  numberArg,
  percentile,
  prAuc,
  readJsonl,
  repoRoot,
  rocAuc,
  round4,
  round6,
  splitForSession,
  stringArg,
  thresholdDefaults,
  trainLogistic,
  type RawSession,
} from "../lib";
import {
  accumulate,
  emptyAlarms,
  runEscalation,
  traceSession,
  type AlarmResult,
  type SessionTrace,
} from "./trees/alarms";
import { loadDataset, valSessionSet, N_FEATURES } from "./trees/data";
import { applyCalibrator, chooseCalibrator, maxAttainableRisk } from "./trees/calibrate";
import {
  binMatrix,
  binOf,
  boosterMargin,
  buildBinEdges,
  countNodes,
  serializeBooster,
  trainGbdt,
  type Booster,
  type GbdtParams,
} from "./trees/gbdt";

/**
 * GAUNTLET CONTENDER — "trees": hand-rolled gradient-boosted decision trees on
 * the 18 shipped encoded features.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/candidates/trees.ts
 *
 * What this is: the classic strong tabular baseline the shipped gate never
 * ran. Small by construction — shallow depth, modest tree count, shrinkage,
 * row/column subsampling, L2 leaf regularization — hand-rolled with histogram
 * splits and sibling-subtraction, no dependencies, pure TypeScript at both
 * train and inference time.
 *
 * Honesty protocol (identical to every other contender):
 * - `data/forecast/dataset.jsonl` is read AS-IS. Never rebuilt, never
 *   resampled, never re-split. Rows with `split:"eval"` are never seen by any
 *   fit, early-stop, calibration, hyper-parameter-selection or
 *   operating-point step. Everything is decided inside the TRAIN split:
 *     • depth / learning rate / subsampling / regularization and the tree
 *       count — 3-fold SESSION-level cross-validation (mean fold
 *       lead-censored ≥20 s ROC-AUC);
 *     • the probability calibrator (Platt vs isotonic) — fitted on
 *       cross-fitted OUT-OF-FOLD margins covering the whole CV pool, its
 *       family chosen by a further 5-fold CV on importance-weighted log loss;
 *     • the recommended operating point — a set of train sessions held out
 *       of both the CV pool and the calibrator fit, under a nudge-rate budget
 *       set by the SHIPPED MLP on those same sessions.
 * - Every metric is computed with `scripts/forecast/lib.ts` helpers verbatim
 *   (`rocAuc` = real Mann-Whitney with tie ranks, `prAuc`, `ece10`) and
 *   eval.ts's lead-censored eligibility rule (positives are frames 20–30 s
 *   before an onset; negatives are calm frames whose nearest onset is ≥ 20 s
 *   away or absent).
 * - The alarm numbers come from the SHIPPED escalation reducer
 *   (`smoothRisk` + `stepEscalation`) replayed over the held-out RAW sessions
 *   through the SHIPPED feature extractor (`replaySession`).
 * - eval.ts's full-18-feature logistic baseline is reproduced verbatim (same
 *   `trainLogistic`, same 40 k stride subsample) as the cross-contender
 *   apples-to-apples check.
 */

const CANDIDATE = "trees";
const MAX_BINS = 64;

interface Config {
  seed: number;
  data: string | undefined;
  raw: string;
  outDir: string;
  quick: boolean;
}

function readConfig(): Config {
  return {
    seed: numberArg("--seed", 42),
    data: process.argv.includes("--data") ? stringArg("--data", "") : undefined,
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    outDir: stringArg("--out", join(forecastDataRoot(), "candidates", CANDIDATE)),
    quick: boolFlag("--quick"),
  };
}

// ---------------------------------------------------------------------------
// Lead-censored eligibility (eval.ts's rule, verbatim semantics)
// ---------------------------------------------------------------------------

/** Eligible iff there is no onset ahead (NaN) or the onset is ≥ leadSec away. */
function eligibleIndices(secs: Float64Array, count: number, leadSec: number): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const s = secs[i] as number;
    if (Number.isNaN(s) || s >= leadSec) {
      out.push(i);
    }
  }
  return Int32Array.from(out);
}

function aucOnSubset(
  scores: Float64Array,
  labels: Uint8Array,
  subset: Int32Array,
  offsetOf?: Int32Array,
): number {
  const s: number[] = [];
  const y: number[] = [];
  for (let k = 0; k < subset.length; k += 1) {
    const i = subset[k] as number;
    s.push(scores[i] as number);
    y.push(labels[(offsetOf === undefined ? i : (offsetOf[i] as number)) as number] as number);
  }
  return rocAuc(s, y);
}

// ---------------------------------------------------------------------------

interface Variant {
  name: string;
  params: GbdtParams;
}

function baseParams(seed: number): GbdtParams {
  return {
    maxDepth: 4,
    learningRate: 0.1,
    maxTrees: 600,
    subsample: 0.7,
    colsample: 1,
    minChildCount: 40,
    minChildHess: 5,
    lambda: 1,
    minSplitGain: 1e-6,
    posWeightPower: 0.5,
    seed,
  };
}

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  mkdirSync(config.outDir, { recursive: true });

  // --- Load (dataset as-is) --------------------------------------------------
  const data = await loadDataset(config.data);
  const evalBaseRate =
    Array.from(data.evalY).reduce<number>((sum, y) => sum + y, 0) / data.evalCount;
  console.log(
    `dataset ${data.file}: train ${data.trainCount} rows / ${data.trainSessions.length} sessions | ` +
      `eval ${data.evalCount} rows / ${new Set(data.evalSessionIds).size} sessions ` +
      `(${(evalBaseRate * 100).toFixed(2)}% positive)`,
  );

  // --- Train-internal splits, BY SESSION -------------------------------------
  // Three disjoint uses of the TRAIN split, all session-level so no session's
  // autocorrelated frames straddle a boundary:
  //   • calibration sessions (~1 in 7)  — probability calibration only,
  //                                       never fitted on;
  //   • the remaining "CV pool"         — K-fold cross-validation for
  //                                       hyper-parameter selection AND the
  //                                       final refit.
  // A single 80/20 val split turned out to be too noisy to choose depth with
  // (config-to-config differences were ~0.005 val AUC, well inside split
  // noise), so selection is averaged over K folds.
  const CV_FOLDS = 3;
  const calSessions = valSessionSet(data.trainSessions, config.seed, 7);
  const foldOfSession = new Int32Array(data.trainSessions.length).fill(-1);
  let poolSessionCount = 0;
  for (let s = 0; s < data.trainSessions.length; s += 1) {
    if (calSessions.has(s)) {
      continue;
    }
    foldOfSession[s] =
      fnv1a32(`trees-fold:${config.seed}:${data.trainSessions[s] as string}`) % CV_FOLDS;
    poolSessionCount += 1;
  }
  const calRowList: number[] = [];
  const poolRowList: number[] = [];
  const foldRowLists: number[][] = Array.from({ length: CV_FOLDS }, () => []);
  for (let i = 0; i < data.trainCount; i += 1) {
    const session = data.trainSessionOf[i] as number;
    if (calSessions.has(session)) {
      calRowList.push(i);
      continue;
    }
    poolRowList.push(i);
    (foldRowLists[foldOfSession[session] as number] as number[]).push(i);
  }
  const calRows = Int32Array.from(calRowList);
  const poolRows = Int32Array.from(poolRowList);
  console.log(
    `train-internal: CV pool ${poolRows.length} rows / ${poolSessionCount} sessions (${CV_FOLDS} folds: ` +
      `${foldRowLists.map((rows) => rows.length).join("/")}) | ` +
      `calibration ${calRows.length} rows / ${calSessions.size} sessions (calibration only)`,
  );

  // --- Binning (edges fit on the CV pool only) -------------------------------
  const edges = buildBinEdges(data.trainX, poolRows, MAX_BINS, 60_000);
  const trainBins = binMatrix(data.trainX, data.trainCount, edges);

  interface FoldView {
    fitRows: Int32Array;
    valRows: Int32Array;
    valBins: Uint8Array;
    valY: Uint8Array;
    valEligible20: Int32Array;
  }
  const subsetBins = (rows: Int32Array): Uint8Array => {
    const out = new Uint8Array(rows.length * N_FEATURES);
    for (let k = 0; k < rows.length; k += 1) {
      const i = rows[k] as number;
      for (let f = 0; f < N_FEATURES; f += 1) {
        out[k * N_FEATURES + f] = trainBins[i * N_FEATURES + f] as number;
      }
    }
    return out;
  };
  const folds: FoldView[] = [];
  for (let k = 0; k < CV_FOLDS; k += 1) {
    const valRows = Int32Array.from(foldRowLists[k] as number[]);
    const fitRows = Int32Array.from(
      poolRowList.filter((i) => (foldOfSession[data.trainSessionOf[i] as number] as number) !== k),
    );
    const valY = new Uint8Array(valRows.length);
    const valSecs = new Float64Array(valRows.length);
    for (let j = 0; j < valRows.length; j += 1) {
      const i = valRows[j] as number;
      valY[j] = data.trainY[i] as number;
      valSecs[j] = data.trainSecs[i] as number;
    }
    folds.push({
      fitRows,
      valRows,
      valBins: subsetBins(valRows),
      valY,
      valEligible20: eligibleIndices(valSecs, valRows.length, 20),
    });
  }

  // --- Hyper-parameter search (K-fold train-internal lead≥20s AUC) -----------
  const variants: Variant[] = [];
  const depths = config.quick ? [4] : [3, 4, 5, 6];
  const rates = config.quick ? [0.1] : [0.05, 0.1];
  for (const depth of depths) {
    for (const lr of rates) {
      const params = baseParams(config.seed);
      params.maxDepth = depth;
      params.learningRate = lr;
      variants.push({ name: `d${depth}-lr${lr}-sub0.7-col1-pw0.5`, params });
    }
  }

  interface Trial {
    name: string;
    params: GbdtParams;
    cvLeadAuc20: number;
    foldLeadAuc20: number[];
    foldTrees: number[];
    meanTrees: number;
    meanNodes: number;
    seconds: number;
  }
  const trials: Trial[] = [];
  let best: Trial | null = null;

  const runVariant = (variant: Variant): void => {
    const t0 = Date.now();
    const foldScores: number[] = [];
    const foldTrees: number[] = [];
    const foldNodes: number[] = [];
    for (const fold of folds) {
      const result = trainGbdt({
        bins: trainBins,
        y: data.trainY,
        fitRows: fold.fitRows,
        edges,
        maxBins: MAX_BINS,
        params: variant.params,
        valBins: fold.valBins,
        valRowCount: fold.valRows.length,
        monitor: {
          every: 10,
          patience: 8,
          score: (margins) => aucOnSubset(margins, fold.valY, fold.valEligible20),
        },
      });
      foldScores.push(result.bestScore);
      foldTrees.push(result.booster.trees.length);
      foldNodes.push(countNodes(result.booster).nodes);
    }
    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
    const trial: Trial = {
      name: variant.name,
      params: { ...variant.params },
      cvLeadAuc20: round6(mean(foldScores)),
      foldLeadAuc20: foldScores.map(round6),
      foldTrees,
      meanTrees: Math.max(1, Math.round(mean(foldTrees))),
      meanNodes: Math.round(mean(foldNodes)),
      seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    };
    trials.push(trial);
    console.log(
      `  ${variant.name.padEnd(38)} CV lead≥20s ${trial.cvLeadAuc20.toFixed(6)} ` +
        `[${trial.foldLeadAuc20.map((v) => v.toFixed(4)).join(" ")}] | ` +
        `~${trial.meanTrees} trees / ~${trial.meanNodes} nodes | ${trial.seconds}s`,
    );
    // Selection: mean fold lead-censored AUC; ties (within 0.001) broken toward
    // the SMALLER ensemble — this contender's pitch includes on-device size.
    const better =
      best === null ||
      trial.cvLeadAuc20 > best.cvLeadAuc20 + 0.001 ||
      (trial.cvLeadAuc20 > best.cvLeadAuc20 - 0.001 && trial.meanNodes < best.meanNodes);
    if (better) {
      best = trial;
    }
  };

  console.log("stage 1 — depth × learning rate:");
  for (const variant of variants) {
    runVariant(variant);
  }
  if (best === null) {
    throw new Error("no variant trained");
  }

  if (!config.quick) {
    console.log("stage 2 — subsampling / class weighting around the stage-1 winner:");
    const anchor = (best as Trial).params;
    const stage2: Variant[] = [];
    for (const [sub, col] of [
      [0.5, 1],
      [0.7, 0.7],
      [1, 1],
      [0.5, 0.7],
    ] as Array<[number, number]>) {
      for (const pw of [0, 0.5]) {
        if (sub === anchor.subsample && col === anchor.colsample && pw === anchor.posWeightPower) {
          continue;
        }
        const params = { ...anchor, subsample: sub, colsample: col, posWeightPower: pw };
        stage2.push({
          name: `d${params.maxDepth}-lr${params.learningRate}-sub${sub}-col${col}-pw${pw}`,
          params,
        });
      }
    }
    for (const variant of stage2) {
      runVariant(variant);
    }

    console.log("stage 3 — leaf regularization around the running winner:");
    const anchor3 = (best as Trial).params;
    const stage3: Variant[] = [];
    for (const [minCount, lambda] of [
      [20, 1],
      [100, 1],
      [40, 5],
      [200, 5],
    ] as Array<[number, number]>) {
      if (minCount === anchor3.minChildCount && lambda === anchor3.lambda) {
        continue;
      }
      const params = { ...anchor3, minChildCount: minCount, lambda };
      stage3.push({
        name: `d${params.maxDepth}-lr${params.learningRate}-sub${params.subsample}-col${params.colsample}-pw${params.posWeightPower}-mc${minCount}-l2${lambda}`,
        params,
      });
    }
    for (const variant of stage3) {
      runVariant(variant);
    }
  }

  const chosen = best as Trial;
  console.log(
    `chosen: ${chosen.name} — CV lead≥20s ${chosen.cvLeadAuc20.toFixed(6)}, ` +
      `refitting on the full CV pool with ${chosen.meanTrees} trees (mean of the fold early stops)`,
  );

  // --- Cross-fitted (out-of-fold) probability calibration --------------------
  // The calibrator is fitted on OUT-OF-FOLD margins covering the whole CV pool
  // (every margin comes from a fold model that never saw that row) — the
  // textbook CalibratedClassifierCV(cv=k) construction. Calibrating on ~115 k
  // rows instead of one small slice matters here: the ensemble's margin is not
  // logistic-shaped, and a thin calibration set leaves the mid-range visibly
  // off, which never moves an AUC but moves every threshold-crossing number
  // the escalation reducer produces.
  const oofMargins = new Float64Array(poolRows.length);
  const poolPosition = new Int32Array(data.trainCount).fill(-1);
  for (let k = 0; k < poolRows.length; k += 1) {
    poolPosition[poolRows[k] as number] = k;
  }
  for (let k = 0; k < CV_FOLDS; k += 1) {
    const fold = folds[k] as FoldView;
    const foldFit = trainGbdt({
      bins: trainBins,
      y: data.trainY,
      fitRows: fold.fitRows,
      edges,
      maxBins: MAX_BINS,
      params: chosen.params,
      valBins: fold.valBins,
      valRowCount: fold.valRows.length,
      monitor: {
        every: 10,
        patience: 8,
        score: (margins) => aucOnSubset(margins, fold.valY, fold.valEligible20),
      },
    });
    for (let j = 0; j < fold.valRows.length; j += 1) {
      oofMargins[poolPosition[fold.valRows[j] as number] as number] = foldFit.valMargins[
        j
      ] as number;
    }
  }
  const poolY = new Uint8Array(poolRows.length);
  const poolImportance = new Float64Array(poolRows.length);
  const poolSessionIds: string[] = [];
  for (let k = 0; k < poolRows.length; k += 1) {
    const i = poolRows[k] as number;
    poolY[k] = data.trainY[i] as number;
    poolImportance[k] = data.trainImportance[i] as number;
    poolSessionIds.push(data.trainSessions[data.trainSessionOf[i] as number] as string);
  }
  // Platt vs isotonic, decided by 5-fold session-level CV over those OOF rows,
  // scored with importance-weighted log loss (a proper scoring rule).
  const calibration = chooseCalibrator(
    oofMargins,
    poolY,
    poolImportance,
    poolSessionIds,
    config.seed,
  );
  console.log(
    `calibrator: ${calibration.chosen} on out-of-fold margins (5-fold weighted log loss — ` +
      `platt ${calibration.cvLogLoss.platt.toFixed(6)} vs isotonic ${calibration.cvLogLoss.isotonic.toFixed(6)})`,
  );

  // --- Final refit on the whole CV pool --------------------------------------
  // Tree count is FIXED to the mean fold early-stop count — no monitor, so
  // nothing outside the CV pool is fitted on at any point.
  const finalFit = trainGbdt({
    bins: trainBins,
    y: data.trainY,
    fitRows: poolRows,
    edges,
    maxBins: MAX_BINS,
    params: { ...chosen.params, maxTrees: chosen.meanTrees },
  });
  const booster = finalFit.booster;
  const score = (encoded: readonly number[] | Float64Array, offset = 0): number =>
    applyCalibrator(calibration.calibrator, boosterMargin(booster, encoded, offset));

  // Binned-training vs real-threshold-inference equivalence check: the split
  // `bin ≤ b` is stored as `x ≤ edges[f][b]`, so the two must agree exactly.
  let worstBinSkew = 0;
  for (let k = 0; k < poolRows.length; k += 97) {
    const i = poolRows[k] as number;
    const raw = boosterMargin(booster, data.trainX, i * N_FEATURES);
    worstBinSkew = Math.max(worstBinSkew, Math.abs(raw - (finalFit.fitMargins[k] as number)));
  }
  if (worstBinSkew > 1e-9) {
    throw new Error(`binned/real inference skew ${worstBinSkew} — thresholds are inconsistent`);
  }
  // And the bin mapping itself: bin(x) ≤ b ⇔ x ≤ edges[b].
  for (let f = 0; f < N_FEATURES; f += 1) {
    const featureEdges = edges[f] as number[];
    for (let k = 0; k < data.evalCount; k += 4001) {
      const x = data.evalX[k * N_FEATURES + f] as number;
      const bin = binOf(x, featureEdges);
      for (let b = 0; b < featureEdges.length; b += 1) {
        if (bin <= b !== x <= (featureEdges[b] as number)) {
          throw new Error(`bin mapping violated at feature ${f}`);
        }
      }
    }
  }

  // --- Held-out scoring (first and only time eval rows are touched) ---------
  const evalScores = new Float64Array(data.evalCount);
  for (let i = 0; i < data.evalCount; i += 1) {
    evalScores[i] = score(data.evalX, i * N_FEATURES);
  }
  const evalScoreList = Array.from(evalScores);
  const evalLabelList = Array.from(data.evalY);
  const evalEligible20 = eligibleIndices(data.evalSecs, data.evalCount, 20);
  const evalEligible10 = eligibleIndices(data.evalSecs, data.evalCount, 10);

  const metrics = {
    rocAuc: rocAuc(evalScoreList, evalLabelList),
    prAuc: prAuc(evalScoreList, evalLabelList),
    aucLead20: aucOnSubset(evalScores, data.evalY, evalEligible20),
    aucLead10: aucOnSubset(evalScores, data.evalY, evalEligible10),
    ece: ece10(evalScoreList, evalLabelList).ece,
  };
  const reliability = ece10(evalScoreList, evalLabelList).bins;

  const thresholds = await thresholdDefaults();
  const frameOperatingPoint = (threshold: number) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (let i = 0; i < data.evalCount; i += 1) {
      const fired = (evalScores[i] as number) >= threshold;
      if ((data.evalY[i] as number) === 1) {
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
  };

  // --- eval.ts's full-18 logistic baseline, reproduced verbatim -------------
  // Same rows (all train rows in file order), same 40 k stride subsample, same
  // class-weighted GD in lib.trainLogistic — the cross-contender check.
  const cap = 40_000;
  const stride = Math.max(1, Math.ceil(data.trainCount / cap));
  const subX: number[][] = [];
  const subY: number[] = [];
  for (let i = 0; i < data.trainCount; i += stride) {
    const row: number[] = [];
    for (let f = 0; f < N_FEATURES; f += 1) {
      row.push(data.trainX[i * N_FEATURES + f] as number);
    }
    subX.push(row);
    subY.push(data.trainY[i] as number);
  }
  const allColumns = FORECAST_FEATURE_KEYS.map((_, i) => i);
  const lrModel = trainLogistic(subX, subY, allColumns);
  const lrScores = new Float64Array(data.evalCount);
  for (let i = 0; i < data.evalCount; i += 1) {
    const row: number[] = [];
    for (let f = 0; f < N_FEATURES; f += 1) {
      row.push(data.evalX[i * N_FEATURES + f] as number);
    }
    lrScores[i] = logisticScore(lrModel, row, allColumns);
  }
  const fullLogistic = {
    leadAuc20: round4(aucOnSubset(lrScores, data.evalY, evalEligible20)),
    leadAuc10: round4(aucOnSubset(lrScores, data.evalY, evalEligible10)),
    rocAuc: round4(rocAuc(Array.from(lrScores), evalLabelList)),
    prAuc: round4(prAuc(Array.from(lrScores), evalLabelList)),
  };
  console.log(
    `full-18 logistic (eval.ts replica): lead≥20s ${fullLogistic.leadAuc20} | ROC ${fullLogistic.rocAuc}`,
  );
  console.log(
    `trees: lead≥20s ${round4(metrics.aucLead20)} | lead≥10s ${round4(metrics.aucLead10)} | ` +
      `ROC ${round4(metrics.rocAuc)} | PR ${round4(metrics.prAuc)} | ECE ${round4(metrics.ece)}`,
  );

  // --- Alarm simulation over RAW sessions ------------------------------------
  // One pass over the raw stream produces two disjoint sets of traces:
  //   • held-out EVAL sessions  — reporting only;
  //   • train-internal CALIBRATION sessions — never fitted on, never
  //     calibrated on (the calibrator is cross-fitted inside the CV pool), used
  //     ONLY to pick the recommended operating point without touching eval.
  const calSessionIds = new Set(
    [...calSessions].map((index) => data.trainSessions[index] as string),
  );
  const shippedWeights = parseForecastWeights(
    JSON.parse(
      readFileSync(join(repoRoot(), "src", "shared", "forecast", "weights.json"), "utf8"),
    ),
  );
  if (shippedWeights === null) {
    throw new Error("shipped weights.json failed parseForecastWeights");
  }
  const traces: SessionTrace[] = [];
  const tracesShippedMlp: SessionTrace[] = [];
  const calTraces: SessionTrace[] = [];
  const calTracesShippedMlp: SessionTrace[] = [];
  for await (const session of readJsonl<RawSession>(config.raw)) {
    if (session.source !== "synthetic") {
      continue;
    }
    if (splitForSession(session.id, config.seed) === "eval") {
      traces.push(traceSession(session, (encoded) => score(encoded, 0)));
      // The shipped MLP over the SAME traces and the SAME reducer, so the
      // nudge-rule recall (which the shipped report does not publish) is
      // directly comparable rather than quoted from a different rule.
      tracesShippedMlp.push(
        traceSession(session, (encoded) => forward(shippedWeights, encoded).rawRisk),
      );
      continue;
    }
    if (calSessionIds.has(session.id)) {
      calTraces.push(traceSession(session, (encoded) => score(encoded, 0)));
      calTracesShippedMlp.push(
        traceSession(session, (encoded) => forward(shippedWeights, encoded).rawRisk),
      );
    }
  }
  const settingsAt = (nudge: number, prearm: number): EscalationSettings => ({
    nudgeRisk: nudge,
    prearmRisk: prearm,
    prearmEnabled: true,
    prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  });

  const runOver = (
    sessionTraces: readonly SessionTrace[],
    nudge: number,
    prearm: number,
  ): { totals: AlarmResult; byArchetype: Map<string, AlarmResult> } => {
    const totals = emptyAlarms();
    const byArchetype = new Map<string, AlarmResult>();
    const settings = settingsAt(nudge, prearm);
    for (const trace of sessionTraces) {
      const part = runEscalation(trace, settings);
      accumulate(totals, part);
      const bucket = byArchetype.get(trace.archetype) ?? emptyAlarms();
      accumulate(bucket, part);
      byArchetype.set(trace.archetype, bucket);
    }
    return { totals, byArchetype };
  };
  const runAll = (
    nudge: number,
    prearm: number,
  ): { totals: AlarmResult; byArchetype: Map<string, AlarmResult> } =>
    runOver(traces, nudge, prearm);

  // --- Operating point, chosen on TRAIN-INTERNAL sessions only ---------------
  // Budget rule: this model may not nudge more often per hour than the SHIPPED
  // MLP does on the very same sessions, and may not nudge at all on
  // research_churn (the anti-if-else archetype, zero drifts by construction).
  // Under that budget the lowest threshold wins, because nudge recall is
  // monotone decreasing in the threshold. The grid never goes above the
  // shipped 0.55 default. No eval session is involved in any of this.
  const shippedCal = runOver(calTracesShippedMlp, thresholds.nudge, thresholds.prearm);
  const shippedNudgesPerHour =
    shippedCal.totals.hours > 0 ? shippedCal.totals.nudges / shippedCal.totals.hours : 0;
  const opGrid = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55];
  const opTrials = opGrid.map((nudge) => {
    const run = runOver(calTraces, nudge, thresholds.prearm);
    const churn = run.byArchetype.get("research_churn");
    return {
      nudgeRisk: nudge,
      nudgesPerHour: round4(run.totals.nudges / Math.max(1e-9, run.totals.hours)),
      researchChurnNudgesPerHour:
        churn !== undefined && churn.hours > 0 ? round4(churn.nudges / churn.hours) : 0,
      recallAt30sNudge:
        run.totals.drifts > 0 ? round4(run.totals.nudgeHits / run.totals.drifts) : null,
      withinBudget: false,
    };
  });
  for (const trial of opTrials) {
    trial.withinBudget =
      trial.nudgesPerHour <= shippedNudgesPerHour && trial.researchChurnNudgesPerHour === 0;
  }
  const affordable = opTrials.filter((trial) => trial.withinBudget);
  const budgetSatisfied = affordable.length > 0;
  const recommendedNudge = budgetSatisfied
    ? (affordable[0] as { nudgeRisk: number }).nudgeRisk
    : thresholds.nudge;
  const recommended = { nudge: recommendedNudge, prearm: thresholds.prearm };
  console.log(
    `operating point (train-internal, ${calTraces.length} calibration sessions): shipped MLP nudges/h ` +
      `${round4(shippedNudgesPerHour)} → recommend nudge ${recommended.nudge} / pre-arm ${recommended.prearm}`,
  );
  const { totals, byArchetype } = runAll(recommended.nudge, recommended.prearm);
  const nudgeLeads = [...totals.nudgeLeads].sort((a, b) => a - b);
  const prearmLeads = [...totals.prearmLeads].sort((a, b) => a - b);
  const recallAt30sNudge = totals.drifts > 0 ? totals.nudgeHits / totals.drifts : 0;
  const recallAt30sPrearm = totals.drifts > 0 ? totals.prearmHits / totals.drifts : 0;
  console.log(
    `alarms @ nudge ${recommended.nudge}/prearm ${recommended.prearm}: ` +
      `recall@30s (nudge-or-higher) ${round4(recallAt30sNudge)} ${totals.nudgeHits}/${totals.drifts} | ` +
      `recall@30s (pre-arm, eval.ts rule) ${round4(recallAt30sPrearm)} | ` +
      `nudges/h ${round4(totals.nudges / totals.hours)} | false pre-arms/h ${round4(totals.falsePrearms / totals.hours)}`,
  );

  const sweep = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7].map((nudge) => {
    const run = runAll(nudge, recommended.prearm);
    const churn = run.byArchetype.get("research_churn");
    return {
      nudgeRisk: nudge,
      prearmRisk: recommended.prearm,
      recallAt30sNudge: run.totals.drifts > 0 ? round4(run.totals.nudgeHits / run.totals.drifts) : null,
      recallAt30sPrearm:
        run.totals.drifts > 0 ? round4(run.totals.prearmHits / run.totals.drifts) : null,
      nudgesPerHour: round4(run.totals.nudges / run.totals.hours),
      researchChurnNudgesPerHour:
        churn !== undefined && churn.hours > 0 ? round4(churn.nudges / churn.hours) : 0,
    };
  });

  // --- Same alarm numbers at the SHIPPED default thresholds -----------------
  // Reported unconditionally so the contender stays comparable with every
  // report that quotes 0.55 / 0.80, even when the recommended point differs.
  const shippedRun = runAll(thresholds.nudge, thresholds.prearm);
  const shippedNudgeLeads = [...shippedRun.totals.nudgeLeads].sort((a, b) => a - b);
  const alarmsAtShippedDefaults = {
    settings: { nudgeRisk: thresholds.nudge, prearmRisk: thresholds.prearm },
    drifts: shippedRun.totals.drifts,
    recallAt30sNudge:
      shippedRun.totals.drifts > 0
        ? round4(shippedRun.totals.nudgeHits / shippedRun.totals.drifts)
        : null,
    nudgeHits: shippedRun.totals.nudgeHits,
    medianNudgeLeadSec: percentile(shippedNudgeLeads, 0.5),
    recallAt30sPrearm:
      shippedRun.totals.drifts > 0
        ? round4(shippedRun.totals.prearmHits / shippedRun.totals.drifts)
        : null,
    nudgesPerHour: round4(shippedRun.totals.nudges / shippedRun.totals.hours),
    falsePrearmsPerHour: round4(shippedRun.totals.falsePrearms / shippedRun.totals.hours),
    frameLevel: {
      nudge: frameOperatingPoint(thresholds.nudge),
      prearm: frameOperatingPoint(thresholds.prearm),
    },
  };

  const shippedEval = runOver(tracesShippedMlp, thresholds.nudge, thresholds.prearm);
  console.log(
    `shipped MLP over the same eval traces @ 0.55/0.80: recall@30s (nudge) ` +
      `${round4(shippedEval.totals.nudgeHits / Math.max(1, shippedEval.totals.drifts))} | ` +
      `recall@30s (pre-arm) ${round4(shippedEval.totals.prearmHits / Math.max(1, shippedEval.totals.drifts))} | ` +
      `nudges/h ${round4(shippedEval.totals.nudges / shippedEval.totals.hours)}`,
  );

  // --- Per-archetype frame slices (eval.ts's computation) -------------------
  const archetypes = [...new Set(data.evalArchetype)].sort();
  const perArchetype: Record<string, unknown> = {};
  let fprResearchChurn = 0;
  for (const archetype of archetypes) {
    let frames = 0;
    let positives = 0;
    let negatives = 0;
    let fpNudge = 0;
    let fpPrearm = 0;
    for (let i = 0; i < data.evalCount; i += 1) {
      if (data.evalArchetype[i] !== archetype) {
        continue;
      }
      frames += 1;
      if ((data.evalY[i] as number) === 1) {
        positives += 1;
        continue;
      }
      negatives += 1;
      if ((evalScores[i] as number) >= recommended.nudge) {
        fpNudge += 1;
      }
      if ((evalScores[i] as number) >= recommended.prearm) {
        fpPrearm += 1;
      }
    }
    const alarms = byArchetype.get(archetype);
    const fprNudge = negatives > 0 ? fpNudge / negatives : 0;
    if (archetype === "research_churn") {
      fprResearchChurn = fprNudge;
    }
    perArchetype[archetype] = {
      frames,
      baseRate: round4(positives / Math.max(1, frames)),
      falsePositiveRateAtNudge: round4(fprNudge),
      falsePositiveRateAtPrearm: round4(negatives > 0 ? fpPrearm / negatives : 0),
      sessions: traces.filter((trace) => trace.archetype === archetype).length,
      drifts: alarms?.drifts ?? 0,
      nudgeHits: alarms?.nudgeHits ?? 0,
      prearmHits: alarms?.prearmHits ?? 0,
      nudgesPerHour: alarms && alarms.hours > 0 ? round4(alarms.nudges / alarms.hours) : 0,
      falsePrearmsPerHour:
        alarms && alarms.hours > 0 ? round4(alarms.falsePrearms / alarms.hours) : 0,
    };
  }

  // --- Inference cost (pure TS, single-threaded, this machine) --------------
  const counts = countNodes(booster);
  const probeRows = Math.min(20_000, data.evalCount);
  let sink = 0;
  const warm = 3;
  for (let pass = 0; pass < warm; pass += 1) {
    for (let i = 0; i < probeRows; i += 1) {
      sink += boosterMargin(booster, data.evalX, i * N_FEATURES);
    }
  }
  const timedPasses = 10;
  const t0 = process.hrtime.bigint();
  for (let pass = 0; pass < timedPasses; pass += 1) {
    for (let i = 0; i < probeRows; i += 1) {
      sink += boosterMargin(booster, data.evalX, i * N_FEATURES);
    }
  }
  const nanos = Number(process.hrtime.bigint() - t0);
  const microsPerInference = nanos / (timedPasses * probeRows) / 1000;
  const avgDepth =
    booster.trees.reduce((sum, tree) => sum + tree.depth, 0) / Math.max(1, booster.trees.length);

  // --- Report ---------------------------------------------------------------
  const report = {
    candidate: CANDIDATE,
    approach:
      "Hand-rolled histogram gradient-boosted decision trees (logistic loss, shrinkage, row+column " +
      "subsampling, L2 leaf regularization, quantile split bins) on the 18 shipped encoded features; " +
      "depth / tree count / learning rate / subsampling chosen by 3-fold session-level cross-validation " +
      "inside the TRAIN split, then refit on the whole CV pool and probability-calibrated (Platt vs isotonic, " +
      "chosen by CV inside that split) on a further set of " +
      "train sessions held out from every fit.",
    script: "scripts/forecast/candidates/trees.ts",
    seed: config.seed,
    dataset: {
      file: data.file,
      rebuilt: false,
      trainRows: data.trainCount,
      trainSessions: data.trainSessions.length,
      evalRows: data.evalCount,
      evalSessions: new Set(data.evalSessionIds).size,
      evalBaseRate: round4(evalBaseRate),
      cvPoolRows: poolRows.length,
      cvPoolSessions: poolSessionCount,
      cvFolds: CV_FOLDS,
      cvFoldRows: foldRowLists.map((rows) => rows.length),
      calibrationRows: calRows.length,
      calibrationSessions: calSessions.size,
      note: "dataset.jsonl read as-is; split=='eval' rows never entered any fit, early-stop, calibration or selection step",
    },
    model: {
      family: "gradient-boosted decision trees (GBDT)",
      variant: chosen.name,
      trees: booster.trees.length,
      maxDepth: chosen.params.maxDepth,
      meanTreeDepth: round4(avgDepth),
      learningRate: chosen.params.learningRate,
      subsample: chosen.params.subsample,
      colsample: chosen.params.colsample,
      minChildCount: chosen.params.minChildCount,
      minChildHess: chosen.params.minChildHess,
      lambda: chosen.params.lambda,
      posWeightPower: chosen.params.posWeightPower,
      maxBins: MAX_BINS,
      params: counts.nodes,
      paramsNote:
        "params = TOTAL NODE COUNT across the ensemble (internal split nodes + leaves). " +
        `Internal ${counts.internal} (feature index + threshold each) + leaves ${counts.leaves} (one value each). ` +
        "This is far larger than the shipped MLP's 241 floats — the honest cost of this family.",
      internalNodes: counts.internal,
      leaves: counts.leaves,
      baseScore: round6(booster.baseScore),
      calibration: {
        kind: calibration.chosen,
        selectedBy:
          "5-fold session-level CV over the out-of-fold margins, importance-weighted log loss",
        cvLogLoss: {
          platt: round6(calibration.cvLogLoss.platt),
          isotonic: round6(calibration.cvLogLoss.isotonic),
        },
        fittedOn:
          "cross-fitted out-of-fold margins over the whole CV pool (CalibratedClassifierCV-style)",
        maxAttainableRisk: round6(maxAttainableRisk(calibration.calibrator)),
        prearmBandReachable: maxAttainableRisk(calibration.calibrator) >= thresholds.prearm,
        detail:
          calibration.calibrator.type === "platt"
            ? { a: round6(calibration.calibrator.a), b: round6(calibration.calibrator.b) }
            : { knots: calibration.calibrator.x.length },
      },
      selectedOn: "mean 3-fold train-internal cross-validated lead-censored (≥20 s) ROC-AUC",
      cvLeadAuc20: chosen.cvLeadAuc20,
      cvFoldLeadAuc20: chosen.foldLeadAuc20,
      cvFoldTrees: chosen.foldTrees,
      binnedVsRealInferenceMaxSkew: worstBinSkew,
    },
    metrics: {
      rocAuc: round4(metrics.rocAuc),
      prAuc: round4(metrics.prAuc),
      aucLead20: round4(metrics.aucLead20),
      aucLead10: round4(metrics.aucLead10),
      ece: round4(metrics.ece),
      baseRate: round4(evalBaseRate),
      evalFrames: data.evalCount,
      evalSessions: new Set(data.evalSessionIds).size,
    },
    reliability,
    inference: {
      microsPerInference: Number(microsPerInference.toFixed(4)),
      comparisonsPerInference: Math.round(
        booster.trees.reduce((sum, tree) => sum + tree.depth, 0),
      ),
      note:
        "pure-TS ensemble traversal (no matmul, no allocation) over held-out rows on this machine; " +
        `${probeRows} rows × ${timedPasses} passes after ${warm} warm-up passes. Model as JSON: ` +
        "model.json in this directory.",
      checksum: Number.isFinite(sink) ? "ok" : "nan",
    },
    crossCheck: {
      fullLogistic18_evalTsReplica: {
        ...fullLogistic,
        note: "verbatim reproduction of eval.ts's fullLogistic18 baseline (lib.trainLogistic, 40k stride subsample, class-weighted GD) — the shared cross-check number",
      },
      shippedMlp: {
        leadAuc20: 0.9248,
        rocAuc: 0.9614,
        recallAt30sPrearm: 0.5641,
        note: "quoted from src/shared/forecast/eval-report.json for orientation; not recomputed here",
      },
      shippedMlpOnTheseTraces: {
        settings: { nudgeRisk: thresholds.nudge, prearmRisk: thresholds.prearm },
        drifts: shippedEval.totals.drifts,
        recallAt30sNudge:
          shippedEval.totals.drifts > 0
            ? round4(shippedEval.totals.nudgeHits / shippedEval.totals.drifts)
            : null,
        recallAt30sPrearm:
          shippedEval.totals.drifts > 0
            ? round4(shippedEval.totals.prearmHits / shippedEval.totals.drifts)
            : null,
        nudgesPerHour: round4(shippedEval.totals.nudges / shippedEval.totals.hours),
        falsePrearmsPerHour: round4(shippedEval.totals.falsePrearms / shippedEval.totals.hours),
        note:
          "the SHIPPED weights.json run through the SAME replay, the SAME reducer and the SAME hit rules " +
          "as this candidate — the recallAt30sPrearm here reproduces the shipped report's 0.5641, which is " +
          "the check that the harness is faithful, and recallAt30sNudge is the number the shipped report " +
          "never published.",
      },
      beatsFullLogistic: round4(metrics.aucLead20) > fullLogistic.leadAuc20,
    },
    operatingPoint: {
      recommended,
      shippedDefaults: { nudge: thresholds.nudge, prearm: thresholds.prearm },
      rationale:
        "Chosen on TRAIN-INTERNAL calibration sessions only (never fitted on, never calibrated on, and " +
        "disjoint from every eval session): the lowest nudge threshold on the grid whose nudge rate on those " +
        "sessions does not exceed the SHIPPED MLP's nudge rate on the very same sessions, and which raises " +
        "zero nudges on research_churn. The grid stops at the shipped 0.55 default, so this model can never " +
        "recommend firing more often than the shipped one. The eval-side sweep below is published for " +
        "transparency and was NOT used to pick anything.",
      trainInternal: {
        sessions: calTraces.length,
        shippedMlpNudgesPerHour: round4(shippedNudgesPerHour),
        budgetSatisfied,
        fallback: budgetSatisfied
          ? null
          : "no grid point came in under the shipped MLP's train-internal nudge rate, so the recommendation falls back to the shipped 0.55 default (never lower, never chattier by choice)",
        grid: opTrials,
      },
      source: thresholds.source,
      frameLevel: {
        nudge: frameOperatingPoint(recommended.nudge),
        prearm: frameOperatingPoint(recommended.prearm),
      },
    },
    alarms: {
      rule: "recallAt30sNudge = fraction of held-out drift onsets with a forecast_nudge or forecast_prearm event from the SHIPPED stepEscalation reducer inside (onset−30 s, onset]",
      sessions: traces.length,
      evalHours: round4(totals.hours),
      drifts: totals.drifts,
      recallAt30sNudge: round4(recallAt30sNudge),
      nudgeHits: totals.nudgeHits,
      nudgeMisses: totals.drifts - totals.nudgeHits,
      medianNudgeLeadSec: percentile(nudgeLeads, 0.5),
      recallAt30sPrearm: round4(recallAt30sPrearm),
      prearmHits: totals.prearmHits,
      medianPrearmLeadSec: percentile(prearmLeads, 0.5),
      p25PrearmLeadSec: percentile(prearmLeads, 0.25),
      nudgesPerHour: round4(totals.nudges / totals.hours),
      falsePrearmsPerHour: round4(totals.falsePrearms / totals.hours),
      settings: {
        nudgeRisk: recommended.nudge,
        prearmRisk: recommended.prearm,
        prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
        baseFuseSec: DEFAULT_SETTINGS.countdownSec,
      },
    },
    alarmsAtShippedDefaults,
    thresholdSweep: sweep,
    researchChurn: {
      fprAtNudge: round4(fprResearchChurn),
      note: "frame-level false-positive rate on research_churn eval frames (zero drifts) at the recommended nudge threshold — same computation as eval.ts perArchetype",
    },
    perArchetype,
    search: {
      selectionMetric:
        "mean over 3 session-level folds of the fold's held-out lead-censored (≥20 s) ROC-AUC — " +
        "all folds live inside the dataset's TRAIN split",
      tieBreak: "within 0.001 CV AUC, prefer the smaller ensemble (fewer nodes)",
      earlyStopping: "per fold: fold lead≥20s AUC evaluated every 10 trees, patience 8 evaluations",
      finalRefit:
        "chosen config refit on the whole CV pool with the tree count fixed to the mean of the fold early stops",
      trials,
    },
    runtimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  };

  writeFileSync(join(config.outDir, "metrics.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    join(config.outDir, "model.json"),
    `${JSON.stringify(serializeBooster(booster, calibration.calibrator), null, 1)}\n`,
  );

  const headline = {
    candidate: CANDIDATE,
    approach: "gradient-boosted decision trees (hand-rolled, histogram splits, pure TS)",
    params: counts.nodes,
    aucLead20: round4(metrics.aucLead20),
    aucLead10: round4(metrics.aucLead10),
    rocAuc: round4(metrics.rocAuc),
    prAuc: round4(metrics.prAuc),
    ece: round4(metrics.ece),
    recallAt30sNudge: round4(recallAt30sNudge),
    recallAt30sPrearm: round4(recallAt30sPrearm),
    recallAt30sNudgeAtShippedDefaults: alarmsAtShippedDefaults.recallAt30sNudge,
    fprResearchChurn: round4(fprResearchChurn),
    fullLogistic18LeadAuc20: fullLogistic.leadAuc20,
    beatsFullLogistic: round4(metrics.aucLead20) > fullLogistic.leadAuc20,
    microsPerInference: Number(microsPerInference.toFixed(4)),
    operatingPoint: recommended,
  };
  console.log(JSON.stringify(headline, null, 2));
  console.log(`metrics → ${join(config.outDir, "metrics.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
