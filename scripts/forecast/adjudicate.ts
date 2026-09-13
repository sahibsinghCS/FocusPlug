import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { forward, parseForecastWeights } from "../../src/shared/forecast/model";
import { FORECAST_FEATURE_KEYS } from "../../src/shared/forecast/types";
import {
  DATASET_FILE,
  RAW_SESSIONS_FILE,
  ece10,
  forecastDataRoot,
  keepProbability,
  logisticScore,
  mulberry32,
  prAuc,
  readJsonl,
  repoRoot,
  replaySession,
  rocAuc,
  round6,
  shuffled,
  splitForSession,
  trainLogistic,
  type DatasetRow,
  type RawSession,
} from "./lib";
import {
  applyStandardizer,
  buildDesign,
  compileSpec,
  fitLogisticL2,
  fitStandardizer,
  rowLogit,
  type CompiledSpec,
  type Term,
} from "./candidates/lr-ceiling/linear";
import { buildChannels, CHANNEL_COUNT } from "./candidates/temporal/channels";
import {
  parseTemporalWeights,
  temporalEnsembleForward,
  type TemporalWeightsFile,
} from "./candidates/temporal/forward";

/**
 * ADJUDICATOR — independent re-derivation of the gauntlet's headline metric and
 * an honest noise floor for it.
 *
 * Nothing here is a contender. It rebuilds eval scores for the models whose
 * artifacts are exportable, recomputes lead-censored AUC with lib.rocAuc on
 * eval.ts's eligibility rule, and runs a PAIRED, SESSION-CLUSTERED bootstrap so
 * "+0.004 AUC" can be judged against the noise of 48 held-out sessions.
 */

const BASE_DIM = FORECAST_FEATURE_KEYS.length;
const LEAD = 20;

interface EvalRow {
  features: number[];
  label: number;
  secs: number; // NaN ⇒ no onset ahead
  session: string;
  archetype: string;
  t: number;
}

function leadEligible(secs: number, leadSec: number): boolean {
  return Number.isNaN(secs) || secs >= leadSec;
}

function leadAuc(rows: readonly EvalRow[], scores: readonly number[], leadSec: number): number {
  const s: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (leadEligible((rows[i] as EvalRow).secs, leadSec)) {
      s.push(scores[i] as number);
      y.push((rows[i] as EvalRow).label);
    }
  }
  return rocAuc(s, y);
}

