import { shuffled } from "./lib";

/**
 * Hand-rolled dense ReLU MLP + softmax + Adam, shared by the desk heads
 * (`train.ts` presence, `train-attention.ts` attention). Deterministic given
 * the PRNG: layer init and every epoch's shuffle draw from `rand` in a fixed
 * order, so a refactor that keeps call order keeps the weights bit-identical.
 */

export interface Matrix {
  rows: number;
  cols: number;
  data: Float64Array;
}

export interface Layer {
  w: Matrix;
  b: Float64Array;
}

export interface Sample {
  x: Float64Array;
  y: number;
  weight: number;
}

export interface AdamConfig {
  epochs: number;
  lr: number;
  batch: number;
  l2: number;
  patience: number;
}

function heInit(layer: Layer, rand: () => number): void {
  const scale = Math.sqrt(2 / layer.w.cols);
  for (let i = 0; i < layer.w.data.length; i += 1) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    layer.w.data[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale;
  }
  layer.b.fill(0);
}

/** `sizes` = [input, ...hidden, classes]; He-initialized in layer order. */
export function createLayers(sizes: number[], rand: () => number): Layer[] {
  const layers: Layer[] = [];
  for (let l = 0; l < sizes.length - 1; l += 1) {
    const rows = sizes[l + 1] as number;
    const cols = sizes[l] as number;
    const layer: Layer = {
      w: { rows, cols, data: new Float64Array(rows * cols) },
      b: new Float64Array(rows),
    };
    heInit(layer, rand);
    layers.push(layer);
  }
  return layers;
}

export function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map((layer) => ({
    w: { rows: layer.w.rows, cols: layer.w.cols, data: Float64Array.from(layer.w.data) },
    b: Float64Array.from(layer.b),
  }));
}

export function forward(layers: Layer[], input: Float64Array): {
  activations: Float64Array[];
  probs: Float64Array;
} {
  const activations: Float64Array[] = [input];
  let current = input;
  for (let l = 0; l < layers.length; l += 1) {
    const layer = layers[l] as Layer;
    const out = new Float64Array(layer.w.rows);
    for (let o = 0; o < layer.w.rows; o += 1) {
      let sum = layer.b[o] ?? 0;
      const offset = o * layer.w.cols;
      for (let i = 0; i < layer.w.cols; i += 1) {
        sum += (layer.w.data[offset + i] ?? 0) * (current[i] ?? 0);
      }
      out[o] = l < layers.length - 1 ? Math.max(0, sum) : sum;
    }
    activations.push(out);
    current = out;
  }
  const logits = activations[activations.length - 1] as Float64Array;
  let maxLogit = -Infinity;
  for (const value of logits) {
    maxLogit = Math.max(maxLogit, value);
  }
  const probs = new Float64Array(logits.length);
  let total = 0;
  for (let i = 0; i < logits.length; i += 1) {
    probs[i] = Math.exp((logits[i] ?? 0) - maxLogit);
    total += probs[i] ?? 0;
  }
  for (let i = 0; i < probs.length; i += 1) {
    probs[i] = (probs[i] ?? 0) / (total || 1);
  }
  return { activations, probs };
}

export function argmax(values: Float64Array): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if ((values[i] ?? 0) > (values[best] ?? 0)) {
      best = i;
    }
  }
  return best;
}

export function balancedAccuracy(
  layers: Layer[],
  samples: Sample[],
): { balanced: number; accuracy: number } {
  const perClass = new Map<number, { total: number; correct: number }>();
  let correct = 0;
  for (const sample of samples) {
    const predicted = argmax(forward(layers, sample.x).probs);
    const cls = perClass.get(sample.y) ?? { total: 0, correct: 0 };
    cls.total += 1;
    if (predicted === sample.y) {
      cls.correct += 1;
      correct += 1;
    }
    perClass.set(sample.y, cls);
  }
  let recallSum = 0;
  let classes = 0;
  for (const cls of perClass.values()) {
    if (cls.total > 0) {
      recallSum += cls.correct / cls.total;
      classes += 1;
    }
  }
  return {
    balanced: classes > 0 ? recallSum / classes : 0,
    accuracy: samples.length > 0 ? correct / samples.length : 0,
  };
}

/**
 * Weighted softmax cross-entropy with Adam and L2, trained in place on
 * `layers`. After every epoch `evaluate` scores the current layers; the best
 * scoring snapshot is returned, and training stops after `patience` epochs
 * without improvement.
 */
