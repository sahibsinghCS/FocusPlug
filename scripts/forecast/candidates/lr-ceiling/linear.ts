/**
 * lr-ceiling — linear-family toolkit.
 *
 * A deterministic, dependency-free implementation of L2-regularized weighted
 * logistic regression fitted with L-BFGS, plus the basis expansions the
 * contender needs (pairwise products, quantile hinge splines) and an
 * importance-weighted Platt calibrator.
 *
 * Nothing here touches shared repo code — it is owned entirely by the
 * lr-ceiling candidate.
 */

// ---------------------------------------------------------------------------
// Basis expansion
// ---------------------------------------------------------------------------

export type Term =
  | { t: "lin"; i: number }
  /** x_i * x_j (i === j ⇒ square). */
  | { t: "prod"; i: number; j: number }
  /** max(0, x_i - knot) — piecewise-linear spline basis. */
  | { t: "hinge"; i: number; knot: number };

export function termName(term: Term, keys: readonly string[]): string {
  if (term.t === "lin") {
    return keys[term.i] as string;
  }
  if (term.t === "prod") {
    return term.i === term.j
      ? `${keys[term.i]}^2`
      : `${keys[term.i]}*${keys[term.j]}`;
  }
  return `h(${keys[term.i]}>${term.knot.toFixed(4)})`;
}

/** Terms compiled into flat typed arrays so expansion is a tight loop. */
export interface CompiledSpec {
  name: string;
  baseDim: number;
  dim: number;
  terms: Term[];
  linCol: Int32Array;
  linI: Int32Array;
  prodCol: Int32Array;
  prodI: Int32Array;
  prodJ: Int32Array;
  hingeCol: Int32Array;
  hingeI: Int32Array;
  hingeK: Float64Array;
}

export function compileSpec(name: string, baseDim: number, terms: Term[]): CompiledSpec {
  const linCol: number[] = [];
  const linI: number[] = [];
  const prodCol: number[] = [];
  const prodI: number[] = [];
  const prodJ: number[] = [];
  const hingeCol: number[] = [];
  const hingeI: number[] = [];
  const hingeK: number[] = [];
  terms.forEach((term, col) => {
    if (term.t === "lin") {
      linCol.push(col);
      linI.push(term.i);
    } else if (term.t === "prod") {
      prodCol.push(col);
      prodI.push(term.i);
      prodJ.push(term.j);
    } else {
      hingeCol.push(col);
      hingeI.push(term.i);
      hingeK.push(term.knot);
    }
  });
  return {
    name,
    baseDim,
    dim: terms.length,
    terms,
    linCol: Int32Array.from(linCol),
    linI: Int32Array.from(linI),
    prodCol: Int32Array.from(prodCol),
    prodI: Int32Array.from(prodI),
    prodJ: Int32Array.from(prodJ),
    hingeCol: Int32Array.from(hingeCol),
    hingeI: Int32Array.from(hingeI),
    hingeK: Float64Array.from(hingeK),
  };
}

/** Expands one base row into `out[0..dim)`. */
export function expandRow(spec: CompiledSpec, x: readonly number[], out: Float64Array): void {
  for (let k = 0; k < spec.linCol.length; k += 1) {
    out[spec.linCol[k] as number] = x[spec.linI[k] as number] ?? 0;
  }
  for (let k = 0; k < spec.prodCol.length; k += 1) {
    out[spec.prodCol[k] as number] =
      (x[spec.prodI[k] as number] ?? 0) * (x[spec.prodJ[k] as number] ?? 0);
  }
  for (let k = 0; k < spec.hingeCol.length; k += 1) {
    const v = (x[spec.hingeI[k] as number] ?? 0) - (spec.hingeK[k] as number);
    out[spec.hingeCol[k] as number] = v > 0 ? v : 0;
  }
}

