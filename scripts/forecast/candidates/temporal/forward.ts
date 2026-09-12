/**
 * PORTABLE inference for the temporal contender — pure TypeScript, no
 * dependencies, no typed-array requirement in the public signature, so the
 * browser demo can ship it exactly as-is (this is the file that would move
 * next to `src/shared/forecast/model.ts` if this contender won).
 *
 * `parseTemporalWeights` is fail-closed in the same spirit as
 * `parseForecastWeights`: any shape/dimension/finiteness violation returns
 * null and the caller stays `ready:false` rather than inventing a risk.
 */

export interface TemporalConvLayerJson {
  kernel: number;
  stride: number;
  out: number;
  W: number[];
  b: number[];
}

export interface TemporalWeightsFile {
  version: string;
  variant: string;
  seqLen: number;
  channelKeys: string[];
  extraKeys: string[];
  /** Index of each extra inside FORECAST_FEATURE_KEYS (so a caller holding the
   *  18-vector can slice the extras without knowing the variant). */
  extraFeatureIndex: number[];
  norm: { mean: number[]; scale: number[] };
  extraNorm: { mean: number[]; scale: number[] };
  convs: TemporalConvLayerJson[];
  head: { W: number[]; b: number[] };
  out: { W: number[]; b: number };
  calibration: { a: number; b: number };
  horizonSec: number;
  thresholds: { nudge: number; prearm: number; clear: number };
  paramCount: number;
}

export const TEMPORAL_MODEL_VERSION = "ff-temporal-1";

function finiteArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

export function parseTemporalWeights(value: unknown): TemporalWeightsFile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== TEMPORAL_MODEL_VERSION) {
    return null;
  }
  const seqLen = raw.seqLen;
  const channelKeys = raw.channelKeys;
  const extraKeys = raw.extraKeys;
  if (
    typeof seqLen !== "number" ||
    !Number.isInteger(seqLen) ||
    seqLen <= 0 ||
    !Array.isArray(channelKeys) ||
    channelKeys.length === 0 ||
    !Array.isArray(extraKeys)
  ) {
    return null;
  }
  const channels = channelKeys.length;
  const norm = raw.norm as { mean?: unknown; scale?: unknown } | undefined;
  const extraNorm = raw.extraNorm as { mean?: unknown; scale?: unknown } | undefined;
  if (
    !norm ||
    !finiteArray(norm.mean, channels) ||
    !finiteArray(norm.scale, channels) ||
    !norm.scale.every((s) => s > 0) ||
    !extraNorm ||
    !finiteArray(extraNorm.mean, extraKeys.length) ||
    !finiteArray(extraNorm.scale, extraKeys.length) ||
    !extraNorm.scale.every((s) => s > 0)
  ) {
    return null;
  }
  const convsRaw = raw.convs;
  if (!Array.isArray(convsRaw) || convsRaw.length === 0) {
    return null;
  }
  const convs: TemporalConvLayerJson[] = [];
  let length = seqLen;
  let inC = channels;
  for (const entry of convsRaw) {
    const layer = entry as Record<string, unknown>;
    const kernel = layer.kernel;
    const stride = layer.stride;
    const out = layer.out;
    if (
      typeof kernel !== "number" ||
      typeof stride !== "number" ||
      typeof out !== "number" ||
      kernel <= 0 ||
      stride <= 0 ||
      out <= 0 ||
      length < kernel ||
      !finiteArray(layer.W, out * kernel * inC) ||
      !finiteArray(layer.b, out)
    ) {
      return null;
    }
    convs.push({ kernel, stride, out, W: [...layer.W], b: [...layer.b] });
    length = Math.floor((length - kernel) / stride) + 1;
    inC = out;
  }
  const topOut = inC;
  const headDim = 3 * topOut + extraKeys.length;
  const head = raw.head as { W?: unknown; b?: unknown } | undefined;
  const out = raw.out as { W?: unknown; b?: unknown } | undefined;
  if (!head || !Array.isArray(head.b) || !finiteArray(head.b, head.b.length)) {
    return null;
  }
  const hidden = head.b.length;
  if (
    !finiteArray(head.W, hidden * headDim) ||
    !out ||
    !finiteArray(out.W, hidden) ||
    typeof out.b !== "number" ||
    !Number.isFinite(out.b)
  ) {
    return null;
  }
  const calibration = raw.calibration as { a?: unknown; b?: unknown } | undefined;
  if (
    !calibration ||
    typeof calibration.a !== "number" ||
    typeof calibration.b !== "number" ||
    !Number.isFinite(calibration.a) ||
    !Number.isFinite(calibration.b)
  ) {
    return null;
  }
  const thresholds = raw.thresholds as
    | { nudge?: unknown; prearm?: unknown; clear?: unknown }
    | undefined;
  if (
    !thresholds ||
    typeof thresholds.nudge !== "number" ||
    typeof thresholds.prearm !== "number" ||
    typeof thresholds.clear !== "number"
  ) {
    return null;
  }
  if (typeof raw.horizonSec !== "number" || typeof raw.paramCount !== "number") {
    return null;
  }
  const extraFeatureIndex = raw.extraFeatureIndex;
  if (
    !Array.isArray(extraFeatureIndex) ||
    extraFeatureIndex.length !== extraKeys.length ||
    !extraFeatureIndex.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0)
  ) {
    return null;
  }
  return {
    version: TEMPORAL_MODEL_VERSION,
    variant: typeof raw.variant === "string" ? raw.variant : "unknown",
    seqLen,
    channelKeys: channelKeys.map(String),
    extraKeys: extraKeys.map(String),
    extraFeatureIndex: [...extraFeatureIndex],
    norm: { mean: [...norm.mean], scale: [...norm.scale] },
    extraNorm: { mean: [...extraNorm.mean], scale: [...extraNorm.scale] },
    convs,
    head: { W: [...head.W], b: [...head.b] },
    out: { W: [...out.W], b: out.b },
    calibration: { a: calibration.a, b: calibration.b },
    horizonSec: raw.horizonSec,
    thresholds: {
      nudge: thresholds.nudge,
      prearm: thresholds.prearm,
      clear: thresholds.clear,
    },
    paramCount: raw.paramCount,
  };
}