export function trainMlp(
  layers: Layer[],
  samples: Sample[],
  config: AdamConfig,
  rand: () => number,
  evaluate: (current: Layer[]) => { score: number; line: string },
): { score: number; epoch: number; layers: Layer[] } {
  const classes = (layers[layers.length - 1] as Layer).w.rows;
  const mW = layers.map((layer) => new Float64Array(layer.w.data.length));
  const vW = layers.map((layer) => new Float64Array(layer.w.data.length));
  const mB = layers.map((layer) => new Float64Array(layer.b.length));
  const vB = layers.map((layer) => new Float64Array(layer.b.length));
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  let step = 0;

  let best = { score: -1, epoch: -1, layers: cloneLayers(layers) };
  let sinceBest = 0;

  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    const order = shuffled(samples, rand);
    for (let start = 0; start < order.length; start += config.batch) {
      const batch = order.slice(start, start + config.batch);
      const gW = layers.map((layer) => new Float64Array(layer.w.data.length));
      const gB = layers.map((layer) => new Float64Array(layer.b.length));
      const batchWeight = batch.reduce((sum, sample) => sum + sample.weight, 0) || 1;
      for (const sample of batch) {
        const { activations, probs } = forward(layers, sample.x);
        let delta = new Float64Array(classes);
        for (let i = 0; i < classes; i += 1) {
          delta[i] = ((probs[i] ?? 0) - (i === sample.y ? 1 : 0)) * sample.weight;
        }
        for (let l = layers.length - 1; l >= 0; l -= 1) {
          const layer = layers[l] as Layer;
          const input = activations[l] as Float64Array;
          const gw = gW[l] as Float64Array;
          const gb = gB[l] as Float64Array;
          for (let o = 0; o < layer.w.rows; o += 1) {
            const d = delta[o] ?? 0;
            gb[o] = (gb[o] ?? 0) + d;
            const offset = o * layer.w.cols;
            for (let i = 0; i < layer.w.cols; i += 1) {
              gw[offset + i] = (gw[offset + i] ?? 0) + d * (input[i] ?? 0);
            }
          }
          if (l > 0) {
            const next = new Float64Array(layer.w.cols);
            const hidden = activations[l] as Float64Array;
            for (let i = 0; i < layer.w.cols; i += 1) {
              if ((hidden[i] ?? 0) > 0) {
                let sum = 0;
                for (let o = 0; o < layer.w.rows; o += 1) {
                  sum += (delta[o] ?? 0) * (layer.w.data[o * layer.w.cols + i] ?? 0);
                }
                next[i] = sum;
              }
            }
            delta = next;
          }
        }
      }
      step += 1;
      const lr = config.lr * (Math.sqrt(1 - beta2 ** step) / (1 - beta1 ** step));
      for (let l = 0; l < layers.length; l += 1) {
        const layer = layers[l] as Layer;
        const gw = gW[l] as Float64Array;
        const gb = gB[l] as Float64Array;
        const mw = mW[l] as Float64Array;
        const vw = vW[l] as Float64Array;
        const mb = mB[l] as Float64Array;
        const vb = vB[l] as Float64Array;
        for (let i = 0; i < layer.w.data.length; i += 1) {
          const grad = (gw[i] ?? 0) / batchWeight + config.l2 * (layer.w.data[i] ?? 0);
          mw[i] = beta1 * (mw[i] ?? 0) + (1 - beta1) * grad;
          vw[i] = beta2 * (vw[i] ?? 0) + (1 - beta2) * grad * grad;
          layer.w.data[i] =
            (layer.w.data[i] ?? 0) - (lr * (mw[i] ?? 0)) / (Math.sqrt(vw[i] ?? 0) + eps);
        }
        for (let i = 0; i < layer.b.length; i += 1) {
          const grad = (gb[i] ?? 0) / batchWeight;
          mb[i] = beta1 * (mb[i] ?? 0) + (1 - beta1) * grad;
          vb[i] = beta2 * (vb[i] ?? 0) + (1 - beta2) * grad * grad;
          layer.b[i] = (layer.b[i] ?? 0) - (lr * (mb[i] ?? 0)) / (Math.sqrt(vb[i] ?? 0) + eps);
        }
      }
    }

    const { score, line } = evaluate(layers);
    if (score > best.score + 1e-6) {
      best = { score, epoch, layers: cloneLayers(layers) };
      sinceBest = 0;
    } else {
      sinceBest += 1;
    }
    if (epoch % 20 === 0 || sinceBest === 0) {
      console.log(`epoch ${String(epoch).padStart(3)} | ${line}${sinceBest === 0 ? " *" : ""}`);
    }
    if (sinceBest >= config.patience) {
      console.log(`early stop at epoch ${epoch} (best epoch ${best.epoch})`);
      break;
    }
  }
  return best;
}

/** JSON shape shared by every head file: row-major weights, 8 significant digits. */
export function serializeLayers(layers: Layer[]): Array<{ w: number[][]; b: number[] }> {
  return layers.map((layer) => ({
    w: Array.from({ length: layer.w.rows }, (_, o) =>
      Array.from({ length: layer.w.cols }, (_, i) =>
        Number(((layer.w.data[o * layer.w.cols + i] ?? 0)).toPrecision(8)),
      ),
    ),
    b: [...layer.b].map((value) => Number(value.toPrecision(8))),
  }));
}
