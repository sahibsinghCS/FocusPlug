import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORECAST_HIDDEN_DIM,
  FORECAST_INPUT_DIM,
  FORECAST_PARAM_COUNT,
  parseForecastWeights,
} from "../../src/shared/forecast/model";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  type ForecastWeightsFile,
} from "../../src/shared/forecast/types";
import {
  DATASET_FILE,
  MANIFEST_FILE,
  PROVENANCE_FILE,
  canonicalJson,
  forecastDataRoot,
  keepProbability,
  mulberry32,
  numberArg,
  prAuc,
  readJsonl,
  repoRoot,
  rocAuc,
  round6,
  sha256Hex,
  shuffled,
  stringArg,
  thresholdDefaults,
  type DatasetManifest,
  type DatasetRow,
} from "./lib";

/**
 * Deterministic trainer for the TinyMLP 18→12→1 forecast head (241 params) —
 * hand-rolled forward/backward + Adam, no new dependencies, mirrors
 * scripts/desk-model/train.ts. Only `split: "train"` rows are ever read; the
 * held-out eval split is scored exclusively by eval.ts.
 *
 * - val = 10% of train SESSIONS (seeded), for early stopping (val loss) and
 *   Platt calibration only — never gradient updates;
 * - z-score normalization fit on the fit subset only, shipped in weights.json;
 * - class-weighted BCE (w_pos = (n_neg/n_pos)^0.5 by default) against the
 *   ~13:1 post-downsampling imbalance — tempered so the global Platt fit is
 *   not left undoing a per-regime logit distortion at the 0.80 pre-arm line;
 * - val metrics/Platt use IMPORTANCE weights (1/keep-probability) to undo the
 *   builder's easy-negative downsampling, so calibration targets natural
 *   prevalence, not the rebalanced file;
 * - a finite-difference gradient check on a toy 4→3→1 net runs before every
 *   training run (rel err < 1e-4) — the backprop is proved, not presumed.
 *
 * Output: src/shared/forecast/weights.json (must pass parseForecastWeights)
 * plus data/forecast/provenance.json, whose sha256 is embedded in the weights
 * and asserted by eval.ts (provenance can be skipped, never faked).
 *
 *   tsx scripts/forecast/train.ts --epochs 400 --seed 42
 */

interface TrainConfig {
  data: string;
  out: string;
  epochs: number;
  lr: number;
  batch: number;
  seed: number;
  l2: number;
  patience: number;
  valFraction: number;
  posWeightPower: number;
}

function readConfig(): TrainConfig {
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    out: stringArg("--out", join(repoRoot(), "src", "shared", "forecast", "weights.json")),
    epochs: numberArg("--epochs", 400),
    lr: numberArg("--lr", 0.003),
    batch: numberArg("--batch", 256),
    seed: numberArg("--seed", 42),
    l2: numberArg("--l2", 0.0001),
    patience: numberArg("--patience", 40),
    valFraction: numberArg("--val", 0.1),
    // w_pos = (n_neg/n_pos)^power. 1 is the raw ratio; 0.5 tempers it so the
    // pre-Platt logits stay close to probabilities and the global Platt fit
    // does not have to undo a per-regime distortion at the 0.80 pre-arm line.
    posWeightPower: numberArg("--pos-weight-power", 0.5),
  };
}

// ---------------------------------------------------------------------------
// Tiny MLP (one tanh hidden layer, sigmoid output) — dims configurable so the
// gradient check exercises the exact same forward/backward code.
// ---------------------------------------------------------------------------

interface Net {
  inDim: number;
  hidDim: number;
  w1: Float64Array; // hidDim × inDim
  b1: Float64Array;
  w2: Float64Array; // hidDim
  b2: number;
}

function xavierInit(inDim: number, hidDim: number, rand: () => number): Net {
  const w1 = new Float64Array(hidDim * inDim);
  const scale1 = Math.sqrt(1 / inDim);
  for (let i = 0; i < w1.length; i += 1) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    w1[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale1;
  }
  const w2 = new Float64Array(hidDim);
  const scale2 = Math.sqrt(1 / hidDim);
  for (let i = 0; i < w2.length; i += 1) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    w2[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale2;
  }
  return { inDim, hidDim, w1, b1: new Float64Array(hidDim), w2, b2: 0 };
}

