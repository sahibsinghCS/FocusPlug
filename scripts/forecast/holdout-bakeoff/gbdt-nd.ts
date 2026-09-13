/**
 * MECHANICAL DERIVATIVE of `scripts/forecast/candidates/trees/gbdt.ts`.
 *
 * The frozen contender hard-codes `export const N_FEATURES = 18`, so it cannot
 * be fitted on the 24-feature basis, and it may not be edited. This file is
 * that file with exactly TWO textual edits and nothing else — no
 * hyper-parameter, no split rule, no loss, no histogram logic differs:
 *
 *   1. `export const N_FEATURES = 18;`  ->  a settable module width
 *   2. `from "../../lib"`               ->  `from "../lib"`  (one dir shallower)
 *
 * Regenerate (and verify) with:
 *
 *   sed '1,19d' scripts/forecast/candidates/trees/gbdt.ts \
 *     | sed 's|"../../lib"|"../lib"|' \
 *     | sed 's|^export const N_FEATURES = 18;$|export let N_FEATURES = 18;...|'
 *
 * `--only=verify-gbdt-copy` re-applies exactly that at run time and throws on
 * any difference, so the copy cannot silently drift from the contender.
 */
import { mulberry32 } from "../lib";

export let N_FEATURES = 18;
export function setGbdtFeatureWidth(n: number): void {
  N_FEATURES = n;
}

export interface GbdtParams {
  maxDepth: number;
  learningRate: number;
  maxTrees: number;
  subsample: number;
  colsample: number;
  minChildCount: number;
  minChildHess: number;
  lambda: number;
  minSplitGain: number;
  posWeightPower: number;
  seed: number;
}

export interface Tree {
  /** feature index, −1 for a leaf */
  feature: Int32Array;
  /** bin index the split compares against (training space) */
  binThreshold: Int32Array;
  /** real-valued threshold: go left iff x ≤ threshold */
  threshold: Float64Array;
  left: Int32Array;
  right: Int32Array;
  /** leaf output, already multiplied by the learning rate */
  value: Float64Array;
  nodeCount: number;
  leafCount: number;
  depth: number;
}

export interface Booster {
  baseScore: number;
  trees: Tree[];
}

// ---------------------------------------------------------------------------
// Binning
// ---------------------------------------------------------------------------

/**
 * Quantile bin edges per feature, at most `maxBins − 1` of them (so bin ids
 * fit in a Uint8Array for maxBins ≤ 256). Duplicate quantiles collapse, which
 * is what happens on the many spike-at-zero features here.
 */
export function buildBinEdges(
  x: Float64Array,
  rows: Int32Array,
  maxBins: number,
  sampleCap: number,
): number[][] {
  const stride = Math.max(1, Math.ceil(rows.length / sampleCap));
  const sampled: number[] = [];
  for (let i = 0; i < rows.length; i += stride) {
    sampled.push(rows[i] as number);
  }
  const edges: number[][] = [];
  const buffer = new Float64Array(sampled.length);
  for (let f = 0; f < N_FEATURES; f += 1) {
    for (let i = 0; i < sampled.length; i += 1) {
      buffer[i] = x[(sampled[i] as number) * N_FEATURES + f] as number;
    }
    const sorted = Float64Array.from(buffer).sort();
    const wanted = maxBins - 1;
    const seen: number[] = [];
    for (let q = 1; q <= wanted; q += 1) {
      const index = Math.min(sorted.length - 1, Math.floor((q * sorted.length) / (wanted + 1)));
      const value = sorted[index] as number;
      // Candidate thresholds must be strictly increasing and must not equal the
      // maximum (a split at the max sends every row left).
      if (value >= (sorted[sorted.length - 1] as number)) {
        continue;
      }
      if (seen.length === 0 || value > (seen[seen.length - 1] as number)) {
        seen.push(value);
      }
    }
    edges.push(seen);
  }
  return edges;
}