async function main(): Promise<void> {
  const dataFile = join(forecastDataRoot(), DATASET_FILE);
  const rawFile = join(forecastDataRoot(), RAW_SESSIONS_FILE);
  const t0 = Date.now();

  // --- Load the fixed dataset ------------------------------------------------
  const evalRows: EvalRow[] = [];
  const trainBase: number[] = [];
  const trainY: number[] = [];
  const trainSecs: number[] = [];
  const trainImportance: number[] = [];
  const trainSessionOf: number[] = [];
  const trainSessions: string[] = [];
  const sessionIndex = new Map<string, number>();
  const evalTsTrainX: number[][] = [];
  const evalTsTrainY: number[] = [];

  for await (const row of readJsonl<DatasetRow>(dataFile)) {
    if (row.split === "eval") {
      evalRows.push({
        features: row.features,
        label: row.label,
        secs: row.secs_to_drift === null ? Number.NaN : row.secs_to_drift,
        session: row.session_id,
        archetype: row.archetype,
        t: row.t,
      });
      continue;
    }
    let index = sessionIndex.get(row.session_id);
    if (index === undefined) {
      index = trainSessions.length;
      sessionIndex.set(row.session_id, index);
      trainSessions.push(row.session_id);
    }
    for (let f = 0; f < BASE_DIM; f += 1) {
      trainBase.push(row.features[f] ?? 0);
    }
    trainY.push(row.label);
    trainSecs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
    trainImportance.push(1 / keepProbability(row.label, row.secs_to_drift));
    trainSessionOf.push(index);
    evalTsTrainX.push(row.features);
    evalTsTrainY.push(row.label);
  }
  const nEval = evalRows.length;
  const nTrain = trainY.length;
  const evalLabels = evalRows.map((r) => r.label);
  const evalSessionIds = [...new Set(evalRows.map((r) => r.session))].sort();
  const eligible20 = evalRows.filter((r) => leadEligible(r.secs, LEAD));
  console.log(
    `adjudicator: ${nTrain} train rows / ${trainSessions.length} sessions | ${nEval} eval rows / ` +
      `${evalSessionIds.length} sessions | lead>=20 eligible ${eligible20.length} ` +
      `(${eligible20.filter((r) => r.label === 1).length} positives) | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  const scoreSets = new Map<string, number[]>();

  // --- 1. Shipped MLP --------------------------------------------------------
  const shipped = parseForecastWeights(
    JSON.parse(readFileSync(join(repoRoot(), "src", "shared", "forecast", "weights.json"), "utf8")),
  );
  if (shipped === null) {
    throw new Error("shipped weights failed parseForecastWeights");
  }
  scoreSets.set(
    "shippedMLP(241p)",
    evalRows.map((r) => forward(shipped, r.features).rawRisk),
  );

  // --- 2. eval.ts fullLogistic18 replica -------------------------------------
  const cap = 40_000;
  const stride = Math.max(1, Math.ceil(evalTsTrainX.length / cap));
  const subX: number[][] = [];
  const subY: number[] = [];
  for (let i = 0; i < evalTsTrainX.length; i += stride) {
    subX.push(evalTsTrainX[i] as number[]);
    subY.push(evalTsTrainY[i] as number);
  }
  const allColumns = FORECAST_FEATURE_KEYS.map((_, i) => i);
  const evalTsFull = trainLogistic(subX, subY, allColumns);
  scoreSets.set(
    `fullLR${BASE_DIM}(evalts,${BASE_DIM + 1}p)`,
    evalRows.map((r) => logisticScore(evalTsFull, r.features, allColumns)),
  );

  // --- 3. lr-ceiling refits (its own linear.ts, its own val split) -----------
  const rand = mulberry32(42);
  const order = shuffled(
    Array.from({ length: trainSessions.length }, (_, i) => i),
    rand,
  );
  const valCount = Math.max(1, Math.round(trainSessions.length * 0.1));
  const valSessions = new Set<number>(order.slice(0, valCount));
  const fitList: number[] = [];
  for (let i = 0; i < nTrain; i += 1) {
    if (!valSessions.has(trainSessionOf[i] as number)) {
      fitList.push(i);
    }
  }
  const fitIdx = Int32Array.from(fitList);
  const trainBaseArr = Float32Array.from(trainBase);
  const trainYArr = Uint8Array.from(trainY);
  const importanceArr = Float64Array.from(trainImportance);

  const linTerms = (): Term[] => Array.from({ length: BASE_DIM }, (_, i) => ({ t: "lin", i }) as Term);
  const pairTerms = (): Term[] => {
    const out: Term[] = [];
    for (let i = 0; i < BASE_DIM; i += 1) {
      for (let j = i; j < BASE_DIM; j += 1) {
        out.push({ t: "prod", i, j });
      }
    }
    return out;
  };

  const sampleWeights = (posPower: number): Float64Array => {
    let wPos = 0;
    let wNeg = 0;
    for (let k = 0; k < fitIdx.length; k += 1) {
      const i = fitIdx[k] as number;
      if ((trainYArr[i] as number) === 1) wPos += importanceArr[i] as number;
      else wNeg += importanceArr[i] as number;
    }
    const cw = wPos > 0 ? Math.pow(wNeg / wPos, posPower) : 1;
    const out = new Float64Array(nTrain);
    for (let i = 0; i < nTrain; i += 1) {
      out[i] = (importanceArr[i] as number) * ((trainYArr[i] as number) === 1 ? cw : 1);
    }
    return out;
  };

  const evalBaseArr = Float32Array.from(
    evalRows.flatMap((r) => Array.from({ length: BASE_DIM }, (_, f) => r.features[f] ?? 0)),
  );

  const fitLinearVariant = (
    label: string,
    spec: CompiledSpec,
    lambda: number,
    posPower: number,
  ): void => {
    const design = buildDesign(trainBaseArr, nTrain, spec);
    const std = fitStandardizer(design, spec.dim, fitIdx);
    applyStandardizer(design, spec.dim, std);
    const sw = sampleWeights(posPower);
    // Same warm-started regularization path lr-ceiling walks, so the fit at the
    // chosen lambda starts from the same place.
    let warm: Float64Array | undefined;
    let theta = new Float64Array(spec.dim + 1);
    for (const lam of [1, 1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
      const fit = fitLogisticL2(design, spec.dim, fitIdx, trainYArr, sw, lam, 300, warm);
      warm = fit.theta;
      if (lam === lambda) {
        theta = Float64Array.from(fit.theta);
        break;
      }
    }
    const evalDesign = buildDesign(evalBaseArr, nEval, spec);
    applyStandardizer(evalDesign, spec.dim, std);
    const logits = new Array<number>(nEval);
    for (let i = 0; i < nEval; i += 1) {
      logits[i] = rowLogit(evalDesign, spec.dim, i, theta);
    }
    scoreSets.set(label, logits);
    console.log(`  refit ${label}: lead>=20 AUC ${leadAuc(evalRows, logits, 20).toFixed(5)}`);
  };

  console.log("refitting the linear family (lr-ceiling's own linear.ts, its own val split) …");
  // Labels carry the live width: BASE_DIM follows FORECAST_FEATURE_KEYS, so a
  // re-run after the feature set grows must not print "lr18" over 24 columns.
  const pairwiseParams = BASE_DIM + (BASE_DIM * (BASE_DIM + 1)) / 2 + 1;
  fitLinearVariant(
    `lr${BASE_DIM}tuned(${BASE_DIM + 1}p)`,
    compileSpec(`lr${BASE_DIM}`, BASE_DIM, linTerms()),
    1e-4,
    1,
  );
  fitLinearVariant(
    `lr${BASE_DIM}+pairwise(${pairwiseParams}p)`,
    compileSpec(`lr${BASE_DIM}+pairwise`, BASE_DIM, [...linTerms(), ...pairTerms()]),
    1e-5,
    1,
  );

  // --- 4. trees (exported model.json) ---------------------------------------
  const treesFile = join(forecastDataRoot(), "candidates", "trees", "model.json");
  if (existsSync(treesFile)) {
    interface TreeJson {
      feature: number[];
      threshold: number[];
      left: number[];
      right: number[];
      value: number[];
    }
    const model = JSON.parse(readFileSync(treesFile, "utf8")) as {
      baseScore: number;
      calibration: { type: string; x: number[]; p: number[] };
      trees: TreeJson[];
    };
    const margin = (x: readonly number[]): number => {
      let sum = model.baseScore;
      for (const tree of model.trees) {
        let node = 0;
        while ((tree.feature[node] as number) >= 0) {
          const f = tree.feature[node] as number;
          node =
            (x[f] ?? 0) <= (tree.threshold[node] as number)
              ? (tree.left[node] as number)
              : (tree.right[node] as number);
        }
        sum += tree.value[node] as number;
      }
      return sum;
    };
    scoreSets.set(
      "trees(3811n)",
      evalRows.map((r) => margin(r.features)),
    );
  } else {
    console.log("  (trees model.json absent — skipping)");
  }

  // --- 5. temporal (exported weights.json + portable forward) ----------------
  const temporalFile = join(forecastDataRoot(), "candidates", "temporal", "weights.json");
  if (existsSync(temporalFile)) {
    const bundle = JSON.parse(readFileSync(temporalFile, "utf8")) as {
      members: unknown[];
    };
    const models: TemporalWeightsFile[] = [];
    for (const member of bundle.members) {
      const parsed = parseTemporalWeights(member);
      if (parsed === null) {
        throw new Error("temporal member failed parseTemporalWeights");
      }
      models.push(parsed);
    }
    const seqLen = models[0]?.seqLen ?? 120;
    const pad = seqLen - 1;
    const channelsBySession = new Map<string, Float64Array>();
    const evalSessionSet = new Set(evalSessionIds);
    for await (const session of readJsonl<RawSession>(rawFile)) {
      if (!evalSessionSet.has(session.id)) {
        continue;
      }
      const frames = replaySession(session);
      channelsBySession.set(session.id, buildChannels(session, frames, pad));
    }
    const window = new Float64Array(seqLen * CHANNEL_COUNT);
    const scores = new Array<number>(nEval);
    for (let i = 0; i < nEval; i += 1) {
      const row = evalRows[i] as EvalRow;
      const channels = channelsBySession.get(row.session);
      if (channels === undefined) {
        throw new Error(`no channels for eval session ${row.session}`);
      }
      const off = (row.t - 1) * CHANNEL_COUNT;
      window.set(channels.subarray(off, off + seqLen * CHANNEL_COUNT));
      scores[i] = temporalEnsembleForward(models, window, row.features).rawRisk;
    }
    scoreSets.set(
      `temporal(${models.reduce((s, m) => s + m.paramCount, 0)}p)`,
      scores,
    );
    // Single best member (seq+f18) for the "one net, not an ensemble" question.
    const fusion = models.find((m) => m.variant.includes("f18"));
    if (fusion !== undefined) {
      const one = new Array<number>(nEval);
      for (let i = 0; i < nEval; i += 1) {
        const row = evalRows[i] as EvalRow;
        const channels = channelsBySession.get(row.session) as Float64Array;
        const off = (row.t - 1) * CHANNEL_COUNT;
        window.set(channels.subarray(off, off + seqLen * CHANNEL_COUNT));
        one[i] = temporalEnsembleForward([fusion], window, row.features).rawRisk;
      }
      scoreSets.set(`temporal-1net:${fusion.variant}(${fusion.paramCount}p)`, one);
    }
  } else {
    console.log("  (temporal weights.json absent — skipping)");
  }

  // --- 6. Any dumped candidate score files ----------------------------------
  for (const [key, file] of [
    ["mlp-tuned(721p)", join(forecastDataRoot(), "candidates", "mlp-tuned", "eval-scores.json")],
    ["hybrid(888p)", join(forecastDataRoot(), "candidates", "hybrid", "eval-scores.json")],
  ] as Array<[string, string]>) {
    if (!existsSync(file)) {
      continue;
    }
    const dumped = JSON.parse(readFileSync(file, "utf8")) as {
      sessionIds?: string[];
      t?: number[];
      scores: number[];
    };
    if (dumped.scores.length !== nEval) {
      throw new Error(`${key} dumped ${dumped.scores.length} scores, expected ${nEval}`);
    }
    if (dumped.sessionIds !== undefined && dumped.t !== undefined) {
      for (let i = 0; i < nEval; i += 1) {
        const row = evalRows[i] as EvalRow;
        if (dumped.sessionIds[i] !== row.session || dumped.t[i] !== row.t) {
          throw new Error(`${key} row order mismatch at ${i}`);
        }
      }
    }
    scoreSets.set(key, dumped.scores);
  }

  // --- Headline table --------------------------------------------------------
  const names = [...scoreSets.keys()];
  const table = names.map((name) => {
    const scores = scoreSets.get(name) as number[];
    return {
      model: name,
      aucLead20: round6(leadAuc(evalRows, scores, 20)),
      aucLead10: round6(leadAuc(evalRows, scores, 10)),
      rocAuc: round6(rocAuc(scores, evalLabels)),
      prAuc: round6(prAuc(scores, evalLabels)),
    };
  });
  console.log("\n=== re-derived held-out metrics (adjudicator) ===");
  for (const entry of table) {
    console.log(
      `  ${entry.model.padEnd(34)} lead>=20 ${entry.aucLead20.toFixed(4)} | lead>=10 ${entry.aucLead10.toFixed(4)} | ` +
        `ROC ${entry.rocAuc.toFixed(4)} | PR ${entry.prAuc.toFixed(4)}`,
    );
  }

  // --- Paired session-clustered bootstrap ------------------------------------
  // Resample the 48 held-out SESSIONS with replacement (frames inside a session
  // are autocorrelated, so the session is the independent unit), recompute the
  // pooled lead-censored AUC for every model on the SAME resample, and read the
  // paired differences off the same draws.
  const DRAWS = 2000;
  // Eligible rows only; a session drawn k times = every one of its rows with
  // integer weight k, which is exactly a cluster bootstrap and lets the AUC be
  // a single O(n) pass over one pre-sorted score order per model.
  const eligibleIdx: number[] = [];
  for (let i = 0; i < nEval; i += 1) {
    if (leadEligible((evalRows[i] as EvalRow).secs, LEAD)) {
      eligibleIdx.push(i);
    }
  }
  const m = eligibleIdx.length;
  const elLabel = new Uint8Array(m);
  const elSession = new Int32Array(m);
  const sessionList = [...new Set(eligibleIdx.map((i) => (evalRows[i] as EvalRow).session))].sort();
  const sessionNum = new Map(sessionList.map((id, k) => [id, k]));
  for (let k = 0; k < m; k += 1) {
    const row = evalRows[eligibleIdx[k] as number] as EvalRow;
    elLabel[k] = row.label;
    elSession[k] = sessionNum.get(row.session) as number;
  }

  /** Weighted Mann-Whitney AUC over a pre-sorted (ascending score) order. */
  const weightedAuc = (
    sortedOrder: Int32Array,
    sortedScore: Float64Array,
    weightOfSession: Float64Array,
  ): number => {
    let wPos = 0;
    let wNeg = 0;
    let rankSum = 0;
    let cumulative = 0;
    let i = 0;
    while (i < m) {
      let j = i;
      while (j + 1 < m && (sortedScore[j + 1] as number) === (sortedScore[i] as number)) {
        j += 1;
      }
      let groupWeight = 0;
      let groupPosWeight = 0;
      for (let k = i; k <= j; k += 1) {
        const idx = sortedOrder[k] as number;
        const w = weightOfSession[elSession[idx] as number] as number;
        groupWeight += w;
        if ((elLabel[idx] as number) === 1) {
          groupPosWeight += w;
        }
      }
      const avgRank = cumulative + (groupWeight + 1) / 2;
      rankSum += groupPosWeight * avgRank;
      wPos += groupPosWeight;
      wNeg += groupWeight - groupPosWeight;
      cumulative += groupWeight;
      i = j + 1;
    }
    if (wPos === 0 || wNeg === 0) {
      return 0.5;
    }
    return (rankSum - (wPos * (wPos + 1)) / 2) / (wPos * wNeg);
  };

  // One sort per model, reused by every draw.
  const sortedByModel = new Map<string, { order: Int32Array; score: Float64Array }>();
  for (const name of names) {
    const scores = scoreSets.get(name) as number[];
    const order = Int32Array.from(
      Array.from({ length: m }, (_, k) => k).sort(
        (a, b) =>
          (scores[eligibleIdx[a] as number] as number) - (scores[eligibleIdx[b] as number] as number),
      ),
    );
    const sortedScore = new Float64Array(m);
    for (let k = 0; k < m; k += 1) {
      sortedScore[k] = scores[eligibleIdx[order[k] as number] as number] as number;
    }
    sortedByModel.set(name, { order, score: sortedScore });
    // Assert the weighted estimator reproduces lib.rocAuc at unit weights.
    const unit = new Float64Array(sessionList.length).fill(1);
    const mine = weightedAuc(order, sortedScore, unit);
    const theirs = leadAuc(evalRows, scores, LEAD);
    if (Math.abs(mine - theirs) > 1e-12) {
      throw new Error(`weighted AUC mismatch for ${name}: ${mine} vs lib ${theirs}`);
    }
  }
  console.log(
    `bootstrap estimator verified against lib.rocAuc on all ${names.length} models (|Δ| < 1e-12)`,
  );

  const brand = mulberry32(20260912);
  const bootAuc = new Map<string, number[]>(names.map((n) => [n, []]));
  const weights = new Float64Array(sessionList.length);
  for (let d = 0; d < DRAWS; d += 1) {
    weights.fill(0);
    for (let k = 0; k < sessionList.length; k += 1) {
      const pick = Math.floor(brand() * sessionList.length);
      weights[pick] = (weights[pick] as number) + 1;
    }
    for (const name of names) {
      const entry = sortedByModel.get(name) as { order: Int32Array; score: Float64Array };
      (bootAuc.get(name) as number[]).push(weightedAuc(entry.order, entry.score, weights));
    }
    if ((d + 1) % 500 === 0) {
      console.log(`  bootstrap ${d + 1}/${DRAWS} … ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  const quantile = (sorted: number[], p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] as number;

  console.log("\n=== session-clustered bootstrap, per-model 95% CI (2000 draws, 48 sessions) ===");
  const perModel = names.map((name) => {
    const draws = [...(bootAuc.get(name) as number[])].sort((a, b) => a - b);
    return {
      model: name,
      point: round6(leadAuc(evalRows, scoreSets.get(name) as number[], 20)),
      lo95: round6(quantile(draws, 0.025)),
      hi95: round6(quantile(draws, 0.975)),
      sd: round6(
        Math.sqrt(
          draws.reduce((s, v) => s + (v - draws.reduce((a, b) => a + b, 0) / draws.length) ** 2, 0) /
            draws.length,
        ),
      ),
    };
  });
  for (const entry of perModel) {
    console.log(
      `  ${entry.model.padEnd(34)} ${entry.point.toFixed(4)}  [${entry.lo95.toFixed(4)}, ${entry.hi95.toFixed(4)}]  sd ${entry.sd.toFixed(4)}`,
    );
  }

  // Paired differences against every linear reference.
  const references = names.filter(
    (n) => n.startsWith(`lr${BASE_DIM}`) || n.startsWith(`fullLR${BASE_DIM}`),
  );
  const pairs: Array<Record<string, unknown>> = [];
  console.log("\n=== PAIRED differences (same resample), 95% CI + one-sided p(diff <= 0) ===");
  for (const ref of references) {
    const refDraws = bootAuc.get(ref) as number[];
    for (const name of names) {
      if (name === ref) {
        continue;
      }
      const draws = bootAuc.get(name) as number[];
      const diffs = draws.map((v, i) => v - (refDraws[i] as number));
      const sortedDiffs = [...diffs].sort((a, b) => a - b);
      const nonPositive = diffs.filter((v) => v <= 0).length;
      const point =
        leadAuc(evalRows, scoreSets.get(name) as number[], 20) -
        leadAuc(evalRows, scoreSets.get(ref) as number[], 20);
      const row = {
        model: name,
        vs: ref,
        diff: round6(point),
        lo95: round6(quantile(sortedDiffs, 0.025)),
        hi95: round6(quantile(sortedDiffs, 0.975)),
        pDiffLeZero: round6(nonPositive / diffs.length),
      };
      pairs.push(row);
      console.log(
        `  ${name.padEnd(34)} vs ${ref.padEnd(22)} ${point >= 0 ? "+" : ""}${point.toFixed(4)}  ` +
          `[${row.lo95 >= 0 ? "+" : ""}${row.lo95.toFixed(4)}, ${row.hi95 >= 0 ? "+" : ""}${row.hi95.toFixed(4)}]  ` +
          `p(<=0) ${row.pDiffLeZero.toFixed(3)}`,
      );
    }
  }

  const out = {
    createdBy: "scripts/forecast/adjudicate.ts",
    dataset: {
      evalRows: nEval,
      evalSessions: evalSessionIds.length,
      leadEligible20: eligible20.length,
      leadEligible20Positives: eligible20.filter((r) => r.label === 1).length,
    },
    table,
    bootstrap: { draws: DRAWS, clusteredBy: "eval session", perModel, pairs },
  };
  const outFile = join(forecastDataRoot(), "candidates", "adjudication.json");
  writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${outFile} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
