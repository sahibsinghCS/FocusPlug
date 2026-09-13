/**
 * Hand-rolled 1-D temporal convolutional network (forward + backward + Adam),
 * float64, zero dependencies — the same style as `scripts/forecast/train.ts`
 * so the shipped inference stays pure-TS portable for the browser demo.
 *
 * Shape contract:
 *
 *   input   x : Float64Array laid out [second][channel], row-major, so a
 *               window of `seqLen` seconds ending at t is a CONTIGUOUS slice
 *               of the per-session channel buffer (zero-copy gather);
 *   convs   : stack of strided ReLU convolutions over time;
 *   pooling : mean ⊕ max ⊕ last activation of the top conv layer (recency
 *             survives the pool, which matters for a 30 s horizon);
 *   extras  : optional scalars concatenated after pooling (session-scale
 *             context the sequence window structurally cannot contain);
 *   head    : dense → tanh → linear logit.
 *
 * Backward skips the input-gradient of layer 0 (nothing below it needs one),
 * which is ~1/3 of the whole backward cost.
 */

export interface ConvSpec {
  kernel: number;
  stride: number;
  out: number;
}

export interface TemporalArch {
  seqLen: number;
  inChannels: number;
  convs: ConvSpec[];
  /** Scalars concatenated to the pooled vector before the dense head. */
  extras: number;
  hidden: number;
}

export function convPositions(arch: TemporalArch): number[] {
  const positions: number[] = [];
  let length = arch.seqLen;
  for (const spec of arch.convs) {
    if (length < spec.kernel) {
      throw new Error(`conv kernel ${spec.kernel} exceeds input length ${length}`);
    }
    length = Math.floor((length - spec.kernel) / spec.stride) + 1;
    positions.push(length);
  }
  return positions;
}

export interface TemporalGrads {
  W: Float64Array[];
  b: Float64Array[];
  Wh: Float64Array;
  bh: Float64Array;
  Wo: Float64Array;
  bo: Float64Array;
}