function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/** Forward pass; fills `hidden` and returns the logit. */
function netForward(net: Net, x: Float64Array, offset: number, hidden: Float64Array): number {
  for (let j = 0; j < net.hidDim; j += 1) {
    let sum = net.b1[j] as number;
    const row = j * net.inDim;
    for (let i = 0; i < net.inDim; i += 1) {
      sum += (net.w1[row + i] as number) * (x[offset + i] as number);
    }
    hidden[j] = Math.tanh(sum);
  }
  let logit = net.b2;
  for (let j = 0; j < net.hidDim; j += 1) {
    logit += (net.w2[j] as number) * (hidden[j] as number);
  }
  return logit;
}

interface Grads {
  w1: Float64Array;
  b1: Float64Array;
  w2: Float64Array;
  b2: number;
}

/**
 * Accumulates dL/dθ for weighted BCE at one sample into `grads`.
 * dL/dz = weight·(σ(z) − y); tanh backprop through the hidden layer.
 */
function netBackward(
  net: Net,
  x: Float64Array,
  offset: number,
  hidden: Float64Array,
  logit: number,
  y: number,
  weight: number,
  grads: Grads,
): void {
  const dz = weight * (sigmoid(logit) - y);
  grads.b2 += dz;
  for (let j = 0; j < net.hidDim; j += 1) {
    const h = hidden[j] as number;
    grads.w2[j] = (grads.w2[j] as number) + dz * h;
    const dz1 = dz * (net.w2[j] as number) * (1 - h * h);
    grads.b1[j] = (grads.b1[j] as number) + dz1;
    const row = j * net.inDim;
    for (let i = 0; i < net.inDim; i += 1) {
      grads.w1[row + i] = (grads.w1[row + i] as number) + dz1 * (x[offset + i] as number);
    }
  }
}

function bceLoss(logit: number, y: number, weight: number): number {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(logit)));
  return -weight * (y * Math.log(p) + (1 - y) * Math.log(1 - p));
}

// ---------------------------------------------------------------------------
// Gradient check — finite difference vs analytic on a toy 4→3→1 net
// ---------------------------------------------------------------------------

function gradientCheck(): void {
  const rand = mulberry32(1234);
  const net = xavierInit(4, 3, rand);
  const x = new Float64Array([0.3, -0.7, 0.9, 0.1]);
  const hidden = new Float64Array(3);
  const y = 1;
  const weight = 1.7;

  const analytic: Grads = {
    w1: new Float64Array(net.w1.length),
    b1: new Float64Array(net.b1.length),
    w2: new Float64Array(net.w2.length),
    b2: 0,
  };
  const logit = netForward(net, x, 0, hidden);
  netBackward(net, x, 0, hidden, logit, y, weight, analytic);

  const eps = 1e-6;
  const params: Array<{ get: () => number; set: (v: number) => void; grad: number }> = [];
  for (let i = 0; i < net.w1.length; i += 1) {
    params.push({
      get: () => net.w1[i] as number,
      set: (v) => {
        net.w1[i] = v;
      },
      grad: analytic.w1[i] as number,
    });
  }
  for (let i = 0; i < net.b1.length; i += 1) {
    params.push({
      get: () => net.b1[i] as number,
      set: (v) => {
        net.b1[i] = v;
      },
      grad: analytic.b1[i] as number,
    });
  }
  for (let i = 0; i < net.w2.length; i += 1) {
    params.push({
      get: () => net.w2[i] as number,
      set: (v) => {
        net.w2[i] = v;
      },
      grad: analytic.w2[i] as number,
    });
  }
  params.push({ get: () => net.b2, set: (v) => (net.b2 = v), grad: analytic.b2 });

  let worst = 0;
  for (const param of params) {
    const kept = param.get();
    param.set(kept + eps);
    const up = bceLoss(netForward(net, x, 0, hidden), y, weight);
    param.set(kept - eps);
    const down = bceLoss(netForward(net, x, 0, hidden), y, weight);
    param.set(kept);
    const numeric = (up - down) / (2 * eps);
    const rel = Math.abs(numeric - param.grad) / Math.max(1e-8, Math.abs(numeric) + Math.abs(param.grad));
    worst = Math.max(worst, rel);
  }
  if (worst > 1e-4) {
    throw new Error(`gradient check FAILED: worst relative error ${worst.toExponential(3)}`);
  }
  console.log(`gradient check ok (toy 4→3→1, worst rel err ${worst.toExponential(2)})`);
}

