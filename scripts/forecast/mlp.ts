import { mulberry32, shuffled } from "./lib";

/**
 * MLP toolkit for the Focus Forecast pipeline: hand-rolled forward/backward,
 * Adam, an LR schedule, dropout and a finite-difference gradient check — all
 * deterministic and dependency-free.
 *
 * PROMOTED VERBATIM from `scripts/forecast/candidates/mlp-tuned/net.ts` (the
 * round-10 winner) into the real pipeline, exactly as `linear.ts` was promoted
 * from `candidates/lr-ceiling/linear.ts` after round 8. The candidate copy
 * stays untouched as the bake-off record; this one is what `train.ts` fits.
 *
 * The gradient check runs against THIS code path before any training run, so a
 * green check is evidence about the shipped optimizer rather than about a toy
 * copy of it.
 */

export type Activation = "tanh" | "relu" | "gelu";

export interface NetSpec {
  /** [inDim, hid1, (hid2)] — output layer is always 1 unit, linear logit. */
  dims: number[];
  activation: Activation;
}

export interface Net {
  dims: number[];
  activation: Activation;
  /** tanh 0 · relu 1 · gelu 2 — an integer so the inner loop never compares strings. */
  actCode: 0 | 1 | 2;
  /** Weight matrices, layer l: dims[l+1] × dims[l] (last layer 1 × dims[last]). */
  w: Float64Array[];
  b: Float64Array[];
}

export function paramCount(dims: number[]): number {
  const sizes = [...dims, 1];
  let total = 0;
  for (let l = 0; l + 1 < sizes.length; l += 1) {
    total += (sizes[l] as number) * (sizes[l + 1] as number) + (sizes[l + 1] as number);
  }
  return total;
}

/** Multiply-accumulate count of ONE forward pass (the on-device 1 Hz cost). */
export function forwardMacs(dims: number[]): number {
  const sizes = [...dims, 1];
  let total = 0;
  for (let l = 0; l + 1 < sizes.length; l += 1) {
    total += (sizes[l] as number) * (sizes[l + 1] as number);
  }
  return total;
}

