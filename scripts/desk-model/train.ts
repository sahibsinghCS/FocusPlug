import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyInputSlices,
  codebookFeatures,
  DESK_HEAD_LABELS,
  type DeskHeadWeights,
} from "../../src/main/desk/model/your-model";
import {
  mulberry32,
  readFeatureRows,
  scorePredictions,
  shuffled,
  formatMetrics,
  type FeatureRow,
} from "./lib";

/**
 * Deterministic trainer for the custom desk-presence head. Hand-rolled
 * MLP + Adam plus a per-class k-means codebook (retrieval features), no new
 * dependencies. Only `split: "train"` rows are ever touched here — the
 * held-out eval split is scored exclusively by eval.ts.
 *
 * The `nc` (Edinburgh) bucket is large and easy, so `--main-weight` upweights
 * the diverse `main` bucket and early stopping tracks main-val balanced
 * accuracy — otherwise the head overfits static-scene cues.
 *
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/train.ts --hidden 64,32 --seed 42
 */

interface TrainConfig {
  hidden: number[];
  epochs: number;
  lr: number;
  batch: number;
  seed: number;
  l2: number;
  patience: number;
  valFraction: number;
  mainWeight: number;
  centroidsPerClass: number;
  slices: Array<[number, number]> | null;
  out: string;
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * Repo-relative rendering for the COMMITTED metrics file. `--out` is usually a
 * scratch path on the trainer's machine; writing it verbatim leaked a username
 * and a temp dir into a tracked artifact and told a reader nothing.
 */
function portablePath(absolute: string): string {
  const rel = relative(repoRoot(), absolute);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
    return basename(absolute);
  }
  return rel.split(sep).join("/");
}

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}