/** Expands an n × baseDim matrix into an n × dim Float32 design matrix. */
export function buildDesign(base: Float32Array, nRows: number, spec: CompiledSpec): Float32Array {
  const d = spec.dim;
  const out = new Float32Array(nRows * d);
  const x = new Array<number>(spec.baseDim).fill(0);
  const row = new Float64Array(d);
  for (let r = 0; r < nRows; r += 1) {
    const off = r * spec.baseDim;
    for (let i = 0; i < spec.baseDim; i += 1) {
      x[i] = base[off + i] as number;
    }
    expandRow(spec, x, row);
    const o = r * d;
    for (let j = 0; j < d; j += 1) {
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
export function fitStandardizer(
  X: Float32Array,
  d: number,
  idx: Int32Array,
): Standardizer {
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

export function applyStandardizer(X: Float32Array, d: number, s: Standardizer): void {
  const n = X.length / d;
  for (let r = 0; r < n; r += 1) {
    const off = r * d;
    for (let j = 0; j < d; j += 1) {
      X[off + j] = ((X[off + j] as number) - (s.mean[j] as number)) / (s.std[j] as number);
    }
  }
}

// ---------------------------------------------------------------------------
// L-BFGS
// ---------------------------------------------------------------------------

/**
 * Limited-memory BFGS with Armijo backtracking. Deterministic: no randomness,
 * fixed history size, fixed tolerances.
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

export interface LinearModel {
  /** length d, on the STANDARDIZED design. */
  w: Float64Array;
  b: number;
  standardizer: Standardizer;
  spec: CompiledSpec;
  /** Platt (a, b) fit on the train-internal validation split. */
  calibration: { a: number; b: number };
}

export function sigmoidStable(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/** Fits θ (w ‖ b) minimizing mean weighted BCE + (λ/2)‖w‖² (bias unpenalized). */
export function fitLogisticL2(
  X: Float32Array,
  d: number,
  idx: Int32Array,
  y: Uint8Array,
  sampleWeight: Float64Array,
  lambda: number,
  maxIters: number,
  init?: Float64Array,
): { theta: Float64Array; loss: number; iters: number } {
  let totalW = 0;
  for (let k = 0; k < idx.length; k += 1) {
    totalW += sampleWeight[idx[k] as number] as number;
  }
  totalW = Math.max(1e-12, totalW);

  const fg = (theta: Float64Array, grad: Float64Array): number => {
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

  const theta = new Float64Array(d + 1);
  if (init !== undefined) {
    theta.set(init.subarray(0, d + 1));
  }
  const result = lbfgs(d + 1, fg, theta, maxIters);
  return { theta, loss: result.f, iters: result.iters };
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
// Platt calibration (importance-weighted Newton) — same shape as train.ts
// ---------------------------------------------------------------------------

export function fitPlatt(
  logits: readonly number[],
  labels: readonly number[],
  weights: readonly number[],
): { a: number; b: number } {
  let a = 1;
  let b = 0;
  for (let iter = 0; iter < 100; iter += 1) {
    let ga = 0;
    let gb = 0;
    let haa = 1e-9;
    let hab = 0;
    let hbb = 1e-9;
    for (let i = 0; i < logits.length; i += 1) {
      const z = logits[i] as number;
      const w = weights[i] as number;
      const p = sigmoidStable(a * z + b);
      const err = w * (p - (labels[i] as number));
      ga += err * z;
      gb += err;
      const curv = w * p * (1 - p);
      haa += curv * z * z;
      hab += curv * z;
      hbb += curv;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) {
      break;
    }
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) < 1e-10 && Math.abs(db) < 1e-10) {
      break;
    }
  }
  return { a, b };
}

/** Empirical quantiles of a column over the fit subset (deterministic sort). */
export function columnQuantiles(
  base: Float32Array,
  baseDim: number,
  idx: Int32Array,
  feature: number,
  qs: readonly number[],
): number[] {
  const values = new Float64Array(idx.length);
  for (let k = 0; k < idx.length; k += 1) {
    values[k] = base[(idx[k] as number) * baseDim + feature] as number;
  }
  values.sort();
  return qs.map((q) => {
    const pos = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * q)));
    return values[pos] as number;
  });
}
