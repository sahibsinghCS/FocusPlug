import { mulberry32 } from "../../lib";

/**
 * The "hybrid" model family: ONE additive model that is a wide linear GLM and
 * a small tanh network at the same time.
 *
 *   z(x) = b0 + w·x  +  v·tanh(W1·x + b1)
 *
 * The linear trunk is the thing that currently beats the shipped MLP (a full
 * 18-feature logistic scores lead≥20s 0.9325 vs the MLP's 0.9248), and the
 * hidden block is a small, L2-leashed NONLINEAR RESIDUAL on top of it rather
 * than a replacement for it. Two consequences that matter here:
 *
 *  - the family strictly contains the logistic baseline (set v = 0), so it
 *    cannot lose to it the way a pure MLP can;
 *  - attribution stays honest: the linear part contributes exactly w_i·x_i,
 *    and the residual is one extra occlusion pass — the UI story survives.
 *
 * Everything is hand-rolled float64 + Adam, deterministic under a seed, with
 * a finite-difference gradient check over the real forward/backward code
 * (including the focal-loss path) that runs before any training.
 */

export interface HybridNet {
  inDim: number;
  hidden: number;
  /** Linear trunk weights (inDim) + bias. */
  w0: Float64Array;
  b0: number;
  /** Residual block: hidden×inDim, hidden, hidden. */
  W1: Float64Array;
  b1: Float64Array;
  v: Float64Array;
}

export interface HybridHyper {
  hidden: number;
  epochs: number;
  batch: number;
  lr: number;
  /** L2 on the residual block (the trunk gets l2Linear). */
  l2: number;
  l2Linear: number;
  /** w_pos = (n_neg/n_pos)^posWeightPower. */
  posWeightPower: number;
  /** Focal-loss exponent; 0 ⇒ plain weighted BCE. */
  gamma: number;
  patience: number;
  seed: number;
}

export function paramCount(net: HybridNet): number {
  return net.w0.length + 1 + net.W1.length + net.b1.length + net.v.length;
}

export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

export function logit(p: number): number {
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
  return Math.log(q / (1 - q));
}

export function initHybrid(inDim: number, hidden: number, rand: () => number): HybridNet {
  const W1 = new Float64Array(hidden * inDim);
  const scale1 = Math.sqrt(1 / inDim);
  for (let i = 0; i < W1.length; i += 1) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    W1[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale1;
  }
  const v = new Float64Array(hidden);
  const scale2 = Math.sqrt(1 / hidden);
  for (let i = 0; i < v.length; i += 1) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    // Start the residual small so the trunk leads and the block corrects.
    v[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale2 * 0.25;
  }
  return {
    inDim,
    hidden,
    w0: new Float64Array(inDim),
    b0: 0,
    W1,
    b1: new Float64Array(hidden),
    v,
  };
}

/** Forward pass over `x[offset .. offset+inDim)`; fills `h` with tanh acts. */
export function forwardHybrid(
  net: HybridNet,
  x: ArrayLike<number>,
  offset: number,
  h: Float64Array,
): number {
  let z = net.b0;
  for (let i = 0; i < net.inDim; i += 1) {
    z += (net.w0[i] as number) * (x[offset + i] as number);
  }
  for (let j = 0; j < net.hidden; j += 1) {
    let sum = net.b1[j] as number;
    const row = j * net.inDim;
    for (let i = 0; i < net.inDim; i += 1) {
      sum += (net.W1[row + i] as number) * (x[offset + i] as number);
    }
    const a = Math.tanh(sum);
    h[j] = a;
    z += (net.v[j] as number) * a;
  }
  return z;
}

interface Grads {
  w0: Float64Array;
  b0: number;
  W1: Float64Array;
  b1: Float64Array;
  v: Float64Array;
}

function zeroGrads(net: HybridNet): Grads {
  return {
    w0: new Float64Array(net.w0.length),
    b0: 0,
    W1: new Float64Array(net.W1.length),
    b1: new Float64Array(net.b1.length),
    v: new Float64Array(net.v.length),
  };
}

/**
 * Focal / weighted-BCE loss at one sample.
 * `pt` = probability of the TRUE class; L = -weight · (1-pt)^γ · log pt.
 * γ = 0 collapses to weighted BCE exactly.
 */
export function focalLoss(z: number, y: number, weight: number, gamma: number): number {
  const p = sigmoid(z);
  const pt = Math.min(1 - 1e-12, Math.max(1e-12, y === 1 ? p : 1 - p));
  return -weight * Math.pow(1 - pt, gamma) * Math.log(pt);
}