function gaussianFrom(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function initNet(spec: NetSpec, rand: () => number): Net {
  const sizes = [...spec.dims, 1];
  const w: Float64Array[] = [];
  const b: Float64Array[] = [];
  for (let l = 0; l + 1 < sizes.length; l += 1) {
    const fanIn = sizes[l] as number;
    const fanOut = sizes[l + 1] as number;
    // He for relu/gelu, Xavier(1/fanIn) for tanh — matches the shipped init
    // for the tanh 18→12→1 case.
    const scale = spec.activation === "tanh" ? Math.sqrt(1 / fanIn) : Math.sqrt(2 / fanIn);
    const mat = new Float64Array(fanOut * fanIn);
    for (let i = 0; i < mat.length; i += 1) {
      mat[i] = gaussianFrom(rand) * scale;
    }
    w.push(mat);
    b.push(new Float64Array(fanOut));
  }
  return { dims: [...spec.dims], activation: spec.activation, actCode: actCodeOf(spec.activation), w, b };
}

export function actCodeOf(activation: Activation): 0 | 1 | 2 {
  return activation === "tanh" ? 0 : activation === "relu" ? 1 : 2;
}

export function cloneNet(net: Net): Net {
  return {
    dims: [...net.dims],
    activation: net.activation,
    actCode: net.actCode,
    w: net.w.map((m) => Float64Array.from(m)),
    b: net.b.map((v) => Float64Array.from(v)),
  };
}

function act(code: number, z: number): number {
  if (code === 0) {
    return Math.tanh(z);
  }
  if (code === 1) {
    return z > 0 ? z : 0;
  }
  // tanh-approximation GELU (cheap, smooth, standard).
  const c = 0.7978845608028654; // sqrt(2/pi)
  return 0.5 * z * (1 + Math.tanh(c * (z + 0.044715 * z * z * z)));
}

function actGrad(code: number, z: number, a: number): number {
  if (code === 0) {
    return 1 - a * a;
  }
  if (code === 1) {
    return z > 0 ? 1 : 0;
  }
  const c = 0.7978845608028654;
  const inner = c * (z + 0.044715 * z * z * z);
  const t = Math.tanh(inner);
  const dInner = c * (1 + 3 * 0.044715 * z * z);
  return 0.5 * (1 + t) + 0.5 * z * (1 - t * t) * dInner;
}

export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/** Scratch buffers so the hot loop allocates nothing. */
export interface Scratch {
  pre: Float64Array[];
  post: Float64Array[];
  mask: Float64Array[];
  delta: Float64Array[];
}

export function makeScratch(net: Net): Scratch {
  const hidden = net.dims.slice(1);
  return {
    pre: hidden.map((h) => new Float64Array(h)),
    post: hidden.map((h) => new Float64Array(h)),
    mask: hidden.map((h) => new Float64Array(h).fill(1)),
    delta: hidden.map((h) => new Float64Array(h)),
  };
}

/** Forward pass over x[offset .. offset+inDim). Fills scratch; returns the logit. */
export function forwardNet(net: Net, x: Float64Array, offset: number, s: Scratch, useMask: boolean): number {
  const layers = net.w.length;
  let inDim = net.dims[0] as number;
  let input: Float64Array = x;
  let inOffset = offset;
  for (let l = 0; l < layers - 1; l += 1) {
    const outDim = net.dims[l + 1] as number;
    const wm = net.w[l] as Float64Array;
    const bv = net.b[l] as Float64Array;
    const pre = s.pre[l] as Float64Array;
    const post = s.post[l] as Float64Array;
    const mask = s.mask[l] as Float64Array;
    for (let j = 0; j < outDim; j += 1) {
      let sum = bv[j] as number;
      const row = j * inDim;
      for (let i = 0; i < inDim; i += 1) {
        sum += (wm[row + i] as number) * (input[inOffset + i] as number);
      }
      pre[j] = sum;
      const a = act(net.actCode, sum);
      post[j] = useMask ? a * (mask[j] as number) : a;
    }
    input = post;
    inOffset = 0;
    inDim = outDim;
  }
  const wOut = net.w[layers - 1] as Float64Array;
  const bOut = net.b[layers - 1] as Float64Array;
  let logit = bOut[0] as number;
  for (let i = 0; i < inDim; i += 1) {
    logit += (wOut[i] as number) * (input[inOffset + i] as number);
  }
  return logit;
}

export interface Grads {
  w: Float64Array[];
  b: Float64Array[];
}

export function makeGrads(net: Net): Grads {
  return { w: net.w.map((m) => new Float64Array(m.length)), b: net.b.map((v) => new Float64Array(v.length)) };
}

export function zeroGrads(g: Grads): void {
  for (const m of g.w) {
    m.fill(0);
  }
  for (const v of g.b) {
    v.fill(0);
  }
}

/** Accumulates dL/dθ of weighted BCE at one sample. Mirrors forwardNet's masking. */
export function backwardNet(
  net: Net,
  x: Float64Array,
  offset: number,
  s: Scratch,
  logit: number,
  y: number,
  weight: number,
  g: Grads,
  useMask: boolean,
): void {
  const layers = net.w.length;
  const dz = weight * (sigmoid(logit) - y);
  const lastHidden = layers - 1;
  const outDim = net.dims[layers - 1] as number;
  const wOut = net.w[layers - 1] as Float64Array;
  const gOut = g.w[layers - 1] as Float64Array;
  (g.b[layers - 1] as Float64Array)[0] = ((g.b[layers - 1] as Float64Array)[0] as number) + dz;
  if (layers === 1) {
    for (let i = 0; i < outDim; i += 1) {
      gOut[i] = (gOut[i] as number) + dz * (x[offset + i] as number);
    }
    return;
  }
  const lastPost = s.post[lastHidden - 1] as Float64Array;
  const lastDelta = s.delta[lastHidden - 1] as Float64Array;
  const lastPre = s.pre[lastHidden - 1] as Float64Array;
  const lastMask = s.mask[lastHidden - 1] as Float64Array;
  for (let i = 0; i < outDim; i += 1) {
    gOut[i] = (gOut[i] as number) + dz * (lastPost[i] as number);
    const a = useMask ? (lastPost[i] as number) / Math.max(1e-12, lastMask[i] as number) : (lastPost[i] as number);
    const grad = actGrad(net.actCode, lastPre[i] as number, a) * (useMask ? (lastMask[i] as number) : 1);
    lastDelta[i] = dz * (wOut[i] as number) * grad;
  }
  for (let l = layers - 2; l >= 0; l -= 1) {
    const outD = net.dims[l + 1] as number;
    const inD = net.dims[l] as number;
    const delta = s.delta[l] as Float64Array;
    const gw = g.w[l] as Float64Array;
    const gb = g.b[l] as Float64Array;
    const input: Float64Array = l === 0 ? x : (s.post[l - 1] as Float64Array);
    const inOff = l === 0 ? offset : 0;
    for (let j = 0; j < outD; j += 1) {
      const d = delta[j] as number;
      gb[j] = (gb[j] as number) + d;
      const row = j * inD;
      for (let i = 0; i < inD; i += 1) {
        gw[row + i] = (gw[row + i] as number) + d * (input[inOff + i] as number);
      }
    }
    if (l > 0) {
      const prevDim = net.dims[l] as number;
      const prevDelta = s.delta[l - 1] as Float64Array;
      const prevPre = s.pre[l - 1] as Float64Array;
      const prevPost = s.post[l - 1] as Float64Array;
      const prevMask = s.mask[l - 1] as Float64Array;
      const wm = net.w[l] as Float64Array;
      for (let i = 0; i < prevDim; i += 1) {
        let sum = 0;
        for (let j = 0; j < outD; j += 1) {
          sum += (wm[j * prevDim + i] as number) * (delta[j] as number);
        }
        const a = useMask
          ? (prevPost[i] as number) / Math.max(1e-12, prevMask[i] as number)
          : (prevPost[i] as number);
        const grad = actGrad(net.actCode, prevPre[i] as number, a) * (useMask ? (prevMask[i] as number) : 1);
        prevDelta[i] = sum * grad;
      }
    }
  }
}

export function bceLoss(logit: number, y: number, weight: number): number {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(logit)));
  return -weight * (y * Math.log(p) + (1 - y) * Math.log(1 - p));
}