export interface TemporalForward {
  logit: number;
  rawRisk: number;
}

function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/**
 * `window` is `seqLen × channelKeys.length` PRE-normalization values, oldest
 * second first, row-major (`window[second * channels + channel]`), zero-padded
 * at the front when the session is younger than `seqLen` seconds. `extras`
 * are the pre-normalization context scalars in `extraKeys` order.
 *
 * ~53 k multiply-adds — microseconds, once per 1 Hz tick.
 */
export function temporalForward(
  weights: TemporalWeightsFile,
  window: ArrayLike<number>,
  extras: ArrayLike<number>,
): TemporalForward {
  const channels = weights.channelKeys.length;
  if (window.length !== weights.seqLen * channels) {
    throw new Error(
      `temporal forward expects ${weights.seqLen * channels} window values, got ${window.length}`,
    );
  }
  if (extras.length !== weights.extraKeys.length) {
    throw new Error(
      `temporal forward expects ${weights.extraKeys.length} extras, got ${extras.length}`,
    );
  }
  let src = new Float64Array(window.length);
  for (let p = 0; p < weights.seqLen; p += 1) {
    for (let c = 0; c < channels; c += 1) {
      const i = p * channels + c;
      src[i] = ((window[i] as number) - (weights.norm.mean[c] as number)) / (weights.norm.scale[c] as number);
    }
  }
  let srcC = channels;
  let positions = weights.seqLen;
  for (const layer of weights.convs) {
    const nextPositions = Math.floor((positions - layer.kernel) / layer.stride) + 1;
    const dst = new Float64Array(nextPositions * layer.out);
    const kC = layer.kernel * srcC;
    const step = layer.stride * srcC;
    for (let p = 0; p < nextPositions; p += 1) {
      const base = p * step;
      for (let f = 0; f < layer.out; f += 1) {
        let sum = layer.b[f] as number;
        const wOff = f * kC;
        for (let u = 0; u < kC; u += 1) {
          sum += (layer.W[wOff + u] as number) * (src[base + u] as number);
        }
        dst[p * layer.out + f] = sum > 0 ? sum : 0;
      }
    }
    src = dst;
    srcC = layer.out;
    positions = nextPositions;
  }

  const headDim = 3 * srcC + weights.extraKeys.length;
  const pooled = new Float64Array(headDim);
  for (let f = 0; f < srcC; f += 1) {
    let sum = 0;
    let best = -Infinity;
    for (let p = 0; p < positions; p += 1) {
      const v = src[p * srcC + f] as number;
      sum += v;
      if (v > best) {
        best = v;
      }
    }
    pooled[f] = sum / positions;
    pooled[srcC + f] = best;
    pooled[2 * srcC + f] = src[(positions - 1) * srcC + f] as number;
  }
  for (let i = 0; i < weights.extraKeys.length; i += 1) {
    pooled[3 * srcC + i] =
      ((extras[i] as number) - (weights.extraNorm.mean[i] as number)) /
      (weights.extraNorm.scale[i] as number);
  }

  const hidden = weights.head.b.length;
  let logit = weights.out.b;
  for (let h = 0; h < hidden; h += 1) {
    let sum = weights.head.b[h] as number;
    const wOff = h * headDim;
    for (let k = 0; k < headDim; k += 1) {
      sum += (weights.head.W[wOff + k] as number) * (pooled[k] as number);
    }
    logit += (weights.out.W[h] as number) * Math.tanh(sum);
  }
  return { logit, rawRisk: sigmoid(weights.calibration.a * logit + weights.calibration.b) };
}

/**
 * Mean calibrated risk over an ensemble. `features18` is the shipped encoded
 * feature vector at the same tick — each member slices its own extras out of
 * it via `extraFeatureIndex`, so the caller needs no per-member knowledge.
 */
export function temporalEnsembleForward(
  models: readonly TemporalWeightsFile[],
  window: ArrayLike<number>,
  features18: ArrayLike<number>,
): TemporalForward {
  let sum = 0;
  let logit = 0;
  for (const model of models) {
    const extras = model.extraFeatureIndex.map((index) => features18[index] as number);
    const out = temporalForward(model, window, extras);
    sum += out.rawRisk;
    logit += out.logit;
  }
  const n = Math.max(1, models.length);
  return { logit: logit / n, rawRisk: sum / n };
}