/** dL/dz for `focalLoss`. */
export function focalGrad(z: number, y: number, weight: number, gamma: number): number {
  const p = sigmoid(z);
  const pt = Math.min(1 - 1e-12, Math.max(1e-12, y === 1 ? p : 1 - p));
  // d/dzt of -(1-pt)^γ log pt, with zt = z for y=1 and -z for y=0.
  const dzt = Math.pow(1 - pt, gamma) * (gamma * pt * Math.log(pt) - (1 - pt));
  return weight * (y === 1 ? dzt : -dzt);
}

function backwardHybrid(
  net: HybridNet,
  x: ArrayLike<number>,
  offset: number,
  h: Float64Array,
  dz: number,
  grads: Grads,
): void {
  grads.b0 += dz;
  for (let i = 0; i < net.inDim; i += 1) {
    grads.w0[i] = (grads.w0[i] as number) + dz * (x[offset + i] as number);
  }
  for (let j = 0; j < net.hidden; j += 1) {
    const a = h[j] as number;
    grads.v[j] = (grads.v[j] as number) + dz * a;
    const dPre = dz * (net.v[j] as number) * (1 - a * a);
    grads.b1[j] = (grads.b1[j] as number) + dPre;
    const row = j * net.inDim;
    for (let i = 0; i < net.inDim; i += 1) {
      grads.W1[row + i] = (grads.W1[row + i] as number) + dPre * (x[offset + i] as number);
    }
  }
}

/**
 * Finite-difference gradient check over the REAL forward/backward code
 * (focal path included). Throws on failure; returns the worst relative error.
 */
export function gradientCheck(gamma: number): number {
  const rand = mulberry32(20260912);
  const inDim = 5;
  const hidden = 4;
  const net = initHybrid(inDim, hidden, rand);
  for (let i = 0; i < net.w0.length; i += 1) {
    net.w0[i] = 0.3 - 0.15 * i;
  }
  net.b0 = -0.4;
  const x = new Float64Array([0.4, -0.9, 1.3, 0.2, -0.5]);
  const h = new Float64Array(hidden);
  const y = 1;
  const weight = 2.3;

  const grads = zeroGrads(net);
  const z = forwardHybrid(net, x, 0, h);
  backwardHybrid(net, x, 0, h, focalGrad(z, y, weight, gamma), grads);

  const slots: Array<{ get: () => number; set: (v: number) => void; grad: number }> = [];
  const bind = (theta: Float64Array, grad: Float64Array): void => {
    for (let i = 0; i < theta.length; i += 1) {
      slots.push({
        get: () => theta[i] as number,
        set: (value) => {
          theta[i] = value;
        },
        grad: grad[i] as number,
      });
    }
  };
  bind(net.w0, grads.w0);
  bind(net.W1, grads.W1);
  bind(net.b1, grads.b1);
  bind(net.v, grads.v);
  slots.push({
    get: () => net.b0,
    set: (value) => {
      net.b0 = value;
    },
    grad: grads.b0,
  });

  const eps = 1e-6;
  let worst = 0;
  for (const slot of slots) {
    const kept = slot.get();
    slot.set(kept + eps);
    const up = focalLoss(forwardHybrid(net, x, 0, h), y, weight, gamma);
    slot.set(kept - eps);
    const down = focalLoss(forwardHybrid(net, x, 0, h), y, weight, gamma);
    slot.set(kept);
    const numeric = (up - down) / (2 * eps);
    const rel =
      Math.abs(numeric - slot.grad) / Math.max(1e-8, Math.abs(numeric) + Math.abs(slot.grad));
    worst = Math.max(worst, rel);
  }
  if (worst > 1e-5) {
    throw new Error(`hybrid gradient check FAILED (γ=${gamma}): worst rel err ${worst}`);
  }
  return worst;
}

export interface TrainResult {
  net: HybridNet;
  bestEpoch: number;
  bestScore: number;
  epochsRan: number;
  posWeight: number;
  history: Array<{ epoch: number; score: number }>;
}

/**
 * Adam + minibatch training with a caller-supplied validation score
 * (maximized, evaluated every epoch on the caller's own train-internal rows).
 * `x` is already normalized; `fit` / rows are index lists into it.
 */
