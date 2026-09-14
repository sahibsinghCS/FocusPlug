import type { AttentionLabel } from "../types";
import {
  CORRECTION_ANCHOR_EVIDENCE,
  CORRECTION_ANCHOR_L2,
  CORRECTION_BOOTSTRAP_DRAWS,
  CORRECTION_CLASS_WEIGHT_CAP,
  CORRECTION_GAUNTLET_SEED,
  CORRECTION_MAX_DRIFT_RATIO,
  CORRECTION_MAX_SLICE_DROP_PTS,
  CORRECTION_MIN_GAIN_GROUPS,
  CORRECTION_POOLED_MARGIN_PTS,
  CORRECTION_REFIT_EPOCHS,
  CORRECTION_REFIT_LR,
  CORRECTION_REFIT_MIN_EVAL_GROUPS,
  CORRECTION_REFIT_MIN_GROUPS,
  CORRECTION_REFIT_MIN_TRAIN_GROUPS,
} from "./constants";
import type {
  AttentionAnchorRow,
  AttentionAnchors,
  OutputLayer,
  PersonalAttentionHead,
  RefitGateId,
  RefitGateResult,
  RefitInterval,
  RefitReport,
  RefitScores,
  SliceScore,
} from "./types";

export type {
  AttentionAnchorRow,
  AttentionAnchors,
  OutputLayer,
  PersonalAttentionHead,
  RefitGateId,
  RefitGateResult,
  RefitInterval,
  RefitReport,
  RefitScores,
  SliceScore,
};

/**
 * The personal attention refit and its GATE — the deferred half of the
 * correction loop (`docs/CORRECTION-LOOP.md` §6 and §7), as pure arithmetic.
 *
 * WHAT THIS FILE IS. When the timer pauses on a `phone` reading and the
 * student says "I was working", the frames that caused the pause are stored
 * on that machine with the student's label. This file is what turns an
 * accumulated pile of those corrections into 51 numbers — and, far more
 * importantly, what refuses to install them.
 *
 * THE FOUR RULES IT KEEPS, each of which is a function below:
 *
 * 1. ONE CLICK NEVER RETRAINS. Nothing here is called by recording a
 *    correction. `fitPersonalOutputLayer` is a separate, explicit step that
 *    needs `CORRECTION_REFIT_MIN_GROUPS` (12) independent corrections before
 *    the gate will even consider its output.
 * 2. A HANDFUL MUST NOT DOMINATE. Three weightings, in this order: each
 *    correction is ONE vote however many frames it carries (`1/framesInGroup`,
 *    the same rule `first-person.ts` enforces on the eval side); classes are
 *    balanced with `train-attention.ts`'s own formula and its cap of 4; and
 *    the objective is anchored to the SHIPPED output layer with
 *    λ = CORRECTION_ANCHOR_L2 · 693 / (693 + groups), where 693 is the
 *    labelled rows the shipped head was actually fitted on. At the floor of
 *    twelve corrections that ratio is 0.983 — the anchor is at full strength
 *    and twelve corrections tilt the boundary rather than redraw it.
 * 3. A WORSE HEAD MUST NOT SHIP. `evaluateRefit` runs eleven named gates in a
 *    fixed order over the shipped 286-image held-out eval, reports every one
 *    of them plus BOTH heads' scores, and installs nothing unless the personal
 *    head is not beaten pooled, does not drop either slice by more than 3
 *    points, and newly agrees with the student on at least one more held-out
 *    correction. The first failure is `blockedBy`.
 * 4. NO PRNG IN THE FIT. Fifty-one parameters over at most 360 frames is a
 *    full-batch problem: fixed steps, fixed learning rate, no shuffling, no
 *    initialisation, no early stopping. Same corrections in, byte-identical
 *    layer out — which is what makes this file testable without a data pack.
 *    (The bootstrap printed BESIDE the gate does draw, from a fixed seed.)
 *
 * ONE IMPLEMENTATION, TWO SHELLS. This module is the only copy of the fit and
 * the gate in the repository. The app runs it from
 * `src/main/desk/corrections/refit.ts`, on the student's own machine, against
 * their own `<userData>/desk-corrections/`; a developer runs the same
 * functions from `scripts/desk-model/refit-attention.ts` against a copy of
 * such a directory, which is what makes a failing gate diagnosable without a
 * UI. `scripts/desk-model/personal-refit.ts` re-exports this file so both
 * shells and the trainer's tests name the same arithmetic.
 *
 * PURITY. No `node:*` import, no `Date`, no filesystem and no network — every
 * clock and every byte is passed in by a shell. `personal-refit.test.ts`
 * asserts the purity fence, and asserts these constants against the frozen
 * appendix in `docs/CORRECTION-LOOP.md` so the doc and the code cannot drift.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Constants — re-exported from `./constants`, which is the frozen appendix
 * §2 of docs/CORRECTION-LOOP.md and is byte-checked against it by
 * `scripts/check-contracts.mjs`. Nothing here declares a second copy.
 * ──────────────────────────────────────────────────────────────────────── */

export {
  CORRECTION_ANCHOR_EVIDENCE,
  CORRECTION_ANCHOR_L2,
  CORRECTION_BOOTSTRAP_DRAWS,
  CORRECTION_CLASS_WEIGHT_CAP,
  CORRECTION_GAUNTLET_SEED,
  CORRECTION_MAX_DRIFT_RATIO,
  CORRECTION_MAX_SLICE_DROP_PTS,
  CORRECTION_MIN_GAIN_GROUPS,
  CORRECTION_POOLED_MARGIN_PTS,
  CORRECTION_REFIT_EPOCHS,
  CORRECTION_REFIT_LR,
  CORRECTION_REFIT_MIN_EVAL_GROUPS,
  CORRECTION_REFIT_MIN_GROUPS,
  CORRECTION_REFIT_MIN_TRAIN_GROUPS,
};

/** …and the class-weight floor, which train-attention.ts writes as
 *  `Math.max(0.5, …)`. An implementation detail of the fit rather than a
 *  contract, so it lives with the fit and not in the frozen fence. */