/** bin(x) = #{edges strictly below x}; so bin(x) ≤ b ⇔ x ≤ edges[b]. */
export function binOf(value: number, edges: readonly number[]): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((edges[mid] as number) < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function binMatrix(x: Float64Array, rowCount: number, edges: number[][]): Uint8Array {
  const bins = new Uint8Array(rowCount * N_FEATURES);
  for (let f = 0; f < N_FEATURES; f += 1) {
    const featureEdges = edges[f] as number[];
    for (let i = 0; i < rowCount; i += 1) {
      bins[i * N_FEATURES + f] = binOf(x[i * N_FEATURES + f] as number, featureEdges);
    }
  }
  return bins;
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

export function predictTreeRaw(tree: Tree, x: readonly number[] | Float64Array, offset: number): number {
  let node = 0;
  while ((tree.feature[node] as number) >= 0) {
    const value = x[offset + (tree.feature[node] as number)] as number;
    node = value <= (tree.threshold[node] as number)
      ? (tree.left[node] as number)
      : (tree.right[node] as number);
  }
  return tree.value[node] as number;
}

function predictTreeBinned(tree: Tree, bins: Uint8Array, offset: number): number {
  let node = 0;
  while ((tree.feature[node] as number) >= 0) {
    const bin = bins[offset + (tree.feature[node] as number)] as number;
    node = bin <= (tree.binThreshold[node] as number)
      ? (tree.left[node] as number)
      : (tree.right[node] as number);
  }
  return tree.value[node] as number;
}

/** Ensemble margin (pre-calibration logit) on a raw encoded feature vector. */
export function boosterMargin(booster: Booster, x: readonly number[] | Float64Array, offset = 0): number {
  let score = booster.baseScore;
  for (const tree of booster.trees) {
    score += predictTreeRaw(tree, x, offset);
  }
  return score;
}

export function countNodes(booster: Booster): { nodes: number; leaves: number; internal: number } {
  let nodes = 0;
  let leaves = 0;
  for (const tree of booster.trees) {
    nodes += tree.nodeCount;
    leaves += tree.leafCount;
  }
  return { nodes, leaves, internal: nodes - leaves };
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

interface TreeBuilder {
  feature: number[];
  binThreshold: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[];
  depth: number;
  leaves: number;
}

export interface Monitor {
  /** called every `every` trees with the running val margins */
  every: number;
  patience: number;
  score: (margins: Float64Array) => number;
}

export interface TrainResult {
  booster: Booster;
  /** number of trees kept (best monitored iteration, or maxTrees) */
  bestTrees: number;
  bestScore: number;
  history: Array<{ trees: number; score: number }>;
  fitMargins: Float64Array;
  valMargins: Float64Array;
}

export function trainGbdt(args: {
  bins: Uint8Array;
  y: Uint8Array;
  fitRows: Int32Array;
  edges: number[][];
  maxBins: number;
  params: GbdtParams;
  valBins?: Uint8Array;
  valRowCount?: number;
  monitor?: Monitor;
}): TrainResult {
  const { bins, y, fitRows, edges, maxBins, params } = args;
  const n = fitRows.length;
  const B = maxBins;
  const histStride = N_FEATURES * B * 3; // [grad, hess, count] interleaved

  // Class weight: w_pos = (n_neg/n_pos)^power, the same tempering knob the
  // shipped trainer exposes.
  let positives = 0;
  for (let k = 0; k < n; k += 1) {
    positives += y[fitRows[k] as number] as number;
  }
  const negatives = n - positives;
  const wPos =
    positives > 0 && params.posWeightPower !== 0
      ? Math.pow(negatives / Math.max(1, positives), params.posWeightPower)
      : 1;

  const weight = new Float64Array(n);
  const label = new Float64Array(n);
  let weightedPos = 0;
  let weightTotal = 0;
  for (let k = 0; k < n; k += 1) {
    const yi = y[fitRows[k] as number] as number;
    label[k] = yi;
    weight[k] = yi === 1 ? wPos : 1;
    weightedPos += yi * (weight[k] as number);
    weightTotal += weight[k] as number;
  }
  const prior = Math.min(1 - 1e-6, Math.max(1e-6, weightedPos / Math.max(1e-9, weightTotal)));
  const baseScore = Math.log(prior / (1 - prior));

  const margins = new Float64Array(n).fill(baseScore);
  const grad = new Float64Array(n);
  const hess = new Float64Array(n);

  const valCount = args.valRowCount ?? 0;
  const valMargins = new Float64Array(valCount).fill(baseScore);

  const rand = mulberry32(params.seed);
  const trees: Tree[] = [];
  const history: Array<{ trees: number; score: number }> = [];
  let bestTrees = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let sinceBest = 0;

  // Reusable buffers.
  const indices = new Int32Array(n);
  const histPool: Float64Array[] = [];
  const allocHist = (): Float64Array => {
    const buffer = histPool.pop();
    if (buffer === undefined) {
      return new Float64Array(histStride);
    }
    buffer.fill(0);
    return buffer;
  };
  const releaseHist = (buffer: Float64Array): void => {
    histPool.push(buffer);
  };
  const featurePool = new Int32Array(N_FEATURES);

  for (let t = 0; t < params.maxTrees; t += 1) {
    // Gradients on all fit rows.
    for (let k = 0; k < n; k += 1) {
      const p = sigmoid(margins[k] as number);
      const w = weight[k] as number;
      grad[k] = w * (p - (label[k] as number));
      hess[k] = w * p * (1 - p);
    }

    // Row subsample (seeded, per tree).
    let count = 0;
    if (params.subsample >= 1) {
      for (let k = 0; k < n; k += 1) {
        indices[count] = k;
        count += 1;
      }
    } else {
      for (let k = 0; k < n; k += 1) {
        if (rand() < params.subsample) {
          indices[count] = k;
          count += 1;
        }
      }
    }
    if (count === 0) {
      continue;
    }

    // Column subsample (seeded, per tree).
    let featureCount = 0;
    if (params.colsample >= 1) {
      for (let f = 0; f < N_FEATURES; f += 1) {
        featurePool[featureCount] = f;
        featureCount += 1;
      }
    } else {
      for (let f = 0; f < N_FEATURES; f += 1) {
        if (rand() < params.colsample) {
          featurePool[featureCount] = f;
          featureCount += 1;
        }
      }
      if (featureCount === 0) {
        featurePool[0] = Math.min(N_FEATURES - 1, Math.floor(rand() * N_FEATURES));
        featureCount = 1;
      }
    }

    const builder: TreeBuilder = {
      feature: [],
      binThreshold: [],
      threshold: [],
      left: [],
      right: [],
      value: [],
      depth: 0,
      leaves: 0,
    };

    const scanHist = (target: Float64Array, start: number, end: number): void => {
      for (let k = start; k < end; k += 1) {
        const row = indices[k] as number;
        const offset = (fitRows[row] as number) * N_FEATURES;
        const g = grad[row] as number;
        const h = hess[row] as number;
        for (let f = 0; f < N_FEATURES; f += 1) {
          const slot = (f * B + (bins[offset + f] as number)) * 3;
          target[slot] = (target[slot] as number) + g;
          target[slot + 1] = (target[slot + 1] as number) + h;
          target[slot + 2] = (target[slot + 2] as number) + 1;
        }
      }
    };

    const addLeaf = (G: number, H: number, depth: number): number => {
      const index = builder.feature.length;
      builder.feature.push(-1);
      builder.binThreshold.push(-1);
      builder.threshold.push(0);
      builder.left.push(-1);
      builder.right.push(-1);
      builder.value.push((-G / (H + params.lambda)) * params.learningRate);
      builder.leaves += 1;
      builder.depth = Math.max(builder.depth, depth);
      return index;
    };

    /** Grows the subtree spanning indices[start,end); consumes `hist`. */
    const grow = (
      start: number,
      end: number,
      depth: number,
      hist: Float64Array,
      G: number,
      H: number,
    ): number => {
      const rows = end - start;
      if (
        depth >= params.maxDepth ||
        rows < 2 * params.minChildCount ||
        H < 2 * params.minChildHess
      ) {
        releaseHist(hist);
        return addLeaf(G, H, depth);
      }

      // Best split over the sampled features.
      const parentScore = (G * G) / (H + params.lambda);
      let bestGain = params.minSplitGain;
      let bestFeature = -1;
      let bestBin = -1;
      let bestGL = 0;
      let bestHL = 0;
      for (let fi = 0; fi < featureCount; fi += 1) {
        const f = featurePool[fi] as number;
        const featureEdges = edges[f] as number[];
        const usable = featureEdges.length; // bins 0..usable, split at b<usable
        let gl = 0;
        let hl = 0;
        let cl = 0;
        const base = f * B * 3;
        for (let b = 0; b < usable; b += 1) {
          const slot = base + b * 3;
          gl += hist[slot] as number;
          hl += hist[slot + 1] as number;
          cl += hist[slot + 2] as number;
          const cr = rows - cl;
          if (cl < params.minChildCount || cr < params.minChildCount) {
            continue;
          }
          const hr = H - hl;
          if (hl < params.minChildHess || hr < params.minChildHess) {
            continue;
          }
          const gr = G - gl;
          const gain =
            (gl * gl) / (hl + params.lambda) + (gr * gr) / (hr + params.lambda) - parentScore;
          if (gain > bestGain) {
            bestGain = gain;
            bestFeature = f;
            bestBin = b;
            bestGL = gl;
            bestHL = hl;
          }
        }
      }
      if (bestFeature < 0) {
        releaseHist(hist);
        return addLeaf(G, H, depth);
      }

      // Partition indices[start,end) in place: left = bin ≤ bestBin.
      let lo = start;
      let hi = end - 1;
      while (lo <= hi) {
        const row = indices[lo] as number;
        const bin = bins[(fitRows[row] as number) * N_FEATURES + bestFeature] as number;
        if (bin <= bestBin) {
          lo += 1;
        } else {
          indices[lo] = indices[hi] as number;
          indices[hi] = row;
          hi -= 1;
        }
      }
      const mid = lo;
      const leftRows = mid - start;
      const rightRows = end - mid;
      if (leftRows === 0 || rightRows === 0) {
        releaseHist(hist);
        return addLeaf(G, H, depth);
      }

      // Histogram subtraction: scan the smaller side, subtract from the parent.
      const leftSmaller = leftRows <= rightRows;
      const smallHist = allocHist();
      if (leftSmaller) {
        scanHist(smallHist, start, mid);
      } else {
        scanHist(smallHist, mid, end);
      }
      for (let i = 0; i < histStride; i += 1) {
        hist[i] = (hist[i] as number) - (smallHist[i] as number);
      }
      const leftHist = leftSmaller ? smallHist : hist;
      const rightHist = leftSmaller ? hist : smallHist;

      const node = builder.feature.length;
      builder.feature.push(bestFeature);
      builder.binThreshold.push(bestBin);
      builder.threshold.push((edges[bestFeature] as number[])[bestBin] as number);
      builder.left.push(-1);
      builder.right.push(-1);
      builder.value.push(0);
      builder.depth = Math.max(builder.depth, depth);

      const leftIndex = grow(start, mid, depth + 1, leftHist, bestGL, bestHL);
      const rightIndex = grow(mid, end, depth + 1, rightHist, G - bestGL, H - bestHL);
      builder.left[node] = leftIndex;
      builder.right[node] = rightIndex;
      return node;
    };

    const rootHist = allocHist();
    scanHist(rootHist, 0, count);
    let rootG = 0;
    let rootH = 0;
    for (let k = 0; k < count; k += 1) {
      const row = indices[k] as number;
      rootG += grad[row] as number;
      rootH += hess[row] as number;
    }
    grow(0, count, 0, rootHist, rootG, rootH);

    const tree: Tree = {
      feature: Int32Array.from(builder.feature),
      binThreshold: Int32Array.from(builder.binThreshold),
      threshold: Float64Array.from(builder.threshold),
      left: Int32Array.from(builder.left),
      right: Int32Array.from(builder.right),
      value: Float64Array.from(builder.value),
      nodeCount: builder.feature.length,
      leafCount: builder.leaves,
      depth: builder.depth,
    };
    trees.push(tree);

    // Update margins (all fit rows, sampled or not) and the val margins.
    for (let k = 0; k < n; k += 1) {
      margins[k] =
        (margins[k] as number) + predictTreeBinned(tree, bins, (fitRows[k] as number) * N_FEATURES);
    }
    if (args.valBins !== undefined && valCount > 0) {
      for (let k = 0; k < valCount; k += 1) {
        valMargins[k] =
          (valMargins[k] as number) + predictTreeBinned(tree, args.valBins, k * N_FEATURES);
      }
    }

    const monitor = args.monitor;
    if (monitor !== undefined && ((t + 1) % monitor.every === 0 || t + 1 === params.maxTrees)) {
      const score = monitor.score(valMargins);
      history.push({ trees: t + 1, score });
      if (score > bestScore + 1e-9) {
        bestScore = score;
        bestTrees = t + 1;
        sinceBest = 0;
      } else {
        sinceBest += 1;
        if (sinceBest >= monitor.patience) {
          break;
        }
      }
    }
  }

  if (args.monitor === undefined || bestTrees === 0) {
    bestTrees = trees.length;
  }
  const booster: Booster = { baseScore, trees: trees.slice(0, bestTrees) };

  // Recompute the kept-model margins so callers get margins for exactly the
  // trees they keep (early stopping may have grown past the best iteration).
  const keptFit = new Float64Array(n).fill(baseScore);
  for (const tree of booster.trees) {
    for (let k = 0; k < n; k += 1) {
      keptFit[k] =
        (keptFit[k] as number) + predictTreeBinned(tree, bins, (fitRows[k] as number) * N_FEATURES);
    }
  }
  const keptVal = new Float64Array(valCount).fill(baseScore);
  if (args.valBins !== undefined && valCount > 0) {
    for (const tree of booster.trees) {
      for (let k = 0; k < valCount; k += 1) {
        keptVal[k] = (keptVal[k] as number) + predictTreeBinned(tree, args.valBins, k * N_FEATURES);
      }
    }
  }

  return {
    booster,
    bestTrees,
    bestScore,
    history,
    fitMargins: keptFit,
    valMargins: keptVal,
  };
}

export function serializeBooster(booster: Booster, calibration: unknown): unknown {
  return {
    baseScore: booster.baseScore,
    calibration,
    trees: booster.trees.map((tree) => ({
      feature: Array.from(tree.feature),
      threshold: Array.from(tree.threshold).map((v) => Number(v.toPrecision(8))),
      left: Array.from(tree.left),
      right: Array.from(tree.right),
      value: Array.from(tree.value).map((v) => Number(v.toPrecision(8))),
    })),
  };
}
