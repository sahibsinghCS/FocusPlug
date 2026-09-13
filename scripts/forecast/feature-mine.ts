import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pairedClusterBootstrap, type BootstrapModel } from "./bootstrap";
import {
  DATASET_FILE,
  RAW_SESSIONS_FILE,
  forecastDataRoot,
  mulberry32,
  numberArg,
  rocAuc,
  round6,
  shuffled,
  stringArg,
} from "./lib";
import {
  MINED_BASE_DIM,
  MINED_DIM,
  MINED_KEYS,
  MINED_TREND_ORDER,
  loadMinedTrainRows,
  type MinedRows,
} from "./trend-candidates";
import { applyStandardizer, fitLogisticL2, fitStandardizer, rowLogit } from "./linear";

/**
 * ============================================================================
 * FEATURE MINING — which trend features earn a place in `extractFeatures`
 * ============================================================================
 *
 * The bake-off's own conclusion was that features, not architecture, were the
 * highest-value follow-up: the hybrid contender's ablation ladder moved a plain
 * logistic 0.9325 → 0.9408 using only extras read off the existing
 * `TelemetryRing`, while its architecture alone scored 0.9313 — BELOW the plain
 * logistic. This script is the audit that decides which of those extras (plus
 * new ones in the same spirit) ship.
 *
 * WHAT IT MEASURES. A candidate is worth its place if removing it from an
 * otherwise-identical model measurably costs held-out ranking. So the primary
 * statistic is a LEAVE-ONE-OUT REFIT delta, not an occlusion delta: occlusion
 * asks "what does this model lose if the input is blanked", refit asks "is this
 * input worth a column at all", and only the second answers the ship question.
 * Both are reported; occlusion is the one the shipped `eval.ts` ablation and
 * the UI attributions use, so the two are printed side by side.
 *
 * DATA DISCIPLINE (non-negotiable). Only `split:"train"` rows are ever read.
 * The 48-session eval split is not opened here, and neither is the large
 * hold-out corpus under `data/forecast/holdout/`. Selection happens on an
 * INNER split of the train sessions:
 *
 *   - inner-val = 20 % of the SYNTHETIC train sessions, by seeded shuffle;
 *   - every `augmented:local` session is forced inner-FIT, because it is a
 *     jittered derivative of some train session — a twin of an inner-val
 *     session in the fit set would leak the answer;
 *   - the standardizer, the class weight and the L2 path are all fitted on
 *     inner-fit rows only.
 *
 * WHY A PLAIN LOGISTIC AND NOT THE SHIPPED PAIRWISE BASIS. Selection over a
 * d(d+1)/2 basis would let a feature earn its keep through 30 interaction terms
 * fitted on the same rows that judge it — the classic way to select noise. The
 * additive fit is the conservative test: a feature that cannot pay for one
 * column does not get 31. The shipped pairwise refit then happens in `train.ts`
 * on the surviving basis, and `eval.ts` reports what it is worth held out.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/feature-mine.ts
 */

/** Indices 0..17 — the original level block, never a selection candidate. */
const BASE_DIM = MINED_BASE_DIM;
/** Selection metric: the lead-censoring eval.ts gates on. */
const SELECTION_LEAD_SEC = 20;
/** L2 path for the reported rungs (warm-started, strong → weak). */
const LAMBDAS = [1e-2, 1e-3, 1e-4, 1e-5, 1e-6];
/**
 * A candidate survives backward elimination while dropping it costs at least
 * this much inner-val lead≥20s AUC. 0.0005 is deliberately small: the point is
 * to remove features that do nothing, not to demand significance from each one
 * individually (a paired bootstrap on the whole kept set reports that).
 */
const KEEP_TAU = 0.0005;

interface Config {
  data: string;
  raw: string;
  out: string;
  seed: number;
  iters: number;
  draws: number;
}

function readConfig(): Config {
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    out: stringArg("--out", join(forecastDataRoot(), "feature-mine.json")),
    seed: numberArg("--seed", 42),
    iters: Math.round(numberArg("--iters", 300)),
    draws: Math.max(0, Math.round(numberArg("--draws", 1000))),
  };
}

type Rows = MinedRows;