// ---------------------------------------------------------------------------
// Platt calibration on validation logits (importance-weighted, Newton)
// ---------------------------------------------------------------------------

function fitPlatt(
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

// ---------------------------------------------------------------------------

interface LoadedRows {
  x: Float64Array; // n × 18, encoded (pre-normalization)
  y: Uint8Array;
  importance: Float64Array; // 1/keep-probability
  sessionOf: Int32Array;
  sessions: string[];
}

async function loadTrainRows(file: string): Promise<LoadedRows> {
  const xs: number[] = [];
  const ys: number[] = [];
  const importance: number[] = [];
  const sessionOf: number[] = [];
  const sessions: string[] = [];
  const sessionIndex = new Map<string, number>();
  for await (const row of readJsonl<DatasetRow>(file)) {
    if (row.split !== "train") {
      continue;
    }
    let index = sessionIndex.get(row.session_id);
    if (index === undefined) {
      index = sessions.length;
      sessionIndex.set(row.session_id, index);
      sessions.push(row.session_id);
    }
    for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
      xs.push(row.features[i] ?? 0);
    }
    ys.push(row.label);
    importance.push(1 / keepProbability(row.label, row.secs_to_drift));
    sessionOf.push(index);
  }
  return {
    x: Float64Array.from(xs),
    y: Uint8Array.from(ys),
    importance: Float64Array.from(importance),
    sessionOf: Int32Array.from(sessionOf),
    sessions,
  };
}

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  gradientCheck();

  const manifest = JSON.parse(
    readFileSync(join(forecastDataRoot(), MANIFEST_FILE), "utf8"),
  ) as DatasetManifest;
  const rows = await loadTrainRows(config.data);
  const n = rows.y.length;
  if (n === 0) {
    throw new Error("no train rows found — run build-dataset.ts first");
  }

  // Val = 10% of train SESSIONS (seeded), never gradient updates.
  const rand = mulberry32(config.seed);
  const sessionOrder = shuffled(
    Array.from({ length: rows.sessions.length }, (_, i) => i),
    rand,
  );
  const valSessionCount = Math.max(1, Math.round(rows.sessions.length * config.valFraction));
  const valSessions = new Set<number>(sessionOrder.slice(0, valSessionCount));
  const fitIndex: number[] = [];
  const valIndex: number[] = [];
  for (let i = 0; i < n; i += 1) {
    (valSessions.has(rows.sessionOf[i] as number) ? valIndex : fitIndex).push(i);
  }

  // z-score normalization fit on the fit subset only.
  const mean = new Float64Array(FORECAST_INPUT_DIM);
  const scale = new Float64Array(FORECAST_INPUT_DIM);
  for (const i of fitIndex) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      mean[f] = (mean[f] as number) + (rows.x[i * FORECAST_INPUT_DIM + f] as number);
    }
  }
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    mean[f] = (mean[f] as number) / fitIndex.length;
  }
  for (const i of fitIndex) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      const diff = (rows.x[i * FORECAST_INPUT_DIM + f] as number) - (mean[f] as number);
      scale[f] = (scale[f] as number) + diff * diff;
    }
  }
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    const s = Math.sqrt((scale[f] as number) / fitIndex.length);
    scale[f] = s > 1e-6 ? s : 1;
  }
  const xNorm = new Float64Array(rows.x.length);
  for (let i = 0; i < n; i += 1) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      xNorm[i * FORECAST_INPUT_DIM + f] =
        ((rows.x[i * FORECAST_INPUT_DIM + f] as number) - (mean[f] as number)) /
        (scale[f] as number);
    }
  }

  // Class weighting against the (already partially rebalanced) fit subset.
  let fitPositives = 0;
  for (const i of fitIndex) {
    fitPositives += rows.y[i] as number;
  }
  const wPos =
    fitPositives > 0
      ? Math.pow((fitIndex.length - fitPositives) / fitPositives, config.posWeightPower)
      : 1;
  console.log(
    `train rows ${fitIndex.length} (${fitPositives} pos, w_pos ${wPos.toFixed(2)}) | ` +
      `val rows ${valIndex.length} (${valSessionCount}/${rows.sessions.length} sessions) | seed ${config.seed}`,
  );

  const net = xavierInit(FORECAST_INPUT_DIM, FORECAST_HIDDEN_DIM, rand);
  const grads: Grads = {
    w1: new Float64Array(net.w1.length),
    b1: new Float64Array(net.b1.length),
    w2: new Float64Array(net.w2.length),
    b2: 0,
  };
  const adamM = {
    w1: new Float64Array(net.w1.length),
    b1: new Float64Array(net.b1.length),
    w2: new Float64Array(net.w2.length),
    b2: 0,
  };
  const adamV = {
    w1: new Float64Array(net.w1.length),
    b1: new Float64Array(net.b1.length),
    w2: new Float64Array(net.w2.length),
    b2: 0,
  };
  const beta1 = 0.9;
  const beta2 = 0.999;
  const adamEps = 1e-8;
  let step = 0;
  const hidden = new Float64Array(FORECAST_HIDDEN_DIM);

  const valLoss = (): number => {
    let total = 0;
    let weightSum = 0;
    for (const i of valIndex) {
      const logit = netForward(net, xNorm, i * FORECAST_INPUT_DIM, hidden);
      const w = rows.importance[i] as number;
      total += bceLoss(logit, rows.y[i] as number, w);
      weightSum += w;
    }
    return weightSum > 0 ? total / weightSum : 0;
  };

  const snapshot = (): Net => ({
    inDim: net.inDim,
    hidDim: net.hidDim,
    w1: Float64Array.from(net.w1),
    b1: Float64Array.from(net.b1),
    w2: Float64Array.from(net.w2),
    b2: net.b2,
  });

  let best = { loss: Number.POSITIVE_INFINITY, epoch: -1, net: snapshot() };
  let sinceBest = 0;
  let epochsRan = 0;

  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    epochsRan = epoch + 1;
    const order = shuffled(fitIndex, rand);
    for (let start = 0; start < order.length; start += config.batch) {
      const end = Math.min(order.length, start + config.batch);
      grads.w1.fill(0);
      grads.b1.fill(0);
      grads.w2.fill(0);
      grads.b2 = 0;
      let batchWeight = 0;
      for (let k = start; k < end; k += 1) {
        const i = order[k] as number;
        const y = rows.y[i] as number;
        const weight = y === 1 ? wPos : 1;
        batchWeight += weight;
        const logit = netForward(net, xNorm, i * FORECAST_INPUT_DIM, hidden);
        netBackward(net, xNorm, i * FORECAST_INPUT_DIM, hidden, logit, y, weight, grads);
      }
      if (batchWeight <= 0) {
        continue;
      }
      step += 1;
      const lr = config.lr * (Math.sqrt(1 - beta2 ** step) / (1 - beta1 ** step));
      const update = (
        theta: Float64Array,
        grad: Float64Array,
        m: Float64Array,
        v: Float64Array,
        l2: number,
      ): void => {
        for (let i = 0; i < theta.length; i += 1) {
          const g = (grad[i] as number) / batchWeight + l2 * (theta[i] as number);
          m[i] = beta1 * (m[i] as number) + (1 - beta1) * g;
          v[i] = beta2 * (v[i] as number) + (1 - beta2) * g * g;
          theta[i] = (theta[i] as number) - (lr * (m[i] as number)) / (Math.sqrt(v[i] as number) + adamEps);
        }
      };
      update(net.w1, grads.w1, adamM.w1, adamV.w1, config.l2);
      update(net.b1, grads.b1, adamM.b1, adamV.b1, 0);
      update(net.w2, grads.w2, adamM.w2, adamV.w2, config.l2);
      {
        const g = grads.b2 / batchWeight;
        adamM.b2 = beta1 * adamM.b2 + (1 - beta1) * g;
        adamV.b2 = beta2 * adamV.b2 + (1 - beta2) * g * g;
        net.b2 -= (lr * adamM.b2) / (Math.sqrt(adamV.b2) + adamEps);
      }
    }

    const loss = valLoss();
    if (loss < best.loss - 1e-6) {
      best = { loss, epoch, net: snapshot() };
      sinceBest = 0;
    } else {
      sinceBest += 1;
    }
    if (epoch % 10 === 0 || sinceBest === 0) {
      console.log(
        `epoch ${String(epoch).padStart(3)} | val loss ${loss.toFixed(5)}${sinceBest === 0 ? " *" : ""}`,
      );
    }
    if (sinceBest >= config.patience) {
      console.log(`early stop at epoch ${epoch} (best epoch ${best.epoch})`);
      break;
    }
  }

  // Platt calibration on val logits only (importance-weighted → natural
  // prevalence), plus val ranking metrics for the log.
  const valLogits: number[] = [];
  const valLabels: number[] = [];
  const valWeights: number[] = [];
  for (const i of valIndex) {
    valLogits.push(netForward(best.net, xNorm, i * FORECAST_INPUT_DIM, hidden));
    valLabels.push(rows.y[i] as number);
    valWeights.push(rows.importance[i] as number);
  }
  const calibration = fitPlatt(valLogits, valLabels, valWeights);
  const valRoc = rocAuc(valLogits, valLabels);
  const valPr = prAuc(valLogits, valLabels);
  console.log(
    `val ROC-AUC ${valRoc.toFixed(4)} | val PR-AUC ${valPr.toFixed(4)} | ` +
      `Platt a ${calibration.a.toFixed(4)} b ${calibration.b.toFixed(4)}`,
  );

  // Provenance: the dataset manifest plus this training run, canonicalized;
  // its sha ships inside weights.json and eval.ts embeds the object verbatim.
  const thresholds = await thresholdDefaults();
  const provenance = {
    manifest,
    train: {
      config: {
        epochs: config.epochs,
        lr: config.lr,
        batch: config.batch,
        seed: config.seed,
        l2: config.l2,
        patience: config.patience,
        valFraction: config.valFraction,
        posWeightPower: config.posWeightPower,
      },
      arch: `${FORECAST_INPUT_DIM}-${FORECAST_HIDDEN_DIM}-1`,
      paramCount: FORECAST_PARAM_COUNT,
      rows: { fit: fitIndex.length, val: valIndex.length, fitPositives },
      classWeightPos: round6(wPos),
      epochsRan,
      bestEpoch: best.epoch,
      bestValLoss: round6(best.loss),
      valRocAuc: round6(valRoc),
      valPrAuc: round6(valPr),
      earlyStopMetric: "val importance-weighted BCE loss",
    },
  };
  const provenanceSha = sha256Hex(canonicalJson(provenance));
  writeFileSync(
    join(forecastDataRoot(), PROVENANCE_FILE),
    JSON.stringify(provenance, null, 2),
  );

  const precision8 = (value: number): number => Number(value.toPrecision(8));
  const weightsFile: ForecastWeightsFile = {
    version: FORECAST_MODEL_VERSION,
    // Deterministic given the dataset: same seed + same data ⇒ byte-identical
    // weights.json (wall-clock time never enters the artifact).
    createdAt: manifest.createdAt,
    seed: config.seed,
    featureKeys: [...FORECAST_FEATURE_KEYS],
    norm: {
      mean: [...mean].map(precision8),
      scale: [...scale].map(precision8),
    },
    layers: [
      {
        W: Array.from({ length: FORECAST_HIDDEN_DIM }, (_, j) =>
          Array.from({ length: FORECAST_INPUT_DIM }, (_, i) =>
            precision8(best.net.w1[j * FORECAST_INPUT_DIM + i] as number),
          ),
        ),
        b: [...best.net.b1].map(precision8),
      },
      {
        W: [[...best.net.w2].map(precision8)],
        b: [precision8(best.net.b2)],
      },
    ],
    calibration: { a: precision8(calibration.a), b: precision8(calibration.b) },
    horizonSec: FORECAST_HORIZON_SEC,
    thresholds: { nudge: thresholds.nudge, prearm: thresholds.prearm, clear: thresholds.clear },
    paramCount: FORECAST_PARAM_COUNT,
    trainProvenanceSha: provenanceSha,
  };

  // The committed artifact must round-trip the fail-closed runtime parser.
  const parsed = parseForecastWeights(JSON.parse(JSON.stringify(weightsFile)));
  if (parsed === null) {
    throw new Error("trained weights failed parseForecastWeights — refusing to write");
  }
  writeFileSync(config.out, `${JSON.stringify(weightsFile, null, 2)}\n`);
  console.log(
    `weights → ${config.out} (${FORECAST_PARAM_COUNT} params, provenance sha ${provenanceSha.slice(0, 12)}…, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