export const CORRECTION_CLASS_WEIGHT_FLOOR = 0.5;

/**
 * The bootstrap is reported beside the gate and must not move run to run, so
 * it draws from the one seed this feature already has rather than inventing a
 * second one. Nothing in the FIT draws at all.
 */
const BOOTSTRAP_SEED = CORRECTION_GAUNTLET_SEED;

/** Output order of the head's softmax; index = class id. */
export const ATTENTION_LABELS: readonly AttentionLabel[] = ["focused", "unfocused", "phone"];

/**
 * The attention classes a CORRECTION can be about.
 *
 * `unfocused` is not one of them, and that is a fact about the product, not
 * about this pool: the paused screen offers two buttons, and neither can
 * produce it (`CorrectionLabel` in `./types` has no such member — §1.1). So a
 * pile of corrections carries **no evidence about `unfocused`** — not for it
 * and, crucially, not against it.
 *
 * WHY THIS EXISTS AS A CONSTANT. A three-way softmax over a pool with no
 * `unfocused` target treats every single frame as evidence AGAINST the class,
 * because "the answer is `focused`" is also "the answer is not `unfocused`".
 * Measured on the shipped head against the 286 committed anchors, that costs
 * `unfocused` recall 53.1% → 12.5% and pooled balanced accuracy about ten
 * points — on a pool of corrections the shipped head ALREADY AGREES WITH. The
 * `regressed-pooled` gate then refuses, correctly, and would refuse every
 * refit any student could ever produce.
 *
 * So the fit does not make that claim. `fitPersonalOutputLayer` optimises the
 * softmax over these classes only and leaves the row and bias of every other
 * class exactly as the shipped head left them. It is the same rule the
 * `kind × verdict` table already applies one level up, where an `away`
 * correction writes `attention: ""` and the attention trainer skips it
 * unchanged: evidence the student did not give is not invented.
 *
 * `docs/CORRECTION-LOOP.md § 6.3`.
 */
export const CORRECTABLE_LABELS: readonly AttentionLabel[] = ["focused", "phone"];

/** Class indices of `CORRECTABLE_LABELS` in the head's own output order. */
const CORRECTABLE_INDICES: readonly number[] = ATTENTION_LABELS.map((_, index) => index).filter(
  (index) => CORRECTABLE_LABELS.includes(ATTENTION_LABELS[index] as AttentionLabel),
);

export function isCorrectableLabel(value: unknown): value is AttentionLabel {
  return typeof value === "string" && (CORRECTABLE_LABELS as readonly string[]).includes(value);
}

/**
 * Width of the frozen bottleneck the refit fits on top of: `attention-head.
 * json` is 1280 → **16** → 3, so a personal head is a 3×16 matrix and three
 * biases — the 51 numbers. `personal-refit.test.ts` asserts this against the
 * shipped head's own layer 0 rather than trusting the comment.
 */
export const ATTENTION_HIDDEN_DIM = 16;

/* ────────────────────────────────────────────────────────────────────────
 * The head, split in two: a frozen 1280->16 bottleneck and 51 numbers
 * ──────────────────────────────────────────────────────────────────────── */

/** What the refit needs from `attention-head.json`; structurally a DeskHeadWeights. */
export interface AttentionHeadShape {
  featureDim: number;
  inputSlices?: Array<[number, number]>;
  mean: number[];
  std: number[];
  layers: Array<{ w: number[][]; b: number[] }>;
}

/** Slice the raw feature vector exactly as `applyInputSlices` does. */
export function applySlices(
  slices: Array<[number, number]> | undefined,
  vector: readonly number[],
): number[] {
  if (!slices || slices.length === 0) {
    return [...vector];
  }
  const out: number[] = [];
  for (const [start, end] of slices) {
    for (let i = start; i < end; i += 1) {
      out.push(vector[i] ?? 0);
    }
  }
  return out;
}

/**
 * The 16 activations of the frozen bottleneck: slice -> standardize -> layer 0
 * -> ReLU. This is the ONLY thing either head needs from an eval image, which
 * is what lets a 286-image held-out eval ship as a 60 KB JSON file instead of
 * 286 photographs (§7.1).
 *
 * It is the first half of `headProbabilities` in your-model.ts, and
 * `build-attention-anchors.ts` checks that claim image by image against the
 * real function before it writes anything.
 */
export function attentionHidden(head: AttentionHeadShape, vector: readonly number[]): number[] {
  const sliced = applySlices(head.inputSlices, vector);
  const layer = head.layers[0];
  if (!layer) {
    return [];
  }
  const standardized = new Array<number>(head.featureDim);
  for (let i = 0; i < head.featureDim; i += 1) {
    const std = head.std[i] ?? 1;
    standardized[i] = ((sliced[i] ?? 0) - (head.mean[i] ?? 0)) / (std > 1e-6 ? std : 1);
  }
  const out = new Array<number>(layer.b.length);
  for (let o = 0; o < layer.b.length; o += 1) {
    let sum = layer.b[o] ?? 0;
    const row = layer.w[o] ?? [];
    for (let i = 0; i < head.featureDim; i += 1) {
      sum += (row[i] ?? 0) * (standardized[i] ?? 0);
    }
    out[o] = Math.max(0, sum);
  }
  return out;
}

/** The shipped output layer, copied — theta0, and never mutated in place. */
export function shippedOutputLayer(head: AttentionHeadShape): OutputLayer {
  const last = head.layers[head.layers.length - 1];
  if (!last) {
    throw new Error("attention head has no layers");
  }
  return cloneLayer({ w: last.w, b: last.b });
}

export function cloneLayer(layer: OutputLayer): OutputLayer {
  return { w: layer.w.map((row) => [...row]), b: [...layer.b] };
}