/** Class-weighted importance, w_pos = (Σw_neg/Σw_pos)^1 — the shipped choice. */
function sampleWeights(rows: Rows, fitIdx: Int32Array): Float64Array {
  let wPos = 0;
  let wNeg = 0;
  for (let k = 0; k < fitIdx.length; k += 1) {
    const i = fitIdx[k] as number;
    if ((rows.y[i] as number) === 1) {
      wPos += rows.importance[i] as number;
    } else {
      wNeg += rows.importance[i] as number;
    }
  }
  const cw = wPos > 0 ? wNeg / wPos : 1;
  const out = new Float64Array(rows.n);
  for (let i = 0; i < rows.n; i += 1) {
    out[i] = (rows.importance[i] as number) * ((rows.y[i] as number) === 1 ? cw : 1);
  }
  return out;
}

/** Materializes a standardized design over a column subset (fit-subset stats). */
function designFor(rows: Rows, cols: readonly number[], fitIdx: Int32Array): Float32Array {
  const d = cols.length;
  const out = new Float32Array(rows.n * d);
  for (let i = 0; i < rows.n; i += 1) {
    const src = i * rows.dim;
    const dst = i * d;
    for (let j = 0; j < d; j += 1) {
      out[dst + j] = rows.x[src + (cols[j] as number)] as number;
    }
  }
  applyStandardizer(out, d, fitStandardizer(out, d, fitIdx));
  return out;
}

interface FitResult {
  lambda: number;
  auc: number;
  scores: Float64Array; // inner-val logits, aligned with valIdx
}

/** Fits the L2 path on `cols` and returns the λ with the best inner-val AUC. */
function fitCols(
  rows: Rows,
  cols: readonly number[],
  fitIdx: Int32Array,
  valIdx: Int32Array,
  weights: Float64Array,
  lambdas: readonly number[],
  iters: number,
): FitResult {
  const d = cols.length;
  const design = designFor(rows, cols, fitIdx);
  let best: FitResult | null = null;
  let warm: Float64Array | undefined;
  for (const lambda of lambdas) {
    const fit = fitLogisticL2(design, d, fitIdx, rows.y, weights, lambda, iters, warm);
    warm = fit.theta;
    const scores = new Float64Array(valIdx.length);
    for (let k = 0; k < valIdx.length; k += 1) {
      scores[k] = rowLogit(design, d, valIdx[k] as number, fit.theta);
    }
    const auc = leadAuc(rows, valIdx, scores);
    if (best === null || auc > best.auc) {
      best = { lambda, auc, scores };
    }
  }
  return best as FitResult;
}

/** Lead-censored ROC-AUC over the inner-val rows (eval.ts's eligibility rule). */
function leadAuc(rows: Rows, valIdx: Int32Array, scores: Float64Array): number {
  const s: number[] = [];
  const l: number[] = [];
  for (let k = 0; k < valIdx.length; k += 1) {
    const i = valIdx[k] as number;
    const sec = rows.secs[i] as number;
    if (Number.isNaN(sec) || sec >= SELECTION_LEAD_SEC) {
      s.push(scores[k] as number);
      l.push(rows.y[i] as number);
    }
  }
  return rocAuc(s, l);
}