function gaussianFrom(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export class TemporalNet {
  readonly arch: TemporalArch;
  readonly positions: number[];
  /** Head input width: 3·F_top (mean ⊕ max ⊕ last) + extras. */
  readonly headDim: number;

  readonly W: Float64Array[] = [];
  readonly b: Float64Array[] = [];
  readonly Wh: Float64Array;
  readonly bh: Float64Array;
  readonly Wo: Float64Array;
  readonly bo: Float64Array;

  // Scratch (single-sample; the trainer is sequential by design).
  private readonly act: Float64Array[] = [];
  private readonly dAct: Float64Array[] = [];
  private readonly pooled: Float64Array;
  private readonly dPooled: Float64Array;
  private readonly hid: Float64Array;
  private readonly maxIdx: Int32Array;

  constructor(arch: TemporalArch, rand: () => number) {
    this.arch = arch;
    this.positions = convPositions(arch);
    let inC = arch.inChannels;
    for (let l = 0; l < arch.convs.length; l += 1) {
      const spec = arch.convs[l] as ConvSpec;
      const fanIn = spec.kernel * inC;
      const scale = Math.sqrt(2 / fanIn); // He init for ReLU
      const w = new Float64Array(spec.out * fanIn);
      for (let i = 0; i < w.length; i += 1) {
        w[i] = gaussianFrom(rand) * scale;
      }
      this.W.push(w);
      // Small positive bias so no unit starts dead.
      this.b.push(new Float64Array(spec.out).fill(0.01));
      this.act.push(new Float64Array((this.positions[l] as number) * spec.out));
      this.dAct.push(new Float64Array((this.positions[l] as number) * spec.out));
      inC = spec.out;
    }
    const topOut = (arch.convs[arch.convs.length - 1] as ConvSpec).out;
    this.headDim = 3 * topOut + arch.extras;
    this.pooled = new Float64Array(this.headDim);
    this.dPooled = new Float64Array(this.headDim);
    this.hid = new Float64Array(arch.hidden);
    this.maxIdx = new Int32Array(topOut);

    this.Wh = new Float64Array(arch.hidden * this.headDim);
    const hScale = Math.sqrt(1 / this.headDim);
    for (let i = 0; i < this.Wh.length; i += 1) {
      this.Wh[i] = gaussianFrom(rand) * hScale;
    }
    this.bh = new Float64Array(arch.hidden);
    this.Wo = new Float64Array(arch.hidden);
    const oScale = Math.sqrt(1 / arch.hidden);
    for (let i = 0; i < this.Wo.length; i += 1) {
      this.Wo[i] = gaussianFrom(rand) * oScale;
    }
    this.bo = new Float64Array(1);
  }

  paramArrays(): Float64Array[] {
    return [...this.W, ...this.b, this.Wh, this.bh, this.Wo, this.bo];
  }

  paramCount(): number {
    return this.paramArrays().reduce((sum, a) => sum + a.length, 0);
  }

  newGrads(): TemporalGrads {
    return {
      W: this.W.map((w) => new Float64Array(w.length)),
      b: this.b.map((v) => new Float64Array(v.length)),
      Wh: new Float64Array(this.Wh.length),
      bh: new Float64Array(this.bh.length),
      Wo: new Float64Array(this.Wo.length),
      bo: new Float64Array(1),
    };
  }

  gradArrays(g: TemporalGrads): Float64Array[] {
    return [...g.W, ...g.b, g.Wh, g.bh, g.Wo, g.bo];
  }

  zeroGrads(g: TemporalGrads): void {
    for (const a of this.gradArrays(g)) {
      a.fill(0);
    }
  }

  /** Returns the pre-calibration logit; leaves activations in scratch for `backward`. */
  forward(x: Float64Array, xOff: number, ex: Float64Array | null, exOff: number): number {
    const arch = this.arch;
    let src = x;
    let srcOff = xOff;
    let srcC = arch.inChannels;
    for (let l = 0; l < arch.convs.length; l += 1) {
      const spec = arch.convs[l] as ConvSpec;
      const positions = this.positions[l] as number;
      const w = this.W[l] as Float64Array;
      const bias = this.b[l] as Float64Array;
      const dst = this.act[l] as Float64Array;
      const kC = spec.kernel * srcC;
      const step = spec.stride * srcC;
      for (let p = 0; p < positions; p += 1) {
        const base = srcOff + p * step;
        const dOff = p * spec.out;
        for (let f = 0; f < spec.out; f += 1) {
          let sum = bias[f] as number;
          const wOff = f * kC;
          for (let u = 0; u < kC; u += 1) {
            sum += (w[wOff + u] as number) * (src[base + u] as number);
          }
          dst[dOff + f] = sum > 0 ? sum : 0;
        }
      }
      src = dst;
      srcOff = 0;
      srcC = spec.out;
    }

    const top = this.act[arch.convs.length - 1] as Float64Array;
    const topOut = srcC;
    const positions = this.positions[arch.convs.length - 1] as number;
    for (let f = 0; f < topOut; f += 1) {
      let sum = 0;
      let best = -Infinity;
      let bestAt = 0;
      for (let p = 0; p < positions; p += 1) {
        const v = top[p * topOut + f] as number;
        sum += v;
        if (v > best) {
          best = v;
          bestAt = p;
        }
      }
      this.pooled[f] = sum / positions;
      this.pooled[topOut + f] = best;
      this.pooled[2 * topOut + f] = top[(positions - 1) * topOut + f] as number;
      this.maxIdx[f] = bestAt;
    }
    for (let i = 0; i < arch.extras; i += 1) {
      this.pooled[3 * topOut + i] = ex === null ? 0 : (ex[exOff + i] as number);
    }

    const dim = this.headDim;
    for (let h = 0; h < arch.hidden; h += 1) {
      let sum = this.bh[h] as number;
      const wOff = h * dim;
      for (let k = 0; k < dim; k += 1) {
        sum += (this.Wh[wOff + k] as number) * (this.pooled[k] as number);
      }
      this.hid[h] = Math.tanh(sum);
    }
    let logit = this.bo[0] as number;
    for (let h = 0; h < arch.hidden; h += 1) {
      logit += (this.Wo[h] as number) * (this.hid[h] as number);
    }
    return logit;
  }

  /** Accumulates dL/dθ into `g` for a scalar dL/dlogit. Must follow `forward` on the same sample. */
  backward(dLogit: number, x: Float64Array, xOff: number, g: TemporalGrads): void {
    const arch = this.arch;
    const dim = this.headDim;
    const topOut = (arch.convs[arch.convs.length - 1] as ConvSpec).out;

    g.bo[0] = (g.bo[0] as number) + dLogit;
    this.dPooled.fill(0);
    for (let h = 0; h < arch.hidden; h += 1) {
      const hv = this.hid[h] as number;
      g.Wo[h] = (g.Wo[h] as number) + dLogit * hv;
      const dHid = dLogit * (this.Wo[h] as number) * (1 - hv * hv);
      if (dHid === 0) {
        continue;
      }
      g.bh[h] = (g.bh[h] as number) + dHid;
      const wOff = h * dim;
      for (let k = 0; k < dim; k += 1) {
        g.Wh[wOff + k] = (g.Wh[wOff + k] as number) + dHid * (this.pooled[k] as number);
        this.dPooled[k] = (this.dPooled[k] as number) + dHid * (this.Wh[wOff + k] as number);
      }
    }

    const topLayer = arch.convs.length - 1;
    const topPositions = this.positions[topLayer] as number;
    const dTop = this.dAct[topLayer] as Float64Array;
    for (let f = 0; f < topOut; f += 1) {
      const dMean = (this.dPooled[f] as number) / topPositions;
      for (let p = 0; p < topPositions; p += 1) {
        dTop[p * topOut + f] = dMean;
      }
      const at = this.maxIdx[f] as number;
      dTop[at * topOut + f] = (dTop[at * topOut + f] as number) + (this.dPooled[topOut + f] as number);
      const lastAt = (topPositions - 1) * topOut + f;
      dTop[lastAt] = (dTop[lastAt] as number) + (this.dPooled[2 * topOut + f] as number);
    }

    for (let l = topLayer; l >= 0; l -= 1) {
      const spec = arch.convs[l] as ConvSpec;
      const positions = this.positions[l] as number;
      const srcC = l === 0 ? arch.inChannels : (arch.convs[l - 1] as ConvSpec).out;
      const src = l === 0 ? x : (this.act[l - 1] as Float64Array);
      const srcOff = l === 0 ? xOff : 0;
      const dSrc = l === 0 ? null : (this.dAct[l - 1] as Float64Array);
      if (dSrc !== null) {
        dSrc.fill(0);
      }
      const w = this.W[l] as Float64Array;
      const gW = g.W[l] as Float64Array;
      const gb = g.b[l] as Float64Array;
      const act = this.act[l] as Float64Array;
      const dAct = this.dAct[l] as Float64Array;
      const kC = spec.kernel * srcC;
      const step = spec.stride * srcC;
      for (let p = 0; p < positions; p += 1) {
        const base = srcOff + p * step;
        const dBase = base - srcOff;
        const oOff = p * spec.out;
        for (let f = 0; f < spec.out; f += 1) {
          if ((act[oOff + f] as number) <= 0) {
            continue; // ReLU gate
          }
          const d = dAct[oOff + f] as number;
          if (d === 0) {
            continue;
          }
          gb[f] = (gb[f] as number) + d;
          const wOff = f * kC;
          if (dSrc === null) {
            for (let u = 0; u < kC; u += 1) {
              gW[wOff + u] = (gW[wOff + u] as number) + d * (src[base + u] as number);
            }
          } else {
            for (let u = 0; u < kC; u += 1) {
              gW[wOff + u] = (gW[wOff + u] as number) + d * (src[base + u] as number);
              dSrc[dBase + u] = (dSrc[dBase + u] as number) + d * (w[wOff + u] as number);
            }
          }
        }
      }
    }
  }

  snapshot(): Float64Array[] {
    return this.paramArrays().map((a) => Float64Array.from(a));
  }

  restore(snapshot: readonly Float64Array[]): void {
    const params = this.paramArrays();
    for (let i = 0; i < params.length; i += 1) {
      (params[i] as Float64Array).set(snapshot[i] as Float64Array);
    }
  }
}

// ---------------------------------------------------------------------------
// Adam
// ---------------------------------------------------------------------------

export class Adam {
  private readonly m: Float64Array[];
  private readonly v: Float64Array[];
  private step = 0;
  constructor(
    params: readonly Float64Array[],
    private readonly lr: number,
    private readonly l2: number,
    private readonly beta1 = 0.9,
    private readonly beta2 = 0.999,
    private readonly eps = 1e-8,
  ) {
    this.m = params.map((p) => new Float64Array(p.length));
    this.v = params.map((p) => new Float64Array(p.length));
  }

  update(params: readonly Float64Array[], grads: readonly Float64Array[], scale: number, lrScale = 1): void {
    this.step += 1;
    const lr =
      this.lr *
      lrScale *
      (Math.sqrt(1 - this.beta2 ** this.step) / (1 - this.beta1 ** this.step));
    for (let i = 0; i < params.length; i += 1) {
      const theta = params[i] as Float64Array;
      const grad = grads[i] as Float64Array;
      const m = this.m[i] as Float64Array;
      const v = this.v[i] as Float64Array;
      for (let j = 0; j < theta.length; j += 1) {
        const g = (grad[j] as number) * scale + this.l2 * (theta[j] as number);
        m[j] = this.beta1 * (m[j] as number) + (1 - this.beta1) * g;
        v[j] = this.beta2 * (v[j] as number) + (1 - this.beta2) * g * g;
        theta[j] =
          (theta[j] as number) - (lr * (m[j] as number)) / (Math.sqrt(v[j] as number) + this.eps);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Finite-difference gradient check (runs before every training run)
// ---------------------------------------------------------------------------

function sigmoidStable(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

export function bceLoss(logit: number, y: number, weight: number): number {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, sigmoidStable(logit)));
  return -weight * (y * Math.log(p) + (1 - y) * Math.log(1 - p));
}

export function bceGrad(logit: number, y: number, weight: number): number {
  return weight * (sigmoidStable(logit) - y);
}

/**
 * Analytic vs central-difference gradients on a toy net that exercises the
 * EXACT forward/backward code paths (strided conv stack, mean/max/last pool,
 * extras, tanh head). Throws unless the worst relative error < 1e-5.
 */
export function gradientCheck(rand: () => number): number {
  const arch: TemporalArch = {
    seqLen: 13,
    inChannels: 3,
    convs: [
      { kernel: 3, stride: 2, out: 3 },
      { kernel: 2, stride: 1, out: 2 },
    ],
    extras: 2,
    hidden: 3,
  };
  const net = new TemporalNet(arch, rand);
  const x = new Float64Array(arch.seqLen * arch.inChannels);
  for (let i = 0; i < x.length; i += 1) {
    x[i] = gaussianFrom(rand);
  }
  const ex = Float64Array.from([0.4, -0.9]);
  const y = 1;
  const weight = 1.3;

  const grads = net.newGrads();
  net.zeroGrads(grads);
  const logit = net.forward(x, 0, ex, 0);
  net.backward(bceGrad(logit, y, weight), x, 0, grads);

  const params = net.paramArrays();
  const gradArrays = net.gradArrays(grads);
  const eps = 1e-6;
  let worst = 0;
  for (let a = 0; a < params.length; a += 1) {
    const theta = params[a] as Float64Array;
    const grad = gradArrays[a] as Float64Array;
    for (let i = 0; i < theta.length; i += 1) {
      const kept = theta[i] as number;
      theta[i] = kept + eps;
      const up = bceLoss(net.forward(x, 0, ex, 0), y, weight);
      theta[i] = kept - eps;
      const down = bceLoss(net.forward(x, 0, ex, 0), y, weight);
      theta[i] = kept;
      const numeric = (up - down) / (2 * eps);
      const analytic = grad[i] as number;
      const rel =
        Math.abs(numeric - analytic) / Math.max(1e-8, Math.abs(numeric) + Math.abs(analytic));
      worst = Math.max(worst, rel);
    }
  }
  if (worst > 1e-5) {
    throw new Error(`temporal gradient check FAILED: worst relative error ${worst.toExponential(3)}`);
  }
  return worst;
}
