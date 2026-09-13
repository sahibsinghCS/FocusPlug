/**
 * Linear-family toolkit for the Focus Forecast pipeline: deterministic,
 * dependency-free, L2-regularized weighted logistic regression fitted with
 * L-BFGS, an importance-weighted Platt calibrator, and the standardizer
 * fold-in that turns a fitted (θ, standardizer) pair into the flat
 * `coefficients`/`intercept` the shipped `weights.json` carries.
 *
 * The BASIS is deliberately NOT defined here — `expandBasis` /
 * `pairwiseTerms` live in `scripts/forecast/pairwise.ts`, so every script that
 * fits a GLM over the same columns reads one definition of them. This file
 * owns only the optimizer.
 *
 * Promoted from `scripts/forecast/candidates/lr-ceiling/linear.ts` (the
 * bake-off winner) into the real pipeline; the candidate copy stays untouched
 * as the bake-off record.
 */

import { expandBasis } from "./pairwise";

export function sigmoidStable(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

// ---------------------------------------------------------------------------
// Design matrices
// ---------------------------------------------------------------------------

/**
 * Expands an `nRows × 18` encoded matrix into the `nRows × 189` canonical
 * basis design, using the SHARED `expandBasis`. Float32 to keep 133 k × 189
 * inside ~100 MB; the optimizer accumulates in float64.
 */
export function buildBasisDesign(base: Float32Array, nRows: number, baseDim: number, dim: number): Float32Array {
  const out = new Float32Array(nRows * dim);
  const x = new Array<number>(baseDim).fill(0);
  const row = new Float64Array(dim);
  for (let r = 0; r < nRows; r += 1) {
    const off = r * baseDim;
    for (let i = 0; i < baseDim; i += 1) {
      x[i] = base[off + i] as number;
    }
    expandBasis(x, row);
    const o = r * dim;
    for (let j = 0; j < dim; j += 1) {
      out[o + j] = row[j] as number;
    }
  }
  return out;
}

export interface Standardizer {
  mean: Float64Array;
  std: Float64Array;
}

/** Column mean/std over `idx` rows only (the fit subset — never val, never eval). */
export function fitStandardizer(X: Float32Array, d: number, idx: Int32Array): Standardizer {
  const mean = new Float64Array(d);
  const std = new Float64Array(d);
  const n = idx.length;
  for (let k = 0; k < n; k += 1) {
    const off = (idx[k] as number) * d;
    for (let j = 0; j < d; j += 1) {
      mean[j] = (mean[j] as number) + (X[off + j] as number);
    }
  }
  for (let j = 0; j < d; j += 1) {
    mean[j] = (mean[j] as number) / Math.max(1, n);
  }
  for (let k = 0; k < n; k += 1) {
    const off = (idx[k] as number) * d;
    for (let j = 0; j < d; j += 1) {
      const diff = (X[off + j] as number) - (mean[j] as number);
      std[j] = (std[j] as number) + diff * diff;
    }
  }
  for (let j = 0; j < d; j += 1) {
    const s = Math.sqrt((std[j] as number) / Math.max(1, n));
    std[j] = s > 1e-9 ? s : 1;
  }
  return { mean, std };
}

/** In-place standardization of the whole matrix. */
export function applyStandardizer(X: Float32Array, d: number, s: Standardizer): void {
  const n = X.length / d;
  for (let r = 0; r < n; r += 1) {
    const off = r * d;
    for (let j = 0; j < d; j += 1) {
      X[off + j] = ((X[off + j] as number) - (s.mean[j] as number)) / (s.std[j] as number);
    }
  }
}

/**
 * Folds the standardizer into the coefficients so the shipped artifact is a
 * flat dot product on raw basis values:
 *
 *   z = b + Σ θ_j·(t_j − m_j)/s_j  ≡  [b − Σ θ_j·m_j/s_j] + Σ (θ_j/s_j)·t_j
 */
export function foldStandardizer(
  theta: Float64Array,
  d: number,
  s: Standardizer,
): { coefficients: number[]; intercept: number } {
  const coefficients = new Array<number>(d);
  let intercept = theta[d] as number;
  for (let j = 0; j < d; j += 1) {
    const scaled = (theta[j] as number) / (s.std[j] as number);
    coefficients[j] = scaled;
    intercept -= scaled * (s.mean[j] as number);
  }
  return { coefficients, intercept };
}

// ---------------------------------------------------------------------------
// L-BFGS
// ---------------------------------------------------------------------------

/**
 * Limited-memory BFGS with Armijo backtracking. Deterministic: no randomness,
 * fixed history size, fixed tolerances — same seed, same data, same θ.
 */
export function lbfgs(
  n: number,
  fg: (x: Float64Array, g: Float64Array) => number,
  x: Float64Array,
  maxIters: number,
  memory = 10,
): { f: number; iters: number; gradNorm: number } {
  const g = new Float64Array(n);
  let f = fg(x, g);
  const S: Float64Array[] = [];
  const Y: Float64Array[] = [];
  const rho: number[] = [];
  const q = new Float64Array(n);
  const dir = new Float64Array(n);
  const xNew = new Float64Array(n);
  const gNew = new Float64Array(n);
  let iters = 0;
  let gradNorm = 0;

  for (let it = 0; it < maxIters; it += 1) {
    iters = it + 1;
    gradNorm = 0;
    for (let i = 0; i < n; i += 1) {
      gradNorm += (g[i] as number) * (g[i] as number);
    }
    gradNorm = Math.sqrt(gradNorm);
    if (gradNorm < 1e-9) {
      break;
    }

    q.set(g);
    const k = S.length;
    const alpha = new Float64Array(k);
    for (let j = k - 1; j >= 0; j -= 1) {
      const Sj = S[j] as Float64Array;
      let sq = 0;
      for (let i = 0; i < n; i += 1) {
        sq += (Sj[i] as number) * (q[i] as number);
      }
      const a = (rho[j] as number) * sq;
      alpha[j] = a;
      const Yj = Y[j] as Float64Array;
      for (let i = 0; i < n; i += 1) {
        q[i] = (q[i] as number) - a * (Yj[i] as number);
      }
    }
    let gamma: number;
    if (k > 0) {
      const Sl = S[k - 1] as Float64Array;
      const Yl = Y[k - 1] as Float64Array;
      let sy = 0;
      let yy = 0;
      for (let i = 0; i < n; i += 1) {
        sy += (Sl[i] as number) * (Yl[i] as number);
        yy += (Yl[i] as number) * (Yl[i] as number);
      }
      gamma = yy > 0 ? sy / yy : 1;
    } else {
      gamma = 1 / Math.max(1, gradNorm);
    }
    for (let i = 0; i < n; i += 1) {
      q[i] = (q[i] as number) * gamma;
    }
    for (let j = 0; j < k; j += 1) {
      const Yj = Y[j] as Float64Array;
      let yq = 0;
      for (let i = 0; i < n; i += 1) {
        yq += (Yj[i] as number) * (q[i] as number);
      }
      const beta = (rho[j] as number) * yq;
      const Sj = S[j] as Float64Array;
      const coef = (alpha[j] as number) - beta;
      for (let i = 0; i < n; i += 1) {
        q[i] = (q[i] as number) + coef * (Sj[i] as number);
      }
    }
    let dg = 0;
    for (let i = 0; i < n; i += 1) {
      dir[i] = -(q[i] as number);
      dg += (dir[i] as number) * (g[i] as number);
    }
    if (!(dg < 0)) {
      dg = 0;
      for (let i = 0; i < n; i += 1) {
        dir[i] = -(g[i] as number);
        dg -= (g[i] as number) * (g[i] as number);
      }
    }

    let step = 1;
    let ok = false;
    let fNew = f;
    for (let ls = 0; ls < 40; ls += 1) {
      for (let i = 0; i < n; i += 1) {
        xNew[i] = (x[i] as number) + step * (dir[i] as number);
      }
      fNew = fg(xNew, gNew);
      if (Number.isFinite(fNew) && fNew <= f + 1e-4 * step * dg) {
        ok = true;
        break;
      }
      step *= 0.5;
    }
    if (!ok) {
      break;
    }

    const s = new Float64Array(n);
    const yv = new Float64Array(n);
    let sy = 0;
    for (let i = 0; i < n; i += 1) {
      s[i] = (xNew[i] as number) - (x[i] as number);
      yv[i] = (gNew[i] as number) - (g[i] as number);
      sy += (s[i] as number) * (yv[i] as number);
    }
    if (sy > 1e-12) {
      S.push(s);
      Y.push(yv);
      rho.push(1 / sy);
      if (S.length > memory) {
        S.shift();
        Y.shift();
        rho.shift();
      }
    }
    const improvement = f - fNew;
    x.set(xNew);
    g.set(gNew);
    f = fNew;
    if (improvement <= 1e-11 * Math.max(1, Math.abs(f))) {
      break;
    }
  }
  return { f, iters, gradNorm };
}

// ---------------------------------------------------------------------------
// Weighted L2 logistic regression
// ---------------------------------------------------------------------------

/**
 * The objective L-BFGS minimizes: mean weighted BCE over `idx` plus
 * (λ/2)‖w‖² with the bias unpenalized. Returns the value and fills `grad`.
 *
 * Exported so `train.ts`'s finite-difference gradient check exercises THIS
 * closure — the one the shipped fit actually uses — instead of a toy copy.
 */
export function logisticObjective(
  X: Float32Array,
  d: number,
  idx: Int32Array,
  y: Uint8Array,
  sampleWeight: Float64Array,
  lambda: number,
): (theta: Float64Array, grad: Float64Array) => number {
  let totalW = 0;
  for (let k = 0; k < idx.length; k += 1) {
    totalW += sampleWeight[idx[k] as number] as number;
  }
  totalW = Math.max(1e-12, totalW);

  return (theta: Float64Array, grad: Float64Array): number => {
    grad.fill(0);
    let loss = 0;
    const bias = theta[d] as number;
    for (let k = 0; k < idx.length; k += 1) {
      const row = idx[k] as number;
      const off = row * d;
      let z = bias;
      for (let j = 0; j < d; j += 1) {
        z += (theta[j] as number) * (X[off + j] as number);
      }
      const yi = y[row] as number;
      const wi = sampleWeight[row] as number;
      loss +=
        wi *
        (z >= 0 ? (1 - yi) * z + Math.log1p(Math.exp(-z)) : -yi * z + Math.log1p(Math.exp(z)));
      const dz = wi * (sigmoidStable(z) - yi);
      for (let j = 0; j < d; j += 1) {
        grad[j] = (grad[j] as number) + dz * (X[off + j] as number);
      }
      grad[d] = (grad[d] as number) + dz;
    }
    loss /= totalW;
    for (let j = 0; j <= d; j += 1) {
      grad[j] = (grad[j] as number) / totalW;
    }
    for (let j = 0; j < d; j += 1) {
      const wj = theta[j] as number;
      loss += 0.5 * lambda * wj * wj;
      grad[j] = (grad[j] as number) + lambda * wj;
    }
    return loss;
  };
}

/**
 * Fits θ = (w ‖ b) minimizing mean weighted BCE + (λ/2)‖w‖² (bias
 * unpenalized) over the rows named by `idx`. Convex — the returned θ is the
 * global optimum, so "did you tune it enough?" is not a question that can be
 * asked of it.
 */
export function fitLogisticL2(
  X: Float32Array,
  d: number,
  idx: Int32Array,
  y: Uint8Array,
  sampleWeight: Float64Array,
  lambda: number,
  maxIters: number,
  init?: Float64Array,
): { theta: Float64Array; loss: number; iters: number; gradNorm: number } {
  const fg = logisticObjective(X, d, idx, y, sampleWeight, lambda);
  const theta = new Float64Array(d + 1);
  if (init !== undefined) {
    theta.set(init.subarray(0, d + 1));
  }
  const result = lbfgs(d + 1, fg, theta, maxIters);
  return { theta, loss: result.f, iters: result.iters, gradNorm: result.gradNorm };
}

/** Raw (pre-calibration) logit for one standardized design row. */
export function rowLogit(X: Float32Array, d: number, row: number, theta: Float64Array): number {
  const off = row * d;
  let z = theta[d] as number;
  for (let j = 0; j < d; j += 1) {
    z += (theta[j] as number) * (X[off + j] as number);
  }
  return z;
}

// ---------------------------------------------------------------------------
// Platt calibration (importance-weighted Newton)
// ---------------------------------------------------------------------------

/**
 * Fits σ(a·z + b) on validation logits. Importance weights
 * (1/keep-probability) make the calibration target NATURAL prevalence rather
 * than the builder's downsampled file — the reason "0.83" can mean 83 %.
 *
 * Robust Newton per Lin, Weng & Keerthi (2007), because the plain Newton
 * iteration is not safe here: on a calibration slice the fitted logit can
 * nearly separate, the curvature p(1−p) underflows, and one overshooting step
 * pins (a, b) at ~1e7 — a step-function "calibrator" that silently wrecks
 * every threshold downstream. Two standard guards prevent that:
 *
 * 1. SMOOTHED TARGETS — positives are fitted to (N₊+1)/(N₊+2) and negatives to
 *    1/(N₋+2) rather than to 1 and 0, so the optimum is finite even when the
 *    slice is separable. With thousands of effective counts this moves a
 *    well-conditioned fit only in its ~1/N digits.
 * 2. BACKTRACKING LINE SEARCH on the actual objective — a Newton step is only
 *    taken if it decreases the loss, so a bad step costs an iteration instead
 *    of the fit.
 */
export function fitPlatt(
  logits: readonly number[],
  labels: readonly number[],
  weights: readonly number[],
): { a: number; b: number } {
  let prior1 = 0;
  let prior0 = 0;
  for (let i = 0; i < logits.length; i += 1) {
    const w = weights[i] as number;
    if ((labels[i] as number) === 1) {
      prior1 += w;
    } else {
      prior0 += w;
    }
  }
  const hiTarget = (prior1 + 1) / (prior1 + 2);
  const loTarget = 1 / (prior0 + 2);
  const target = (i: number): number => ((labels[i] as number) === 1 ? hiTarget : loTarget);

  /** Weighted cross-entropy against the smoothed targets, log-sum-exp stable. */
  const objective = (a: number, b: number): number => {
    let total = 0;
    for (let i = 0; i < logits.length; i += 1) {
      const u = a * (logits[i] as number) + b;
      const t = target(i);
      total +=
        (weights[i] as number) *
        (u >= 0 ? Math.log1p(Math.exp(-u)) + (1 - t) * u : Math.log1p(Math.exp(u)) - t * u);
    }
    return total;
  };

  let a = 1;
  let b = 0;
  let f = objective(a, b);
  for (let iter = 0; iter < 100; iter += 1) {
    let ga = 0;
    let gb = 0;
    let haa = 1e-12;
    let hab = 0;
    let hbb = 1e-12;
    for (let i = 0; i < logits.length; i += 1) {
      const z = logits[i] as number;
      const w = weights[i] as number;
      const p = sigmoidStable(a * z + b);
      const err = w * (p - target(i));
      ga += err * z;
      gb += err;
      const curv = w * p * (1 - p);
      haa += curv * z * z;
      hab += curv * z;
      hbb += curv;
    }
    if (Math.abs(ga) < 1e-10 && Math.abs(gb) < 1e-10) {
      break;
    }
    const det = haa * hbb - hab * hab;
    // Newton when the Hessian is usable, gradient descent when it is not.
    let da: number;
    let db: number;
    if (Math.abs(det) > 1e-14) {
      da = (hbb * ga - hab * gb) / det;
      db = (haa * gb - hab * ga) / det;
    } else {
      da = ga;
      db = gb;
    }
    let step = 1;
    let moved = false;
    for (let ls = 0; ls < 40; ls += 1) {
      const aNext = a - step * da;
      const bNext = b - step * db;
      const fNext = objective(aNext, bNext);
      if (Number.isFinite(fNext) && fNext <= f) {
        moved = Math.abs(step * da) > 1e-12 || Math.abs(step * db) > 1e-12;
        a = aNext;
        b = bNext;
        f = fNext;
        break;
      }
      step *= 0.5;
    }
    if (!moved) {
      break;
    }
  }
  return { a, b };
}