// ---------------------------------------------------------------------------
// Gradient check (finite differences vs analytic) on the exact same code
// ---------------------------------------------------------------------------

export function gradientCheck(): number {
  let worst = 0;
  for (const spec of [
    { dims: [4, 3], activation: "tanh" as Activation },
    { dims: [5, 4, 3], activation: "relu" as Activation },
    { dims: [5, 4, 3], activation: "gelu" as Activation },
  ]) {
    const rand = mulberry32(1234);
    const net = initNet(spec, rand);
    const inDim = spec.dims[0] as number;
    const x = new Float64Array(Array.from({ length: inDim }, (_, i) => Math.sin(i + 1) * 0.9));
    const s = makeScratch(net);
    const g = makeGrads(net);
    const y = 1;
    const weight = 1.7;
    const logit = forwardNet(net, x, 0, s, false);
    backwardNet(net, x, 0, s, logit, y, weight, g, false);
    const eps = 1e-6;
    const probe = (theta: Float64Array, index: number, grad: number): void => {
      const kept = theta[index] as number;
      theta[index] = kept + eps;
      const up = bceLoss(forwardNet(net, x, 0, s, false), y, weight);
      theta[index] = kept - eps;
      const down = bceLoss(forwardNet(net, x, 0, s, false), y, weight);
      theta[index] = kept;
      const numeric = (up - down) / (2 * eps);
      const rel = Math.abs(numeric - grad) / Math.max(1e-8, Math.abs(numeric) + Math.abs(grad));
      worst = Math.max(worst, rel);
    };
    for (let l = 0; l < net.w.length; l += 1) {
      const wm = net.w[l] as Float64Array;
      const gw = g.w[l] as Float64Array;
      for (let i = 0; i < wm.length; i += 1) {
        probe(wm, i, gw[i] as number);
      }
      const bv = net.b[l] as Float64Array;
      const gb = g.b[l] as Float64Array;
      for (let i = 0; i < bv.length; i += 1) {
        probe(bv, i, gb[i] as number);
      }
    }
  }
  if (worst > 1e-4) {
    throw new Error(`gradient check FAILED: worst relative error ${worst.toExponential(3)}`);
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export type Schedule = "const" | "cosine" | "step";

export interface TrainOptions {
  spec: NetSpec;
  lr: number;
  batch: number;
  l2: number;
  dropout: number;
  schedule: Schedule;
  warmupFrac: number;
  maxEpochs: number;
  patience: number;
  seed: number;
  /** Called after each epoch with the current net; return the value to MAXIMIZE. */
  score: (net: Net) => number;
  /** How often to evaluate `score` (epochs). */
  evalEvery: number;
}

export interface TrainInput {
  /** Normalized features, n × inDim, row-major. */
  x: Float64Array;
  y: Uint8Array;
  /** Per-sample loss weight (class weight × lead emphasis). */
  weight: Float64Array;
  /** Indices into x/y/weight that gradient steps may touch. */
  fitIndex: Int32Array;
}

export interface TrainResult {
  net: Net;
  bestEpoch: number;
  bestScore: number;
  epochsRan: number;
}

function lrAt(options: TrainOptions, epoch: number, totalEpochs: number): number {
  const warm = Math.max(1, Math.round(totalEpochs * options.warmupFrac));
  if (epoch < warm) {
    return options.lr * ((epoch + 1) / warm);
  }
  const progress = (epoch - warm) / Math.max(1, totalEpochs - warm);
  if (options.schedule === "cosine") {
    return options.lr * (0.5 * (1 + Math.cos(Math.PI * Math.min(1, progress))));
  }
  if (options.schedule === "step") {
    if (progress >= 0.75) {
      return options.lr * 0.1;
    }
    if (progress >= 0.5) {
      return options.lr * 0.3;
    }
    return options.lr;
  }
  return options.lr;
}

export function trainNet(input: TrainInput, options: TrainOptions): TrainResult {
  const rand = mulberry32(options.seed);
  const net = initNet(options.spec, rand);
  const scratch = makeScratch(net);
  const grads = makeGrads(net);
  const adamM = makeGrads(net);
  const adamV = makeGrads(net);
  const inDim = options.spec.dims[0] as number;
  const beta1 = 0.9;
  const beta2 = 0.999;
  const adamEps = 1e-8;
  let step = 0;

  let best: TrainResult = {
    net: cloneNet(net),
    bestEpoch: -1,
    bestScore: Number.NEGATIVE_INFINITY,
    epochsRan: 0,
  };
  let sinceBest = 0;
  const order = Array.from(input.fitIndex);

  for (let epoch = 0; epoch < options.maxEpochs; epoch += 1) {
    const epochLr = lrAt(options, epoch, options.maxEpochs);
    const shuffledOrder = shuffled(order, rand);
    for (let start = 0; start < shuffledOrder.length; start += options.batch) {
      const end = Math.min(shuffledOrder.length, start + options.batch);
      zeroGrads(grads);
      let batchWeight = 0;
      // One dropout mask per BATCH (cheap, and a perfectly standard variant).
      if (options.dropout > 0) {
        for (const mask of scratch.mask) {
          const keep = 1 - options.dropout;
          for (let j = 0; j < mask.length; j += 1) {
            mask[j] = rand() < keep ? 1 / keep : 0;
          }
        }
      }
      for (let k = start; k < end; k += 1) {
        const i = shuffledOrder[k] as number;
        const weight = input.weight[i] as number;
        if (weight <= 0) {
          continue;
        }
        batchWeight += weight;
        const logit = forwardNet(net, input.x, i * inDim, scratch, options.dropout > 0);
        backwardNet(
          net,
          input.x,
          i * inDim,
          scratch,
          logit,
          input.y[i] as number,
          weight,
          grads,
          options.dropout > 0,
        );
      }
      if (batchWeight <= 0) {
        continue;
      }
      step += 1;
      const bias = Math.sqrt(1 - beta2 ** step) / (1 - beta1 ** step);
      const lr = epochLr * bias;
      for (let l = 0; l < net.w.length; l += 1) {
        applyAdam(net.w[l] as Float64Array, grads.w[l] as Float64Array, adamM.w[l] as Float64Array, adamV.w[l] as Float64Array, batchWeight, lr, options.l2, beta1, beta2, adamEps);
        applyAdam(net.b[l] as Float64Array, grads.b[l] as Float64Array, adamM.b[l] as Float64Array, adamV.b[l] as Float64Array, batchWeight, lr, 0, beta1, beta2, adamEps);
      }
    }
    best.epochsRan = epoch + 1;
    const due = (epoch + 1) % options.evalEvery === 0 || epoch === options.maxEpochs - 1;
    if (!due) {
      continue;
    }
    const value = options.score(net);
    if (value > best.bestScore + 1e-7) {
      best = { net: cloneNet(net), bestEpoch: epoch, bestScore: value, epochsRan: epoch + 1 };
      sinceBest = 0;
    } else {
      sinceBest += options.evalEvery;
    }
    if (sinceBest >= options.patience) {
      break;
    }
  }
  return best;
}

function applyAdam(
  theta: Float64Array,
  grad: Float64Array,
  m: Float64Array,
  v: Float64Array,
  batchWeight: number,
  lr: number,
  l2: number,
  beta1: number,
  beta2: number,
  eps: number,
): void {
  for (let i = 0; i < theta.length; i += 1) {
    const g = (grad[i] as number) / batchWeight + l2 * (theta[i] as number);
    m[i] = beta1 * (m[i] as number) + (1 - beta1) * g;
    v[i] = beta2 * (v[i] as number) + (1 - beta2) * g * g;
    theta[i] = (theta[i] as number) - (lr * (m[i] as number)) / (Math.sqrt(v[i] as number) + eps);
  }
}

/** Batch scoring helper — logits for every row of a normalized matrix. */
export function logitsFor(net: Net, x: Float64Array, indices: Int32Array, inDim: number): Float64Array {
  const scratch = makeScratch(net);
  const out = new Float64Array(indices.length);
  for (let k = 0; k < indices.length; k += 1) {
    out[k] = forwardNet(net, x, (indices[k] as number) * inDim, scratch, false);
  }
  return out;
}