export function trainHybrid(
  x: Float64Array,
  y: Uint8Array,
  inDim: number,
  fit: readonly number[],
  hyper: HybridHyper,
  score: (net: HybridNet) => number,
): TrainResult {
  const rand = mulberry32(hyper.seed);
  const net = initHybrid(inDim, hyper.hidden, rand);
  const grads = zeroGrads(net);
  const m = zeroGrads(net);
  const v2 = zeroGrads(net);
  const h = new Float64Array(hyper.hidden);

  let positives = 0;
  for (const i of fit) {
    positives += y[i] as number;
  }
  const posWeight =
    positives > 0 ? Math.pow((fit.length - positives) / positives, hyper.posWeightPower) : 1;

  const beta1 = 0.9;
  const beta2 = 0.999;
  const adamEps = 1e-8;
  let step = 0;

  const snapshot = (): HybridNet => ({
    inDim: net.inDim,
    hidden: net.hidden,
    w0: Float64Array.from(net.w0),
    b0: net.b0,
    W1: Float64Array.from(net.W1),
    b1: Float64Array.from(net.b1),
    v: Float64Array.from(net.v),
  });

  const order = Array.from(fit);
  let best = { net: snapshot(), score: Number.NEGATIVE_INFINITY, epoch: -1 };
  let sinceBest = 0;
  let epochsRan = 0;
  const history: Array<{ epoch: number; score: number }> = [];

  for (let epoch = 0; epoch < hyper.epochs; epoch += 1) {
    epochsRan = epoch + 1;
    // Fisher-Yates on the seeded PRNG (same generator the shipped trainer uses).
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = order[i] as number;
      order[i] = order[j] as number;
      order[j] = tmp;
    }
    for (let start = 0; start < order.length; start += hyper.batch) {
      const end = Math.min(order.length, start + hyper.batch);
      grads.w0.fill(0);
      grads.b0 = 0;
      grads.W1.fill(0);
      grads.b1.fill(0);
      grads.v.fill(0);
      let batchWeight = 0;
      for (let k = start; k < end; k += 1) {
        const i = order[k] as number;
        const label = y[i] as number;
        const weight = label === 1 ? posWeight : 1;
        batchWeight += weight;
        const z = forwardHybrid(net, x, i * inDim, h);
        backwardHybrid(net, x, i * inDim, h, focalGrad(z, label, weight, hyper.gamma), grads);
      }
      if (batchWeight <= 0) {
        continue;
      }
      step += 1;
      const lr = hyper.lr * (Math.sqrt(1 - beta2 ** step) / (1 - beta1 ** step));
      const update = (
        theta: Float64Array,
        grad: Float64Array,
        mt: Float64Array,
        vt: Float64Array,
        l2: number,
      ): void => {
        for (let i = 0; i < theta.length; i += 1) {
          const g = (grad[i] as number) / batchWeight + l2 * (theta[i] as number);
          mt[i] = beta1 * (mt[i] as number) + (1 - beta1) * g;
          vt[i] = beta2 * (vt[i] as number) + (1 - beta2) * g * g;
          theta[i] =
            (theta[i] as number) - (lr * (mt[i] as number)) / (Math.sqrt(vt[i] as number) + adamEps);
        }
      };
      update(net.w0, grads.w0, m.w0, v2.w0, hyper.l2Linear);
      update(net.W1, grads.W1, m.W1, v2.W1, hyper.l2);
      update(net.b1, grads.b1, m.b1, v2.b1, 0);
      update(net.v, grads.v, m.v, v2.v, hyper.l2);
      {
        const g = grads.b0 / batchWeight;
        m.b0 = beta1 * m.b0 + (1 - beta1) * g;
        v2.b0 = beta2 * v2.b0 + (1 - beta2) * g * g;
        net.b0 -= (lr * m.b0) / (Math.sqrt(v2.b0) + adamEps);
      }
    }

    const value = score(net);
    history.push({ epoch, score: value });
    if (value > best.score + 1e-6) {
      best = { net: snapshot(), score: value, epoch };
      sinceBest = 0;
    } else {
      sinceBest += 1;
      if (sinceBest >= hyper.patience) {
        break;
      }
    }
  }

  return {
    net: best.net,
    bestEpoch: best.epoch,
    bestScore: best.score,
    epochsRan,
    posWeight,
    history,
  };
}

/** Importance-weighted Platt scaling (Newton), identical in spirit to train.ts. */
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
      const p = sigmoid(a * z + b);
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