function numberArg(flag: string, fallback: number): number {
  const parsed = Number(stringArg(flag, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readConfig(): TrainConfig {
  return {
    hidden: stringArg("--hidden", "64,32")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((size) => Number.isFinite(size) && size > 0),
    epochs: numberArg("--epochs", 600),
    lr: numberArg("--lr", 0.002),
    batch: numberArg("--batch", 128),
    seed: numberArg("--seed", 42),
    l2: numberArg("--l2", 0.0001),
    patience: numberArg("--patience", 100),
    valFraction: numberArg("--val", 0.1),
    mainWeight: numberArg("--main-weight", 3),
    centroidsPerClass: numberArg("--centroids", 0),
    slices: ((): Array<[number, number]> | null => {
      const raw = stringArg("--slices", "");
      if (!raw) {
        return null;
      }
      const parsed = raw
        .split(",")
        .map((part) => part.split("-").map((n) => Number(n.trim())))
        .filter((pair) => pair.length === 2 && pair.every((n) => Number.isFinite(n)))
        .map((pair) => [pair[0] as number, pair[1] as number] as [number, number]);
      return parsed.length > 0 ? parsed : null;
    })(),
    out: stringArg(
      "--out",
      join(repoRoot(), "src", "main", "desk", "model", "weights", "desk-head.json"),
    ),
  };
}

interface Matrix {
  rows: number;
  cols: number;
  data: Float64Array;
}

function matrix(rows: number, cols: number): Matrix {
  return { rows, cols, data: new Float64Array(rows * cols) };
}

interface Layer {
  w: Matrix;
  b: Float64Array;
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

function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map((layer) => ({
    w: { rows: layer.w.rows, cols: layer.w.cols, data: Float64Array.from(layer.w.data) },
    b: Float64Array.from(layer.b),
  }));
}

function forward(layers: Layer[], input: Float64Array): {
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

function argmax(values: Float64Array): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if ((values[i] ?? 0) > (values[best] ?? 0)) {
      best = i;
    }
  }
  return best;
}

interface Sample {
  x: Float64Array;
  y: number;
  weight: number;
  row: FeatureRow;
}

function balancedAccuracy(
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

/** Plain seeded Lloyd k-means; empty clusters are reseeded from the data. */
function kMeans(
  vectors: Float64Array[],
  k: number,
  rand: () => number,
  iterations = 30,
): number[][] {
  const count = vectors.length;
  const dim = vectors[0]?.length ?? 0;
  const clusters = Math.max(1, Math.min(k, count));
  const centroidIndexes = shuffled(
    Array.from({ length: count }, (_, i) => i),
    rand,
  ).slice(0, clusters);
  const centroids = centroidIndexes.map((index) => Float64Array.from(vectors[index] as Float64Array));
  const assignment = new Array<number>(count).fill(0);
  for (let iter = 0; iter < iterations; iter += 1) {
    let moved = false;
    for (let v = 0; v < count; v += 1) {
      const vector = vectors[v] as Float64Array;
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let c = 0; c < clusters; c += 1) {
        const centroid = centroids[c] as Float64Array;
        let sum = 0;
        for (let i = 0; i < dim; i += 1) {
          const diff = (vector[i] ?? 0) - (centroid[i] ?? 0);
          sum += diff * diff;
        }
        if (sum < bestDist) {
          bestDist = sum;
          best = c;
        }
      }
      if (assignment[v] !== best) {
        assignment[v] = best;
        moved = true;
      }
    }
    if (!moved && iter > 0) {
      break;
    }
    const sums = Array.from({ length: clusters }, () => new Float64Array(dim));
    const counts = new Array<number>(clusters).fill(0);
    for (let v = 0; v < count; v += 1) {
      const target = sums[assignment[v] as number] as Float64Array;
      const vector = vectors[v] as Float64Array;
      for (let i = 0; i < dim; i += 1) {
        target[i] = (target[i] ?? 0) + (vector[i] ?? 0);
      }
      counts[assignment[v] as number] = (counts[assignment[v] as number] ?? 0) + 1;
    }
    for (let c = 0; c < clusters; c += 1) {
      const total = counts[c] ?? 0;
      if (total === 0) {
        const reseed = vectors[Math.floor(rand() * count)] as Float64Array;
        centroids[c] = Float64Array.from(reseed);
        continue;
      }
      const sum = sums[c] as Float64Array;
      const centroid = centroids[c] as Float64Array;
      for (let i = 0; i < dim; i += 1) {
        centroid[i] = (sum[i] ?? 0) / total;
      }
    }
  }
  return centroids.map((centroid) => [...centroid]);
}

async function main(): Promise<void> {
  const config = readConfig();
  const labels = [...DESK_HEAD_LABELS];
  const rows = readFeatureRows();
  const trainRows = rows.filter((row) => row.split === "train");
  if (trainRows.length === 0) {
    throw new Error("No train rows found — run extract-features.ts first");
  }
  const rawDim = trainRows[0]?.vector.length ?? 0;
  for (const row of trainRows) {
    if (row.vector.length !== rawDim) {
      throw new Error(`Inconsistent feature dim at ${row.path}`);
    }
  }
  const project = (row: FeatureRow): number[] =>
    applyInputSlices(config.slices ?? undefined, row.vector);
  const dim = project(trainRows[0] as FeatureRow).length;

  // Standardization from the train pool only.
  const mean = new Float64Array(dim);
  const std = new Float64Array(dim);
  const projected = new Map<FeatureRow, number[]>();
  for (const row of trainRows) {
    projected.set(row, project(row));
  }
  for (const row of trainRows) {
    const v = projected.get(row) as number[];
    for (let i = 0; i < dim; i += 1) {
      mean[i] = (mean[i] ?? 0) + (v[i] ?? 0);
    }
  }
  for (let i = 0; i < dim; i += 1) {
    mean[i] = (mean[i] ?? 0) / trainRows.length;
  }
  for (const row of trainRows) {
    const v = projected.get(row) as number[];
    for (let i = 0; i < dim; i += 1) {
      const diff = (v[i] ?? 0) - (mean[i] ?? 0);
      std[i] = (std[i] ?? 0) + diff * diff;
    }
  }
  for (let i = 0; i < dim; i += 1) {
    std[i] = Math.sqrt((std[i] ?? 0) / trainRows.length);
  }

  const standardize = (row: FeatureRow): Float64Array => {
    const v = projected.get(row) ?? project(row);
    const x = new Float64Array(dim);
    for (let i = 0; i < dim; i += 1) {
      const s = std[i] ?? 1;
      x[i] = ((v[i] ?? 0) - (mean[i] ?? 0)) / (s > 1e-6 ? s : 1);
    }
    return x;
  };

  const rand = mulberry32(config.seed);
  // Stratified train/val split per (bucket, class) so the val slice mirrors
  // both distributions; model selection tracks the main bucket.
  const byStratum = new Map<string, FeatureRow[]>();
  for (const row of trainRows) {
    const key = `${row.bucket}/${row.mapped}`;
    const bucket = byStratum.get(key) ?? [];
    bucket.push(row);
    byStratum.set(key, bucket);
  }
  const trainSplit: FeatureRow[] = [];
  const valSplit: FeatureRow[] = [];
  for (const key of [...byStratum.keys()].sort()) {
    const mixed = shuffled(byStratum.get(key) ?? [], rand);
    const valCount = Math.max(1, Math.round(mixed.length * config.valFraction));
    for (let i = 0; i < mixed.length; i += 1) {
      (i < valCount ? valSplit : trainSplit).push(mixed[i] as FeatureRow);
    }
  }

  const buildCodebook = (source: FeatureRow[]): number[][][] | null => {
    if (config.centroidsPerClass <= 0) {
      return null;
    }
    return labels.map((label) => {
      const vectors = source
        .filter((row) => row.mapped === label)
        .map((row) => standardize(row));
      const k = Math.max(3, Math.min(config.centroidsPerClass, Math.floor(vectors.length / 6)));
      return kMeans(vectors, k, rand);
    });
  };

  // Shipped codebook: all train rows. But train-time retrieval features are
  // CROSS-FIT (each fold featurized against the other fold's codebook), so
  // the head never sees a sample's self-distance — otherwise it learns a
  // "tiny distance ⇒ class" rule that val/eval cannot reproduce.
  const foldA: FeatureRow[] = [];
  const foldB: FeatureRow[] = [];
  for (const row of shuffled(trainSplit, rand)) {
    (foldA.length <= foldB.length ? foldA : foldB).push(row);
  }
  const codebook = buildCodebook(trainSplit);
  const codebookA = buildCodebook(foldA);
  const codebookB = buildCodebook(foldB);

  const toSample = (row: FeatureRow, book: number[][][] | null): Sample => {
    const base = standardize(row);
    const extended = book ? codebookFeatures(book, [...base]) : [];
    const x = new Float64Array(dim + extended.length);
    x.set(base);
    for (let i = 0; i < extended.length; i += 1) {
      x[dim + i] = extended[i] ?? 0;
    }
    return { x, y: labels.indexOf(row.mapped), weight: 1, row };
  };

  const trainSamples = [
    ...foldA.map((row) => toSample(row, codebookB)),
    ...foldB.map((row) => toSample(row, codebookA)),
  ];
  const valSamples = valSplit.map((row) => toSample(row, codebook));
  const mainValSamples = valSamples.filter((sample) => sample.row.bucket === "main");

  const classCounts = new Map<number, number>();
  for (const sample of trainSamples) {
    classCounts.set(sample.y, (classCounts.get(sample.y) ?? 0) + 1);
  }
  for (const sample of trainSamples) {
    const count = classCounts.get(sample.y) ?? 1;
    const classWeight = Math.min(4, Math.max(0.5, trainSamples.length / (labels.length * count)));
    const bucketWeight = sample.row.bucket === "main" ? config.mainWeight : 1;
    sample.weight = classWeight * bucketWeight;
  }

  const inputDim = dim + (codebook ? 2 * labels.length : 0);
  const sizes = [inputDim, ...config.hidden, labels.length];
  const layers: Layer[] = [];
  for (let l = 0; l < sizes.length - 1; l += 1) {
    const layer: Layer = {
      w: matrix(sizes[l + 1] as number, sizes[l] as number),
      b: new Float64Array(sizes[l + 1] as number),
    };
    heInit(layer, rand);
    layers.push(layer);
  }

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

  console.log(
    `train ${trainSamples.length} / val ${valSamples.length} (main ${mainValSamples.length}) | input ${inputDim} | arch ${sizes.join("-")} | seed ${config.seed} | main-weight ${config.mainWeight}`,
  );

  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    const order = shuffled(trainSamples, rand);
    for (let start = 0; start < order.length; start += config.batch) {
      const batch = order.slice(start, start + config.batch);
      const gW = layers.map((layer) => new Float64Array(layer.w.data.length));
      const gB = layers.map((layer) => new Float64Array(layer.b.length));
      const batchWeight = batch.reduce((sum, sample) => sum + sample.weight, 0) || 1;
      for (const sample of batch) {
        const { activations, probs } = forward(layers, sample.x);
        let delta = new Float64Array(labels.length);
        for (let i = 0; i < labels.length; i += 1) {
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

    const mainVal = balancedAccuracy(layers, mainValSamples);
    const allVal = balancedAccuracy(layers, valSamples);
    const score = 0.8 * mainVal.balanced + 0.2 * allVal.balanced;
    if (score > best.score + 1e-6) {
      best = { score, epoch, layers: cloneLayers(layers) };
      sinceBest = 0;
    } else {
      sinceBest += 1;
    }
    if (epoch % 20 === 0 || sinceBest === 0) {
      console.log(
        `epoch ${String(epoch).padStart(3)} | main-val bal ${(mainVal.balanced * 100).toFixed(2)}% | all-val bal ${(allVal.balanced * 100).toFixed(2)}% acc ${(allVal.accuracy * 100).toFixed(2)}%${sinceBest === 0 ? " *" : ""}`,
      );
    }
    if (sinceBest >= config.patience) {
      console.log(`early stop at epoch ${epoch} (best epoch ${best.epoch})`);
      break;
    }
  }

  const weights: DeskHeadWeights = {
    version: 2,
    featureDim: dim,
    labels,
    ...(config.slices ? { inputSlices: config.slices } : {}),
    mean: [...mean].map((value) => Number(value.toPrecision(8))),
    std: [...std].map((value) => Number(value.toPrecision(8))),
    ...(codebook
      ? {
          codebook: codebook.map((centroids) =>
            centroids.map((centroid) => centroid.map((value) => Number(value.toPrecision(5)))),
          ),
        }
      : {}),
    layers: best.layers.map((layer) => ({
      w: Array.from({ length: layer.w.rows }, (_, o) =>
        Array.from({ length: layer.w.cols }, (_, i) =>
          Number(((layer.w.data[o * layer.w.cols + i] ?? 0)).toPrecision(8)),
        ),
      ),
      b: [...layer.b].map((value) => Number(value.toPrecision(8))),
    })),
  };
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, JSON.stringify(weights));

  const valPairs = valSamples.map((sample) => ({
    truth: labels[sample.y] ?? "uncertain",
    predicted: labels[argmax(forward(best.layers, sample.x).probs)] ?? "uncertain",
  }));
  const valMetrics = scorePredictions(labels, valPairs);
  console.log(formatMetrics("val (best epoch)", valMetrics));
  const mainPairs = mainValSamples.map((sample) => ({
    truth: labels[sample.y] ?? "uncertain",
    predicted: labels[argmax(forward(best.layers, sample.x).probs)] ?? "uncertain",
  }));
  console.log(formatMetrics("main-bucket val (best epoch)", scorePredictions(labels, mainPairs)));

  const report = {
    trainedAt: new Date().toISOString(),
    config: { ...config, out: portablePath(config.out), arch: sizes },
    dataset: {
      train: trainSamples.length,
      val: valSamples.length,
      mainVal: mainValSamples.length,
      perClass: Object.fromEntries(
        [...classCounts.entries()].map(([y, count]) => [labels[y] ?? String(y), count]),
      ),
      codebookSizes: codebook ? codebook.map((centroids) => centroids.length) : [],
    },
    bestEpoch: best.epoch,
    bestScore: best.score,
    valMetrics,
  };
  writeFileSync(config.out.replace(/\.json$/, ".metrics.json"), JSON.stringify(report, null, 2));
  console.log(`weights -> ${config.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