export function softmax(logits: readonly number[]): number[] {
  let max = -Infinity;
  for (const logit of logits) {
    max = Math.max(max, logit);
  }
  const exps = logits.map((logit) => Math.exp(logit - max));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

/**
 * softmax over a SUBSET of the classes, in the order `classes` gives them.
 *
 * Used by the fit and nowhere else. Inference is always the full three-way
 * softmax — a personal head is still a 3-class head, it was just fitted
 * without pretending the student ruled out the class they were never shown.
 */
function maskedProbabilities(
  output: OutputLayer,
  hidden: readonly number[],
  classes: readonly number[],
): number[] {
  return softmax(
    classes.map((c) => {
      let sum = output.b[c] ?? 0;
      const row = output.w[c] ?? [];
      for (let i = 0; i < row.length; i += 1) {
        sum += (row[i] ?? 0) * (hidden[i] ?? 0);
      }
      return sum;
    }),
  );
}

/** softmax(W h + b) — the whole of what an output layer does. */
export function outputProbabilities(output: OutputLayer, hidden: readonly number[]): number[] {
  const logits = output.b.map((bias, o) => {
    let sum = bias;
    const row = output.w[o] ?? [];
    for (let i = 0; i < row.length; i += 1) {
      sum += (row[i] ?? 0) * (hidden[i] ?? 0);
    }
    return sum;
  });
  return softmax(logits);
}

export interface HeadPrediction {
  label: AttentionLabel;
  confidence: number;
  probs: number[];
}

export function predictFromHidden(output: OutputLayer, hidden: readonly number[]): HeadPrediction {
  const probs = outputProbabilities(output, hidden);
  let best = 0;
  for (let i = 1; i < probs.length; i += 1) {
    if ((probs[i] ?? 0) > (probs[best] ?? 0)) {
      best = i;
    }
  }
  return {
    label: ATTENTION_LABELS[best] ?? "focused",
    confidence: probs[best] ?? 0,
    probs,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The correction pool, and the weights that stop a handful dominating
 * ──────────────────────────────────────────────────────────────────────── */

export interface CorrectionFrameInput {
  /** The 16 activations of the frozen bottleneck for this frame. */
  hidden: number[];
  /** What the model said about THIS frame at the moment it paused. */
  predicted?: string;
  confidence?: number;
}

/** One correction: one student, one moment, one label — and ONE vote. */
export interface CorrectionGroupInput {
  /** "dc-0007" — also the CSV `group`. */
  id: string;
  label: AttentionLabel;
  split: "train" | "eval";
  frames: CorrectionFrameInput[];
}

export interface WeightedFrame {
  groupId: string;
  y: number;
  hidden: number[];
  /** (1 / framesInGroup) x class balance. */
  weight: number;
}

export interface PoolWeights {
  frames: WeightedFrame[];
  /** Independent corrections, per label. Frames are not samples. */
  groupsByLabel: Record<string, number>;
  classWeights: Record<string, number>;
  totalWeight: number;
}

/** Groups sorted by id, so two callers with different orders fit identically. */
function sortedGroups(groups: readonly CorrectionGroupInput[]): CorrectionGroupInput[] {
  return [...groups].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The two weightings of §6.4, in order.
 *
 * 1. GROUP NORMALISATION. Each frame starts at `1 / framesInGroup`, so three
 *    frames of one correction contribute one unit of evidence between them.
 *    This is the single most important line in the fit: without it a student
 *    whose camera happened to hold thirty frames would outvote ten students'
 *    worth of corrections.
 * 2. CLASS BALANCING, over the correction pool, with `train-attention.ts`'s
 *    own formula — `min(4, max(0.5, total / (classes x count)))` — so the two
 *    trainers cannot disagree about what class imbalance means. The unit here
 *    is a CORRECTION rather than a frame, because §6.4 says a correction is
 *    one vote; `classes` stays the head's three, as in the shipped trainer.
 *
 * The objective divides by the total weight, so a uniform scale on every
 * frame cancels: only the RELATIVE weights move the fit.
 */
export function poolWeights(groups: readonly CorrectionGroupInput[]): PoolWeights {
  const usable = sortedGroups(groups).filter((group) => group.frames.length > 0);
  const groupsByLabel: Record<string, number> = {};
  for (const group of usable) {
    groupsByLabel[group.label] = (groupsByLabel[group.label] ?? 0) + 1;
  }
  const classWeights: Record<string, number> = {};
  for (const label of Object.keys(groupsByLabel)) {
    const count = groupsByLabel[label] ?? 0;
    const raw = count > 0 ? usable.length / (ATTENTION_LABELS.length * count) : 1;
    classWeights[label] = Math.min(
      CORRECTION_CLASS_WEIGHT_CAP,
      Math.max(CORRECTION_CLASS_WEIGHT_FLOOR, raw),
    );
  }
  const frames: WeightedFrame[] = [];
  let totalWeight = 0;
  for (const group of usable) {
    const share = 1 / group.frames.length;
    const balance = classWeights[group.label] ?? 1;
    const y = ATTENTION_LABELS.indexOf(group.label);
    for (const frame of group.frames) {
      const weight = share * balance;
      totalWeight += weight;
      frames.push({ groupId: group.id, y: y < 0 ? 0 : y, hidden: frame.hidden, weight });
    }
  }
  return { frames, groupsByLabel, classWeights, totalWeight };
}

/**
 * λ = CORRECTION_ANCHOR_L2 · ANCHOR_EVIDENCE / (ANCHOR_EVIDENCE + groups),
 * a literal statement of how much evidence each side has.
 *
 * `groups` is the student's independent CORRECTIONS — all of them, the
 * held-out half included, because the ratio is about how much they have said,
 * not about how much of it this particular fit consumed. It is the arithmetic
 * docs/CORRECTION-LOOP.md §6.3 quotes: at the floor of twelve the ratio is
 * 693/705 = 0.983, and at the 120 cap it is 693/813 = 0.85.
 */
export function anchorLambda(groups: number): number {
  const g = Math.max(0, groups);
  return (
    (CORRECTION_ANCHOR_L2 * CORRECTION_ANCHOR_EVIDENCE) / (CORRECTION_ANCHOR_EVIDENCE + g)
  );
}

function frobenius(delta: OutputLayer): number {
  let sum = 0;
  for (const row of delta.w) {
    for (const value of row) {
      sum += value * value;
    }
  }
  for (const value of delta.b) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

/** ||theta - theta0|| / ||theta0||, scale-free, for the trust region. */
export function driftRatio(base: OutputLayer, fitted: OutputLayer): number {
  const delta: OutputLayer = {
    w: fitted.w.map((row, o) => row.map((value, i) => value - (base.w[o]?.[i] ?? 0))),
    b: fitted.b.map((value, o) => value - (base.b[o] ?? 0)),
  };
  const moved = frobenius(delta);
  const scale = frobenius(base);
  if (scale <= 0) {
    return moved > 0 ? Number.POSITIVE_INFINITY : 0;
  }
  return moved / scale;
}

export interface FitResult {
  output: OutputLayer;
  lambda: number;
  epochs: number;
  learningRate: number;
  driftRatio: number;
  groups: number;
  frames: number;
  weights: PoolWeights;
}

/**
 * The fit: 300 full-batch gradient steps on the OUTPUT LAYER ONLY, anchored to
 * the shipped one.
 *
 *   L(θ) = ( Σ w_i · crossEntropy(softmax_C(W h_i + b), y_i) ) / Σ w_i
 *        + λ · ‖θ − θ₀‖²
 *
 * `softmax_C` runs over `CORRECTABLE_LABELS` — the classes a correction can
 * actually be about — and the rows of every other class come out byte-identical
 * to θ₀. That is not a shortcut: a pool with no `unfocused` target carries no
 * evidence about `unfocused`, and a three-way softmax would silently read it as
 * evidence against, which measurably destroys that class and makes the
 * no-regression gate unpassable for every student. See `CORRECTABLE_LABELS`.
 *
 * The 1280→16 representation, the slice, the mean and the std are the shipped
 * ones and are physically not in the object this returns — which is what makes
 * "a gradient step cannot wreck a head fitted on thousands of images" a
 * property of the file format rather than a hope.
 *
 * With no usable corrections it returns θ₀ unchanged, which is the honest
 * answer and also what keeps the gate's numbers meaningful when the pool is
 * empty: the personal column is then the shipped column, to the last digit.
 */
export function fitPersonalOutputLayer(
  base: OutputLayer,
  groups: readonly CorrectionGroupInput[],
  /**
   * Corrections behind λ. Defaults to the pool being fitted; `evaluateRefit`
   * passes the student's TOTAL, held-out half included, which is the count
   * §6.3's arithmetic uses.
   */
  lambdaGroups?: number,
): FitResult {
  // A group whose label no correction can produce is not evidence this fit
  // knows how to read. Today `correctionPool` cannot hand one over — the two
  // buttons produce `focused` and `phone` — so this only fires on a
  // hand-edited index, and it drops that group rather than making up a target.
  const correctable = groups.filter((group) => isCorrectableLabel(group.label));
  const weights = poolWeights(correctable);
  const groupCount = Object.values(weights.groupsByLabel).reduce((sum, n) => sum + n, 0);
  const lambda = anchorLambda(lambdaGroups ?? groupCount);
  const output = cloneLayer(base);
  if (weights.frames.length === 0 || weights.totalWeight <= 0) {
    return {
      output,
      lambda,
      epochs: CORRECTION_REFIT_EPOCHS,
      learningRate: CORRECTION_REFIT_LR,
      driftRatio: 0,
      groups: groupCount,
      frames: 0,
      weights,
    };
  }
  // The trainable rows, and only those. Every other row of `output` is still
  // the clone of θ₀ made above and is never written to again, so a personal
  // head cannot move a class the student was never asked about.
  const trainable = CORRECTABLE_INDICES.filter((index) => index < base.b.length);
  const dim = base.w[0]?.length ?? 0;
  for (let epoch = 0; epoch < CORRECTION_REFIT_EPOCHS; epoch += 1) {
    const gradW: number[][] = trainable.map(() => new Array<number>(dim).fill(0));
    const gradB = trainable.map(() => 0);
    for (const frame of weights.frames) {
      // softmax over the correctable classes only: the frozen class takes no
      // probability mass here, so no frame is read as evidence against it.
      const probs = maskedProbabilities(output, frame.hidden, trainable);
      trainable.forEach((c, k) => {
        const error = ((probs[k] ?? 0) - (c === frame.y ? 1 : 0)) * frame.weight;
        gradB[k] = (gradB[k] ?? 0) + error;
        const row = gradW[k] as number[];
        for (let i = 0; i < dim; i += 1) {
          row[i] = (row[i] ?? 0) + error * (frame.hidden[i] ?? 0);
        }
      });
    }
    trainable.forEach((c, k) => {
      const row = gradW[k] as number[];
      const outRow = output.w[c] as number[];
      const baseRow = base.w[c] ?? [];
      for (let i = 0; i < dim; i += 1) {
        // d/dθ of the anchored objective: the data term is a weighted MEAN,
        // and the anchor pulls toward the SHIPPED weight rather than zero.
        const grad =
          (row[i] ?? 0) / weights.totalWeight +
          2 * lambda * ((outRow[i] ?? 0) - (baseRow[i] ?? 0));
        outRow[i] = (outRow[i] ?? 0) - CORRECTION_REFIT_LR * grad;
      }
      const gradBias =
        (gradB[k] ?? 0) / weights.totalWeight +
        2 * lambda * ((output.b[c] ?? 0) - (base.b[c] ?? 0));
      output.b[c] = (output.b[c] ?? 0) - CORRECTION_REFIT_LR * gradBias;
    });
  }
  return {
    output,
    lambda,
    epochs: CORRECTION_REFIT_EPOCHS,
    learningRate: CORRECTION_REFIT_LR,
    driftRatio: driftRatio(base, output),
    groups: groupCount,
    frames: weights.frames.length,
    weights,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Scoring: balanced accuracy over the classes PRESENT, and one vote per
 * correction on the student's own held-out half
 * ──────────────────────────────────────────────────────────────────────── */

interface Tally {
  truth: AttentionLabel;
  predicted: AttentionLabel;
}

function scoreTallies(tallies: readonly Tally[], images: number, groups: number): SliceScore {
  const total = new Map<AttentionLabel, number>();
  const correct = new Map<AttentionLabel, number>();
  let hits = 0;
  let phoneTp = 0;
  let phoneFp = 0;
  let phoneFn = 0;
  for (const { truth, predicted } of tallies) {
    total.set(truth, (total.get(truth) ?? 0) + 1);
    if (truth === predicted) {
      hits += 1;
      correct.set(truth, (correct.get(truth) ?? 0) + 1);
    }
    if (predicted === "phone" && truth === "phone") {
      phoneTp += 1;
    } else if (predicted === "phone") {
      phoneFp += 1;
    } else if (truth === "phone") {
      phoneFn += 1;
    }
  }
  // Macro-recall over the classes present. A slice with no `unfocused` image
  // (the 86 proxies) averages over the two classes it actually has, and
  // `presentLabels` says which those were rather than quietly averaging over
  // a class with no images in it.
  const presentLabels = ATTENTION_LABELS.filter((label) => (total.get(label) ?? 0) > 0);
  const balanced =
    presentLabels.length === 0
      ? 0
      : presentLabels.reduce(
          (sum, label) => sum + (correct.get(label) ?? 0) / (total.get(label) ?? 1),
          0,
        ) / presentLabels.length;
  const precision = phoneTp + phoneFp > 0 ? phoneTp / (phoneTp + phoneFp) : 0;
  const recall = phoneTp + phoneFn > 0 ? phoneTp / (phoneTp + phoneFn) : 0;
  return {
    images,
    groups,
    accuracy: tallies.length > 0 ? hits / tallies.length : 0,
    balanced,
    presentLabels,
    phone: {
      precision,
      recall,
      f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
      support: phoneTp + phoneFn,
    },
  };
}

/**
 * One anchor is one image and one group: the stock eval's near-duplicate
 * groups were already resolved when the split was made, so `groups === images`
 * here and the field is carried anyway, because a number without its group
 * count is not constructible.
 */
export function scoreAnchorSlice(
  output: OutputLayer,
  rows: readonly AttentionAnchorRow[],
): SliceScore {
  const tallies = rows.map((row) => ({
    truth: row.truth,
    predicted: predictFromHidden(output, row.hidden).label,
  }));
  return scoreTallies(tallies, rows.length, rows.length);
}

export interface GroupVote {
  id: string;
  truth: AttentionLabel;
  predicted: AttentionLabel;
  frames: number;
  /** Frames that voted for the winning label. */
  votes: number;
  correct: boolean;
}

/**
 * A correction is one vote however many frames it carries: majority vote over
 * its frames. A TIE resolves to the model's own most confident frame among the
 * tied labels — the head's own opinion breaks its own tie, and the rule is
 * pinned by a test rather than left to array order.
 */
export function voteCorrection(output: OutputLayer, group: CorrectionGroupInput): GroupVote {
  const predictions = group.frames.map((frame) => predictFromHidden(output, frame.hidden));
  const votes = new Map<AttentionLabel, number>();
  for (const prediction of predictions) {
    votes.set(prediction.label, (votes.get(prediction.label) ?? 0) + 1);
  }
  let best = 0;
  for (const count of votes.values()) {
    best = Math.max(best, count);
  }
  const tied = [...votes.entries()].filter(([, count]) => count === best).map(([label]) => label);
  let winner: AttentionLabel = tied[0] ?? "focused";
  if (tied.length > 1) {
    let bestConfidence = -1;
    for (const prediction of predictions) {
      if (tied.includes(prediction.label) && prediction.confidence > bestConfidence) {
        bestConfidence = prediction.confidence;
        winner = prediction.label;
      }
    }
  }
  return {
    id: group.id,
    truth: group.label,
    predicted: winner,
    frames: group.frames.length,
    votes: best,
    correct: winner === group.label,
  };
}

export interface HoldoutScore {
  score: SliceScore | null;
  correct: number;
  votes: GroupVote[];
}

/** The student's held-out corrections, scored in CORRECTIONS and never frames. */
export function scoreHoldout(
  output: OutputLayer,
  groups: readonly CorrectionGroupInput[],
): HoldoutScore {
  const usable = sortedGroups(groups).filter((group) => group.frames.length > 0);
  if (usable.length === 0) {
    return { score: null, correct: 0, votes: [] };
  }
  const votes = usable.map((group) => voteCorrection(output, group));
  const images = usable.reduce((sum, group) => sum + group.frames.length, 0);
  const score = scoreTallies(
    votes.map((vote) => ({ truth: vote.truth, predicted: vote.predicted })),
    images,
    usable.length,
  );
  return { score, correct: votes.filter((vote) => vote.correct).length, votes };
}

export function scoreAll(
  output: OutputLayer,
  anchors: AttentionAnchors,
  holdout: readonly CorrectionGroupInput[],
): RefitScores {
  const rows = anchors.rows;
  const personal = scoreHoldout(output, holdout);
  return {
    pooled: scoreAnchorSlice(output, rows),
    adaption: scoreAnchorSlice(
      output,
      rows.filter((row) => row.slice === "adaption"),
    ),
    proxy: scoreAnchorSlice(
      output,
      rows.filter((row) => row.slice === "proxy"),
    ),
    personalHoldout: personal.score,
    personalHoldoutGroupsCorrect: personal.correct,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The interval printed BESIDE the gate, never as the gate
 * ──────────────────────────────────────────────────────────────────────── */

/** Deterministic PRNG — the same one the desk trainers use (lib.ts). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function balancedOf(
  truths: readonly AttentionLabel[],
  predictions: readonly AttentionLabel[],
  indices: readonly number[],
): number {
  const total = new Map<AttentionLabel, number>();
  const correct = new Map<AttentionLabel, number>();
  for (const index of indices) {
    const truth = truths[index] as AttentionLabel;
    total.set(truth, (total.get(truth) ?? 0) + 1);
    if (predictions[index] === truth) {
      correct.set(truth, (correct.get(truth) ?? 0) + 1);
    }
  }
  const present = [...total.keys()];
  if (present.length === 0) {
    return 0;
  }
  return (
    present.reduce((sum, label) => sum + (correct.get(label) ?? 0) / (total.get(label) ?? 1), 0) /
    present.length
  );
}

/**
 * Paired bootstrap of (personal − shipped) balanced accuracy over the pooled
 * anchors, in POINTS. Paired because the two heads score the same images: the
 * draw picks images, and both heads are scored on that same draw.
 *
 * With 286 items and 51 refit parameters this interval will usually straddle
 * zero, and the honest sentence then is "no measurable difference on stock
 * photos". That is the CORRECT outcome for a no-regression gate and must not
 * be dressed up as an improvement — which is why this is reported beside the
 * gate and the gate never reads it.
 */
export function pairedBootstrap(
  shipped: OutputLayer,
  personal: OutputLayer,
  rows: readonly AttentionAnchorRow[],
  draws: number = CORRECTION_BOOTSTRAP_DRAWS,
): RefitInterval | null {
  if (rows.length === 0 || draws <= 0) {
    return null;
  }
  const truths = rows.map((row) => row.truth);
  const shippedPredictions = rows.map((row) => predictFromHidden(shipped, row.hidden).label);
  const personalPredictions = rows.map((row) => predictFromHidden(personal, row.hidden).label);
  const all = rows.map((_, index) => index);
  const point =
    (balancedOf(truths, personalPredictions, all) - balancedOf(truths, shippedPredictions, all)) *
    100;
  const rand = mulberry32(BOOTSTRAP_SEED);
  const deltas: number[] = [];
  const indices = new Array<number>(rows.length);
  for (let draw = 0; draw < draws; draw += 1) {
    for (let i = 0; i < rows.length; i += 1) {
      indices[i] = Math.floor(rand() * rows.length);
    }
    deltas.push(
      (balancedOf(truths, personalPredictions, indices) -
        balancedOf(truths, shippedPredictions, indices)) *
        100,
    );
  }
  deltas.sort((a, b) => a - b);
  const at = (q: number): number =>
    deltas[Math.min(deltas.length - 1, Math.max(0, Math.round(q * (deltas.length - 1))))] ?? 0;
  return { point, lo: at(0.025), hi: at(0.975), draws };
}

/* ────────────────────────────────────────────────────────────────────────
 * The gate
 * ──────────────────────────────────────────────────────────────────────── */

export interface RefitGateInput {
  /** Epoch ms, passed in — nothing here reads a clock. */
  at: number;
  deskModelId: string;
  sessionActive: boolean;
  /** sha256(attention-head.json).slice(0, 16) of the head that is running. */
  baseHeadHash: string;
  anchors: AttentionAnchors;
  anchorsHash: string;
  base: OutputLayer;
  /** Every usable attention-head correction, train and eval. */
  groups: readonly CorrectionGroupInput[];
  /**
   * Corrections whose cached activations were computed against a DIFFERENT
   * head and could not be recomputed. They are excluded from the pool above,
   * and any at all fails `stale-base`: an activation for another layer 0 is a
   * wrong number, and dropping wrong numbers quietly would change what the
   * student's corrections mean without saying so.
   */
  staleGroups?: number;
  /** Dev-only `{ gate: "off" }`: skips gates 8-10 and stamps itself. */
  gateEnforced?: boolean;
  bootstrapDraws?: number;
}

export interface RefitOutcome {
  report: RefitReport;
  /** The 51 numbers, ONLY when the gate installed them. */
  personal: OutputLayer | null;
  fit: FitResult;
}

const pts = (value: number): string => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)} pts`;
const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;

/**
 * Eleven gates, in this order; the FIRST failure is `blockedBy` and the rest
 * are still reported. Exactly the shape of `PlanTrendGate`, and of the
 * forecast's CI gate before it.
 *
 * Gates 1-7 are preconditions. When one of them fails the fit is not run at
 * all — a fit over activations that belong to another head, or over four
 * corrections, is not a thing worth scoring — and the personal column then
 * holds the SHIPPED head's numbers, because θ = θ₀ is exactly what would have
 * been installed. Gates 8-10 are the comparison the whole feature exists for.
 */
export function evaluateRefit(input: RefitGateInput): RefitOutcome {
  const gateEnforced = input.gateEnforced !== false;
  const staleGroups = input.staleGroups ?? 0;
  const usable = sortedGroups(input.groups).filter((group) => group.frames.length > 0);
  const train = usable.filter((group) => group.split === "train");
  const holdout = usable.filter((group) => group.split === "eval");
  const frames = usable.reduce((sum, group) => sum + group.frames.length, 0);
  const byLabel: Record<string, number> = {};
  for (const group of usable) {
    byLabel[group.label] = (byLabel[group.label] ?? 0) + 1;
  }

  const preconditions: RefitGateResult[] = [
    {
      id: "not-custom-model",
      passed: input.deskModelId === "custom",
      detail:
        input.deskModelId === "custom"
          ? "The trained desk model is running, so there is an attention head to refit."
          : `The desk model is "${input.deskModelId}" — there is no attention head to refit, and nothing here can run without one.`,
    },
    {
      id: "session-active",
      passed: !input.sessionActive,
      detail: input.sessionActive
        ? "A session is running. The instrument does not change mid-measurement, and the refit does not compete with the enforcement loop for CPU."
        : "No session is running.",
    },
    {
      id: "too-few-corrections",
      passed: usable.length >= CORRECTION_REFIT_MIN_GROUPS,
      detail:
        `${usable.length} attention correction(s) usable, ${CORRECTION_REFIT_MIN_GROUPS} needed. ` +
        `Corrections, not frames: this pool holds ${frames} photo(s).` +
        (staleGroups > 0
          ? ` ${staleGroups} more were left out because their activations belong to another head — see stale-base below.`
          : ""),
    },
    {
      id: "too-few-train-groups",
      passed: train.length >= CORRECTION_REFIT_MIN_TRAIN_GROUPS,
      detail: `${train.length} correction(s) on the train side, ${CORRECTION_REFIT_MIN_TRAIN_GROUPS} needed.`,
    },
    {
      id: "too-few-eval-groups",
      passed: holdout.length >= CORRECTION_REFIT_MIN_EVAL_GROUPS,
      detail: `${holdout.length} correction(s) held out, ${CORRECTION_REFIT_MIN_EVAL_GROUPS} needed. A refit that cannot be checked against corrections it never saw is not a refit worth installing.`,
    },
    {
      id: "stale-base",
      passed: staleGroups === 0,
      detail:
        staleGroups === 0
          ? `Every stored activation was computed against the running head (${input.baseHeadHash}).`
          : `${staleGroups} correction(s) carry activations computed against a different attention head. They were left out; run the refit again once they have been recomputed from their photos.`,
    },
    {
      id: "stale-anchors",
      passed: input.anchors.baseHeadHash === input.baseHeadHash && input.anchors.rows.length > 0,
      detail:
        input.anchors.rows.length === 0
          ? "The held-out anchor pack is empty, so there is nothing to score either head on. Rebuild it with `npm run anchors:attention`."
          : input.anchors.baseHeadHash === input.baseHeadHash
            ? `The anchor pack was built against the running head (${input.baseHeadHash}) — ${input.anchors.rows.length} held-out image(s).`
            : `The anchor pack was built against head ${input.anchors.baseHeadHash} but ${input.baseHeadHash} is running, so its activations mean nothing here. Rebuild it with \`npm run anchors:attention\`.`,
    },
  ];
  const blockedByPrecondition = preconditions.find((gate) => !gate.passed)?.id ?? null;

  // Nothing is fitted while a precondition is failing: the personal column
  // then IS the shipped column, which is the truthful reading of "no personal
  // head was produced".
  const fit = blockedByPrecondition
    ? fitPersonalOutputLayer(input.base, [], usable.length)
    : fitPersonalOutputLayer(input.base, train, usable.length);

  const shipped = scoreAll(input.base, input.anchors, holdout);
  const personalScores = scoreAll(fit.output, input.anchors, holdout);

  const pooledMargin = personalScores.pooled.balanced - shipped.pooled.balanced;
  const adaptionDrop = shipped.adaption.balanced - personalScores.adaption.balanced;
  const proxyDrop = shipped.proxy.balanced - personalScores.proxy.balanced;
  const worstSlice = adaptionDrop >= proxyDrop ? "Adaption" : "proxy";
  const worstDrop = Math.max(adaptionDrop, proxyDrop);
  const gain = personalScores.personalHoldoutGroupsCorrect - shipped.personalHoldoutGroupsCorrect;

  const comparisons: RefitGateResult[] = [
    {
      id: "drifted-too-far",
      passed: fit.driftRatio <= CORRECTION_MAX_DRIFT_RATIO,
      detail: `The refit moved the output layer ${(fit.driftRatio * 100).toFixed(1)}% of its own size; the trust region is ${(CORRECTION_MAX_DRIFT_RATIO * 100).toFixed(0)}%.`,
    },
    {
      id: "regressed-pooled",
      passed: pooledMargin * 100 >= CORRECTION_POOLED_MARGIN_PTS,
      detail: `Balanced accuracy on all ${input.anchors.rows.length} held-out stock images: shipped ${pct(shipped.pooled.balanced)}, personal ${pct(personalScores.pooled.balanced)} (${pts(pooledMargin)}). The bar is "must not be beaten".`,
    },
    {
      id: "regressed-slice",
      passed: worstDrop * 100 <= CORRECTION_MAX_SLICE_DROP_PTS,
      detail: `Worst slice drop ${pts(-worstDrop)} on the ${worstSlice} slice (tolerance ${CORRECTION_MAX_SLICE_DROP_PTS} pts). Adaption ${pct(shipped.adaption.balanced)} → ${pct(personalScores.adaption.balanced)} over ${shipped.adaption.images} image(s); proxy ${pct(shipped.proxy.balanced)} → ${pct(personalScores.proxy.balanced)} over ${shipped.proxy.images} image(s).`,
    },
    {
      id: "no-personal-gain",
      passed: gain >= CORRECTION_MIN_GAIN_GROUPS,
      detail:
        holdout.length === 0
          ? "There are no held-out corrections to gain on."
          : `On your ${holdout.length} held-out correction(s) the personal head agrees with you on ${personalScores.personalHoldoutGroupsCorrect} and the shipped head agrees on ${shipped.personalHoldoutGroupsCorrect} — ${gain >= 0 ? "+" : ""}${gain}, and it needs +${CORRECTION_MIN_GAIN_GROUPS}. A head that merely did no harm is not worth installing.`,
    },
  ];

  const gates = [...preconditions, ...comparisons];
  const blockedBy = gates.find((gate) => !gate.passed)?.id ?? null;
  // The escape hatch skips the three COMPARISONS (§7.5) and nothing else: a
  // refit with four corrections against stale anchors is not a claim anyone
  // can turn off, it is arithmetic that did not happen.
  const skippable: ReadonlySet<RefitGateId> = new Set<RefitGateId>([
    "regressed-pooled",
    "regressed-slice",
    "no-personal-gain",
  ]);
  const blocking = gates.filter(
    (gate) => !gate.passed && (gateEnforced || !skippable.has(gate.id)),
  );
  const installed = blocking.length === 0;

  const report: RefitReport = {
    v: 1,
    at: input.at,
    baseHeadHash: input.baseHeadHash,
    anchorsHash: input.anchorsHash,
    lambda: fit.lambda,
    epochs: fit.epochs,
    learningRate: fit.learningRate,
    driftRatio: fit.driftRatio,
    corrections: {
      total: usable.length,
      trainGroups: train.length,
      evalGroups: holdout.length,
      frames,
      byLabel,
      trainIds: train.map((group) => group.id),
      evalIds: holdout.map((group) => group.id),
    },
    shipped,
    personal: personalScores,
    gates,
    blockedBy,
    pooledMarginCi95: blockedByPrecondition
      ? null
      : pairedBootstrap(
          input.base,
          fit.output,
          input.anchors.rows,
          input.bootstrapDraws ?? CORRECTION_BOOTSTRAP_DRAWS,
        ),
    installed,
    gateEnforced,
  };

  return { report, personal: installed ? cloneLayer(fit.output) : null, fit };
}

/** "shipped" / "personal" — what the app will actually run after this refit. */
export function activeHead(report: RefitReport): "shipped" | "personal" {
  return report.installed ? "personal" : "shipped";
}

/* ────────────────────────────────────────────────────────────────────────
 * Is this personal head loadable at all?
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * `true` when `value` is a personal head the running attention head can
 * actually wear: same base, same labels, and a 3×16 output layer that fits
 * where the shipped one came out.
 *
 * ONE PREDICATE, TWO CALLERS, and that is the whole reason it is here. The
 * desk model decides with it whether to swap the layer in; the corrections
 * service decides with it what to put on screen under *Which head is running*.
 * If those two disagreed the app would run one head and claim the other — the
 * exact failure this feature exists to stop, one level up — so neither is
 * allowed its own opinion about what a usable head is.
 *
 * A mismatch is not an error and is never repaired here. An app update that
 * ships a new `attention-head.json` changes `baseHeadHash`, the student's 51
 * numbers stop applying, and BOTH callers fall back to the shipped head until
 * the next refit produces a head for the new base. Silently rescaling, or
 * loading it anyway, would run a boundary fitted against a bottleneck that is
 * no longer there.
 *
 * `docs/CORRECTION-LOOP.md § 8`.
 */
export function personalHeadFits(
  value: unknown,
  baseHeadHash: string,
  hiddenDim: number,
  labelCount: number,
): value is PersonalAttentionHead {
  const head = value as PersonalAttentionHead | null;
  if (typeof head !== "object" || head === null || head.v !== 1) {
    return false;
  }
  if (typeof head.baseHeadHash !== "string" || head.baseHeadHash.length === 0) {
    return false;
  }
  // An empty running hash means the shipped head could not be read at all.
  // Nothing is comparable to that, so nothing is worn on top of it.
  if (baseHeadHash.length === 0 || head.baseHeadHash !== baseHeadHash) {
    return false;
  }
  if (
    !Array.isArray(head.labels) ||
    head.labels.length !== ATTENTION_LABELS.length ||
    head.labels.some((label, index) => label !== ATTENTION_LABELS[index])
  ) {
    return false;
  }
  const output = head.output;
  if (typeof output !== "object" || output === null) {
    return false;
  }
  if (!Array.isArray(output.b) || output.b.length !== labelCount) {
    return false;
  }
  if (!output.b.every((bias) => typeof bias === "number" && Number.isFinite(bias))) {
    return false;
  }
  if (!Array.isArray(output.w) || output.w.length !== labelCount) {
    return false;
  }
  return output.w.every(
    (row) =>
      Array.isArray(row) &&
      row.length === hiddenDim &&
      row.every((weight) => typeof weight === "number" && Number.isFinite(weight)),
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The pool: which stored corrections a fit is allowed to see
 * ──────────────────────────────────────────────────────────────────────── */

/** As much of a stored `DeskCorrectionFrame` as a refit reads. */
export interface PoolFrame {
  file: string;
  predicted: string;
  confidence: number;
  hidden: number[] | null;
  hiddenFor: string | null;
}

/** As much of a stored `DeskCorrection` as a refit reads. A real
 *  `DeskCorrection` is structurally one of these, and so is the trainer's
 *  `StoredCorrection`, which is what lets both shells share this. */
export interface PoolCorrection {
  id: string;
  label: string;
  head: string;
  split: "train" | "eval";
  frames: readonly PoolFrame[];
  capped: boolean;
}


function isAttentionLabel(value: unknown): value is AttentionLabel {
  return typeof value === "string" && (ATTENTION_LABELS as readonly string[]).includes(value);
}
export interface CorrectionPool {
  /** Corrections the fit and the gate may use. */
  groups: CorrectionGroupInput[];
  /** Attention corrections whose activations belong to another head. */
  stale: string[];
  /** Attention corrections with no usable activations at all. */
  missing: string[];
  /** Presence corrections and capped records: evidence for another head, or none. */
  skipped: string[];
}

/**
 * The stored records, as the fit sees them.
 *
 * Three exclusions, each of which is counted and named rather than silently
 * applied: a `presence` correction makes no attention claim (an `away`
 * correction never trains this head — §1.3); a capped record deliberately kept
 * no photos; and a frame whose `hiddenFor` names a different head carries a
 * number computed from a layer 0 that is no longer running. The last of those
 * fails the `stale-base` gate rather than being quietly dropped.
 */
export function correctionPool(
  corrections: readonly PoolCorrection[],
  baseHeadHash: string,
): CorrectionPool {
  const groups: CorrectionGroupInput[] = [];
  const stale: string[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  for (const record of corrections) {
    if (record.head !== "attention" || !isAttentionLabel(record.label)) {
      skipped.push(record.id);
      continue;
    }
    if (record.frames.length === 0) {
      (record.capped ? skipped : missing).push(record.id);
      continue;
    }
    const usable = record.frames.filter(
      (frame) => frame.hidden !== null && frame.hiddenFor === baseHeadHash,
    );
    const wrongHead = record.frames.filter(
      (frame) => frame.hidden !== null && frame.hiddenFor !== baseHeadHash,
    );
    if (usable.length === 0) {
      (wrongHead.length > 0 ? stale : missing).push(record.id);
      continue;
    }
    if (wrongHead.length > 0) {
      stale.push(record.id);
      continue;
    }
    groups.push({
      id: record.id,
      label: record.label,
      split: record.split,
      frames: usable.map((frame) => ({
        hidden: frame.hidden as number[],
        predicted: frame.predicted,
        confidence: frame.confidence,
      })),
    });
  }
  return { groups, stale, missing, skipped };
}
