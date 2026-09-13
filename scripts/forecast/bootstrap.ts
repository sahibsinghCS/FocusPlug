import { mulberry32, rocAuc, round6 } from "./lib";

/**
 * Paired, session-clustered bootstrap over a lead-censored AUC — the same
 * estimator `scripts/forecast/adjudicate.ts` used to adjudicate the five-family
 * bake-off, factored out so `eval.ts --holdout` can report the MEASURED
 * standard error of the large hold-out corpus instead of a projection.
 *
 * Why clustered: frames inside one session are heavily autocorrelated, so the
 * independent unit is the SESSION. Resampling sessions with replacement and
 * giving every row of a session drawn k times an integer weight k is exactly a
 * cluster bootstrap, and it lets the weighted Mann–Whitney AUC be one O(n) pass
 * over a per-model pre-sorted score order.
 *
 * Why paired: every model is scored on the SAME resample, so the difference
 * between two models is read off the same draws and the shared session-level
 * noise cancels — which is the whole point when the differences under test
 * (+0.0013 … +0.0064) are smaller than either model's own interval.
 *
 * The weighted estimator is ASSERTED equal to `lib.rocAuc` at unit weights
 * (< 1e-12) for every model before any draw is taken, so this file does not
 * introduce a second definition of AUC — it introduces a reweighting of the
 * one in `lib.ts`.
 */

export interface BootstrapModel {
  name: string;
  /** Scores for the eligible rows only, in the same order as `label`/`cluster`. */
  scores: Float64Array;
}

export interface BootstrapPerModel {
  model: string;
  point: number;
  lo95: number;
  hi95: number;
  sd: number;
}

export interface BootstrapPair {
  model: string;
  vs: string;
  diff: number;
  lo95: number;
  hi95: number;
  sd: number;
  pDiffLeZero: number;
}

export interface BootstrapResult {
  draws: number;
  clusteredBy: string;
  clusters: number;
  eligibleRows: number;
  eligiblePositives: number;
  perModel: BootstrapPerModel[];
  pairs: BootstrapPair[];
  estimatorCheck: string;
}

function quantile(sorted: readonly number[], p: number): number {
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  ] as number;
}

function sd(values: readonly number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
  return Math.sqrt(
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, values.length),
  );
}

/**
 * @param label     per eligible row, 0/1
 * @param cluster   per eligible row, the session index it belongs to
 * @param clusters  number of distinct sessions
 * @param models    score vectors aligned with `label`
 * @param reference the model every pair is compared against
 */
export function pairedClusterBootstrap(
  label: Uint8Array,
  cluster: Int32Array,
  clusters: number,
  models: readonly BootstrapModel[],
  reference: string,
  draws: number,
  seed: number,
  onProgress?: (done: number, total: number) => void,
): BootstrapResult {
  const m = label.length;

  const weightedAuc = (
    sortedOrder: Int32Array,
    sortedScore: Float64Array,
    weightOfCluster: Float64Array,
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
        const w = weightOfCluster[cluster[idx] as number] as number;
        groupWeight += w;
        if ((label[idx] as number) === 1) {
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

  // One sort per model, reused by every draw; plus the unit-weight assertion
  // against the shared rank-based AUC in lib.ts.
  const labelArray = Array.from(label);
  const sorted = new Map<string, { order: Int32Array; score: Float64Array }>();
  const point = new Map<string, number>();
  const unit = new Float64Array(clusters).fill(1);
  for (const model of models) {
    const order = Int32Array.from(
      Array.from({ length: m }, (_, k) => k).sort(
        (a, b) => (model.scores[a] as number) - (model.scores[b] as number),
      ),
    );
    const sortedScore = new Float64Array(m);
    for (let k = 0; k < m; k += 1) {
      sortedScore[k] = model.scores[order[k] as number] as number;
    }
    sorted.set(model.name, { order, score: sortedScore });
    const mine = weightedAuc(order, sortedScore, unit);
    const theirs = rocAuc(Array.from(model.scores), labelArray);
    if (Math.abs(mine - theirs) > 1e-12) {
      throw new Error(
        `bootstrap AUC estimator disagrees with lib.rocAuc for ${model.name}: ${mine} vs ${theirs}`,
      );
    }
    point.set(model.name, theirs);
  }

  const rand = mulberry32(seed);
  const drawn = new Map<string, number[]>(models.map((model) => [model.name, []]));
  const weights = new Float64Array(clusters);
  for (let d = 0; d < draws; d += 1) {
    weights.fill(0);
    for (let k = 0; k < clusters; k += 1) {
      const pick = Math.floor(rand() * clusters);
      weights[pick] = (weights[pick] as number) + 1;
    }
    for (const model of models) {
      const entry = sorted.get(model.name) as { order: Int32Array; score: Float64Array };
      (drawn.get(model.name) as number[]).push(weightedAuc(entry.order, entry.score, weights));
    }
    if (onProgress && (d + 1) % 100 === 0) {
      onProgress(d + 1, draws);
    }
  }

  const perModel: BootstrapPerModel[] = models.map((model) => {
    const values = [...(drawn.get(model.name) as number[])].sort((a, b) => a - b);
    return {
      model: model.name,
      point: round6(point.get(model.name) as number),
      lo95: round6(quantile(values, 0.025)),
      hi95: round6(quantile(values, 0.975)),
      sd: round6(sd(values)),
    };
  });

  const refDraws = drawn.get(reference);
  if (refDraws === undefined) {
    throw new Error(`bootstrap reference model ${reference} was not scored`);
  }
  const pairs: BootstrapPair[] = [];
  for (const model of models) {
    if (model.name === reference) {
      continue;
    }
    const values = drawn.get(model.name) as number[];
    const diffs = values.map((v, i) => v - (refDraws[i] as number));
    const sortedDiffs = [...diffs].sort((a, b) => a - b);
    pairs.push({
      model: model.name,
      vs: reference,
      diff: round6((point.get(model.name) as number) - (point.get(reference) as number)),
      lo95: round6(quantile(sortedDiffs, 0.025)),
      hi95: round6(quantile(sortedDiffs, 0.975)),
      sd: round6(sd(diffs)),
      pDiffLeZero: round6(diffs.filter((v) => v <= 0).length / diffs.length),
    });
  }

  let positives = 0;
  for (let i = 0; i < m; i += 1) {
    positives += label[i] as number;
  }

  return {
    draws,
    clusteredBy: "held-out session",
    clusters,
    eligibleRows: m,
    eligiblePositives: positives,
    perModel,
    pairs,
    estimatorCheck: `weighted rank-sum verified against lib.rocAuc at unit weights for all ${models.length} models (|Δ| < 1e-12)`,
  };
}