function keysOf(cols: readonly number[]): string[] {
  return cols.map((c) => MINED_KEYS[c] as string);
}

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  const dim = MINED_DIM;
  const candidateCols = Array.from({ length: dim - BASE_DIM }, (_, i) => BASE_DIM + i);
  if (candidateCols.length === 0) {
    throw new Error("no candidate features beyond the base block — nothing to mine");
  }
  const rows = await loadMinedTrainRows(config.data, config.raw, config.seed);
  if (rows.n === 0) {
    throw new Error("no train rows — run 'npm run forecast:data' first");
  }

  // --- Inner fit / val split, by SESSION -----------------------------------
  const syntheticSessions = rows.sessions
    .map((_, i) => i)
    .filter((i) => rows.synthetic[i] === true);
  const order = shuffled(syntheticSessions, mulberry32(config.seed ^ 0x4d494e45));
  const valSessionCount = Math.max(1, Math.round(order.length * 0.2));
  const valSessions = new Set(order.slice(0, valSessionCount));
  const fitList: number[] = [];
  const valList: number[] = [];
  for (let i = 0; i < rows.n; i += 1) {
    (valSessions.has(rows.sessionOf[i] as number) ? valList : fitList).push(i);
  }
  const fitIdx = Int32Array.from(fitList);
  const valIdx = Int32Array.from(valList);
  const weights = sampleWeights(rows, fitIdx);
  let valPositives = 0;
  for (const i of valIdx) {
    valPositives += rows.y[i] as number;
  }
  console.log(
    `[mine] train rows ${rows.n} over ${rows.sessions.length} sessions | ` +
      `inner-fit ${fitIdx.length} / inner-val ${valIdx.length} rows ` +
      `(${valSessions.size}/${syntheticSessions.length} synthetic sessions, ${valPositives} positives) | ` +
      `${dim} features (${candidateCols.length} candidates: ` +
      `${MINED_TREND_ORDER.filter((e) => e.source === "shipped").length} shipped + ` +
      `${MINED_TREND_ORDER.filter((e) => e.source === "retired").length} retired) | ` +
      `replay self-check worst |Δ| ${rows.selfCheck.worstDelta.toExponential(2)} over ` +
      `${rows.selfCheck.rows} sampled rows`,
  );

  const baseCols = Array.from({ length: BASE_DIM }, (_, i) => i);
  const allCols = Array.from({ length: dim }, (_, i) => i);

  // --- Rung 0/1: base block vs base + every candidate ----------------------
  const base = fitCols(rows, baseCols, fitIdx, valIdx, weights, LAMBDAS, config.iters);
  console.log(`[mine] base-${BASE_DIM}      λ=${base.lambda} inner-val lead≥20s ${base.auc.toFixed(6)}`);
  const all = fitCols(rows, allCols, fitIdx, valIdx, weights, LAMBDAS, config.iters);
  console.log(
    `[mine] all-${dim}      λ=${all.lambda} inner-val lead≥20s ${all.auc.toFixed(6)} ` +
      `(+${(all.auc - base.auc).toFixed(6)})`,
  );

  // --- Occlusion on the all-candidates fit ---------------------------------
  // Standardized design ⇒ the training mean is exactly 0, so occluding feature
  // f is zeroing its column. Same definition eval.ts's ablation uses.
  const allDesign = designFor(rows, allCols, fitIdx);
  const allFit = fitLogisticL2(
    allDesign,
    dim,
    fitIdx,
    rows.y,
    weights,
    all.lambda,
    config.iters,
  );
  const occlusion = new Map<string, number>();
  for (let f = 0; f < dim; f += 1) {
    const theta = Float64Array.from(allFit.theta);
    theta[f] = 0;
    const scores = new Float64Array(valIdx.length);
    for (let k = 0; k < valIdx.length; k += 1) {
      scores[k] = rowLogit(allDesign, dim, valIdx[k] as number, theta);
    }
    occlusion.set(MINED_KEYS[f] as string, all.auc - leadAuc(rows, valIdx, scores));
  }

  // --- Backward elimination over the CANDIDATES only -----------------------
  // Single λ (the one the full set chose) so the loop is affordable; the
  // reported rungs re-sweep the path. Base features are never candidates for
  // removal — this audit is about what the trend block adds, not a re-litigation
  // of the shipped 18.
  const kept = new Set(candidateCols);
  const eliminationLog: Array<{
    round: number;
    dropped: string | null;
    costOfDropping: number;
    remaining: string[];
    aucWithout: number;
  }> = [];
  let currentAuc = all.auc;
  let round = 0;
  for (;;) {
    round += 1;
    let worst: { col: number; auc: number } | null = null;
    for (const col of kept) {
      const cols = [...baseCols, ...[...kept].filter((c) => c !== col).sort((a, b) => a - b)];
      const trial = fitCols(rows, cols, fitIdx, valIdx, weights, [all.lambda], config.iters);
      if (worst === null || trial.auc > worst.auc) {
        worst = { col, auc: trial.auc };
      }
    }
    if (worst === null) {
      break;
    }
    const cost = currentAuc - worst.auc;
    const key = MINED_KEYS[worst.col] as string;
    if (cost < KEEP_TAU) {
      kept.delete(worst.col);
      eliminationLog.push({
        round,
        dropped: key,
        costOfDropping: round6(cost),
        remaining: keysOf([...kept].sort((a, b) => a - b)),
        aucWithout: round6(worst.auc),
      });
      console.log(
        `[mine] round ${String(round).padStart(2)} drop ${key.padEnd(18)} cost ${cost.toFixed(6)} ` +
          `→ inner-val ${worst.auc.toFixed(6)} (${kept.size} candidates left)`,
      );
      currentAuc = worst.auc;
      if (kept.size === 0) {
        break;
      }
      continue;
    }
    eliminationLog.push({
      round,
      dropped: null,
      costOfDropping: round6(cost),
      remaining: keysOf([...kept].sort((a, b) => a - b)),
      aucWithout: round6(worst.auc),
    });
    console.log(
      `[mine] round ${String(round).padStart(2)} STOP — cheapest drop is ${key} at cost ` +
        `${cost.toFixed(6)} ≥ τ ${KEEP_TAU} (${kept.size} candidates kept)`,
    );
    break;
  }

  const keptCols = [...kept].sort((a, b) => a - b);
  const keptKeys = keysOf(keptCols);
  const rejectedKeys = keysOf(candidateCols.filter((c) => !kept.has(c)));

  // --- Leave-one-out refit deltas on the KEPT set (the publishable table) ---
  const finalCols = [...baseCols, ...keptCols];
  const finalFit =
    keptCols.length === candidateCols.length
      ? all
      : fitCols(rows, finalCols, fitIdx, valIdx, weights, LAMBDAS, config.iters);
  const looRows: Array<{ key: string; looRefitDrop: number; occlusionDrop: number }> = [];
  for (const col of keptCols) {
    const cols = finalCols.filter((c) => c !== col);
    const trial = fitCols(rows, cols, fitIdx, valIdx, weights, LAMBDAS, config.iters);
    looRows.push({
      key: MINED_KEYS[col] as string,
      looRefitDrop: round6(finalFit.auc - trial.auc),
      occlusionDrop: round6(occlusion.get(MINED_KEYS[col] as string) ?? 0),
    });
  }
  looRows.sort((a, b) => b.looRefitDrop - a.looRefitDrop);

  // Rejects: what each one WOULD have added to the kept set, one at a time.
  const rejectRows: Array<{ key: string; addedToKeptSet: number; occlusionInAllSet: number }> = [];
  for (const col of candidateCols.filter((c) => !kept.has(c))) {
    const cols = [...finalCols, col].sort((a, b) => a - b);
    const trial = fitCols(rows, cols, fitIdx, valIdx, weights, LAMBDAS, config.iters);
    rejectRows.push({
      key: MINED_KEYS[col] as string,
      addedToKeptSet: round6(trial.auc - finalFit.auc),
      occlusionInAllSet: round6(occlusion.get(MINED_KEYS[col] as string) ?? 0),
    });
  }
  rejectRows.sort((a, b) => b.addedToKeptSet - a.addedToKeptSet);

  // --- The three the bake-off nominated, on their own ----------------------
  const provenKeys = ["deskSagSlope30", "dwellShrink30v90", "titleChurnAccel"];
  const provenCols = provenKeys.map((k) => MINED_KEYS.indexOf(k)).filter((i) => i >= 0);
  const proven = fitCols(
    rows,
    [...baseCols, ...provenCols].sort((a, b) => a - b),
    fitIdx,
    valIdx,
    weights,
    LAMBDAS,
    config.iters,
  );

  // --- Paired session-clustered bootstrap on the inner-val sessions --------
  const eligible: number[] = [];
  for (let k = 0; k < valIdx.length; k += 1) {
    const i = valIdx[k] as number;
    const sec = rows.secs[i] as number;
    if (Number.isNaN(sec) || sec >= SELECTION_LEAD_SEC) {
      eligible.push(k);
    }
  }
  const clusterIds = new Map<number, number>();
  const label = new Uint8Array(eligible.length);
  const cluster = new Int32Array(eligible.length);
  eligible.forEach((k, m) => {
    const i = valIdx[k] as number;
    label[m] = rows.y[i] as number;
    const s = rows.sessionOf[i] as number;
    let c = clusterIds.get(s);
    if (c === undefined) {
      c = clusterIds.size;
      clusterIds.set(s, c);
    }
    cluster[m] = c;
  });
  const pick = (scores: Float64Array): Float64Array =>
    Float64Array.from(eligible.map((k) => scores[k] as number));
  const models: BootstrapModel[] = [
    { name: `base${BASE_DIM}`, scores: pick(base.scores) },
    { name: `base${BASE_DIM}+proven3`, scores: pick(proven.scores) },
    { name: `base${BASE_DIM}+kept${keptCols.length}`, scores: pick(finalFit.scores) },
    { name: `base${BASE_DIM}+all${candidateCols.length}`, scores: pick(all.scores) },
  ];
  const bootstrap =
    config.draws > 0
      ? pairedClusterBootstrap(
          label,
          cluster,
          clusterIds.size,
          models,
          `base${BASE_DIM}`,
          config.draws,
          config.seed,
        )
      : null;

  const report = {
    script: "scripts/forecast/feature-mine.ts",
    command: "npx tsx --tsconfig tsconfig.node.json scripts/forecast/feature-mine.ts",
    seed: config.seed,
    protocol: {
      metric: `inner-val lead-censored (≥ ${SELECTION_LEAD_SEC} s) ROC-AUC`,
      model: "additive L2 logistic (no pairwise basis) — the conservative test",
      split:
        "inner-val = 20 % of SYNTHETIC train sessions (seeded); augmented:local sessions forced " +
        "inner-fit so a jittered twin can never sit opposite its parent",
      contamination:
        "only split=='train' rows are read; the 48-session eval split and data/forecast/holdout/ " +
        "are never opened",
      rule: `backward elimination over the candidate block, keep while the cost of dropping ≥ ${KEEP_TAU}`,
      lambdaPath: LAMBDAS,
    },
    dataset: {
      file: config.data,
      raw: config.raw,
      columns: MINED_TREND_ORDER.map((entry) => ({ key: entry.key, source: entry.source })),
      extrasSource:
        "the retired candidates are recomputed by replaying raw-sessions.jsonl (plus the " +
        "pipeline's own augmentLocal derivatives) through the SHARED ring " +
        "(scripts/forecast/trend-candidates.ts) and joined on (session_id, t); the shipped " +
        "columns are dataset.jsonl's own, written by the real extractFeatures",
      replaySelfCheck: rows.selfCheck,
      trainRows: rows.n,
      trainSessions: rows.sessions.length,
      innerFitRows: fitIdx.length,
      innerValRows: valIdx.length,
      innerValSessions: valSessions.size,
      innerValPositives: valPositives,
      eligibleRows: eligible.length,
    },
    ladder: [
      { name: `base-${BASE_DIM} (shipped level block)`, dim: BASE_DIM, lambda: base.lambda, innerValLeadAuc20: round6(base.auc) },
      {
        name: `base-${BASE_DIM} + the 3 the bake-off nominated`,
        dim: BASE_DIM + provenCols.length,
        lambda: proven.lambda,
        innerValLeadAuc20: round6(proven.auc),
        gainOverBase: round6(proven.auc - base.auc),
      },
      {
        name: `base-${BASE_DIM} + kept trend block`,
        dim: finalCols.length,
        lambda: finalFit.lambda,
        innerValLeadAuc20: round6(finalFit.auc),
        gainOverBase: round6(finalFit.auc - base.auc),
      },
      {
        name: `base-${BASE_DIM} + every candidate`,
        dim,
        lambda: all.lambda,
        innerValLeadAuc20: round6(all.auc),
        gainOverBase: round6(all.auc - base.auc),
      },
    ],
    kept: keptKeys,
    rejected: rejectedKeys,
    perFeature: looRows,
    rejectDetail: rejectRows,
    eliminationLog,
    occlusionAllSet: [...occlusion.entries()]
      .map(([key, drop]) => ({ key, leadAuc20Drop: round6(drop) }))
      .sort((a, b) => b.leadAuc20Drop - a.leadAuc20Drop),
    bootstrap,
    elapsedSec: round6((Date.now() - startedAt) / 1000),
  };

  mkdirSync(join(config.out, ".."), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `[mine] KEEP ${keptKeys.join(", ") || "(none)"}\n` +
      `[mine] DROP ${rejectedKeys.join(", ") || "(none)"}\n` +
      `[mine] base ${base.auc.toFixed(4)} → kept ${finalFit.auc.toFixed(4)} ` +
      `(+${(finalFit.auc - base.auc).toFixed(4)}) | all ${all.auc.toFixed(4)} | ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s → ${config.out}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
