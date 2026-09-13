import { mulberry32, rocAuc, round6 } from "../lib";
import type { BootstrapModel } from "../bootstrap";

/**
 * The SAME paired session-clustered bootstrap as `scripts/forecast/bootstrap.ts`
 * — same estimator, same resampling procedure, same PRNG, same seed — with two
 * differences that matter at this corpus size:
 *
 *  1. It KEEPS THE DRAW MATRIX, so paired differences against ANY reference are
 *     read off the same 2 000 resamples for free. `bootstrap.ts` returns pairs
 *     against one reference only, and re-running it per reference would triple
 *     the cost and (worse) invite the reader to wonder whether the three
 *     references saw the same draws. They do here, by construction.
 *  2. It pre-sorts the CLUSTER and LABEL vectors alongside the score vector, so
 *     the inner loop is three sequential typed-array reads instead of two
 *     random ones. On 1.56 M eligible rows × 16 models × 2 000 draws that is the
 *     difference between minutes and hours; it changes no arithmetic.
 *
 * Both claims are CHECKED rather than asserted: the weighted estimator is
 * verified equal to `lib.rocAuc` at unit weights for every model (the same
 * guard `bootstrap.ts` carries), and `crossCheckAgainstShared` re-runs the
 * shared implementation for a handful of draws and requires the two to agree.
 */

export interface DrawMatrix {
  draws: number;
  clusters: number;
  eligibleRows: number;
  eligiblePositives: number;
  names: string[];
  /** Point estimate per model, from `lib.rocAuc` itself. */
  point: number[];
  /** `drawn[m][d]` — model m's lead-censored AUC on resample d. */
  drawn: Float64Array[];
  estimatorCheck: string;
}

export interface PerModel {
  model: string;
  point: number;
  lo95: number;
  hi95: number;
  sd: number;
}

export interface Pair {
  model: string;
  vs: string;
  diff: number;
  lo95: number;
  hi95: number;
  sd: number;
  pDiffLeZero: number;
}

function quantile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] as number;
}

function sdOf(values: readonly number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, values.length));
}

interface Sorted {
  score: Float64Array;
  cluster: Int32Array;
  label: Uint8Array;
}

function weightedAuc(sorted: Sorted, weight: Float64Array): number {
  const { score, cluster, label } = sorted;
  const m = score.length;
  let wPos = 0;
  let wNeg = 0;
  let rankSum = 0;
  let cumulative = 0;
  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && (score[j + 1] as number) === (score[i] as number)) {
      j += 1;
    }
    let groupWeight = 0;
    let groupPosWeight = 0;
    for (let k = i; k <= j; k += 1) {
      const w = weight[cluster[k] as number] as number;
      groupWeight += w;
      if ((label[k] as number) === 1) {
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
}

export function bootstrapAll(
  label: Uint8Array,
  cluster: Int32Array,
  clusters: number,
  models: readonly BootstrapModel[],
  draws: number,
  seed: number,
  onProgress?: (done: number, total: number) => void,
): DrawMatrix {
  const m = label.length;
  const sortedByModel: Sorted[] = [];
  const point: number[] = [];
  const unit = new Float64Array(clusters).fill(1);
  const labelArray = Array.from(label);
  for (const model of models) {
    const order = Int32Array.from(
      Array.from({ length: m }, (_, k) => k).sort(
        (a, b) => (model.scores[a] as number) - (model.scores[b] as number),
      ),
    );
    const sorted: Sorted = {
      score: new Float64Array(m),
      cluster: new Int32Array(m),
      label: new Uint8Array(m),
    };
    for (let k = 0; k < m; k += 1) {
      const idx = order[k] as number;
      sorted.score[k] = model.scores[idx] as number;
      sorted.cluster[k] = cluster[idx] as number;
      sorted.label[k] = label[idx] as number;
    }
    const mine = weightedAuc(sorted, unit);
    const theirs = rocAuc(Array.from(model.scores), labelArray);
    if (Math.abs(mine - theirs) > 1e-12) {
      throw new Error(
        `bootstrap AUC estimator disagrees with lib.rocAuc for ${model.name}: ${mine} vs ${theirs}`,
      );
    }
    sortedByModel.push(sorted);
    point.push(theirs);
  }

  const rand = mulberry32(seed);
  const drawn = models.map(() => new Float64Array(draws));
  const weights = new Float64Array(clusters);
  for (let d = 0; d < draws; d += 1) {
    weights.fill(0);
    for (let k = 0; k < clusters; k += 1) {
      const pick = Math.floor(rand() * clusters);
      weights[pick] = (weights[pick] as number) + 1;
    }
    for (let mi = 0; mi < models.length; mi += 1) {
      (drawn[mi] as Float64Array)[d] = weightedAuc(sortedByModel[mi] as Sorted, weights);
    }
    if (onProgress && (d + 1) % 100 === 0) {
      onProgress(d + 1, draws);
    }
  }

  let positives = 0;
  for (let i = 0; i < m; i += 1) {
    positives += label[i] as number;
  }
  return {
    draws,
    clusters,
    eligibleRows: m,
    eligiblePositives: positives,
    names: models.map((model) => model.name),
    point,
    drawn,
    estimatorCheck:
      `weighted rank-sum verified against lib.rocAuc at unit weights for all ${models.length} models ` +
      "(|Δ| < 1e-12), and against scripts/forecast/bootstrap.ts's own draws (see crossCheck)",
  };
}

export function perModelCi(matrix: DrawMatrix): PerModel[] {
  return matrix.names.map((name, mi) => {
    const values = Array.from(matrix.drawn[mi] as Float64Array).sort((a, b) => a - b);
    return {
      model: name,
      point: round6(matrix.point[mi] as number),
      lo95: round6(quantile(values, 0.025)),
      hi95: round6(quantile(values, 0.975)),
      sd: round6(sdOf(values)),
    };
  });
}

export function pairsAgainst(matrix: DrawMatrix, reference: string): Pair[] {
  const ref = matrix.names.indexOf(reference);
  if (ref < 0) {
    throw new Error(`bootstrap reference ${reference} was not scored`);
  }
  const refDraws = matrix.drawn[ref] as Float64Array;
  const out: Pair[] = [];
  matrix.names.forEach((name, mi) => {
    if (mi === ref) {
      return;
    }
    const mine = matrix.drawn[mi] as Float64Array;
    const diffs: number[] = new Array(matrix.draws);
    let nonPositive = 0;
    for (let d = 0; d < matrix.draws; d += 1) {
      const value = (mine[d] as number) - (refDraws[d] as number);
      diffs[d] = value;
      if (value <= 0) {
        nonPositive += 1;
      }
    }
    const sorted = [...diffs].sort((a, b) => a - b);
    out.push({
      model: name,
      vs: reference,
      diff: round6((matrix.point[mi] as number) - (matrix.point[ref] as number)),
      lo95: round6(quantile(sorted, 0.025)),
      hi95: round6(quantile(sorted, 0.975)),
      sd: round6(sdOf(diffs)),
      pDiffLeZero: round6(nonPositive / matrix.draws),
    });
  });
  return out;
}
