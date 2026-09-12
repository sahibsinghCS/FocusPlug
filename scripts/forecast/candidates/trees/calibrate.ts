/**
 * Probability calibration for the trees contender.
 *
 * A boosted ensemble's margin is not logistic-shaped, and a 2-parameter Platt
 * fit visibly under-confidences the mid-range on this data (predicted 0.15
 * where the observed rate is 0.37) — which does not move any ranking metric,
 * but silently wrecks every threshold-crossing metric, because the escalation
 * reducer compares a calibrated risk against frozen 0.55 / 0.80 lines.
 *
 * So both calibrators are fitted (on cross-fitted out-of-fold margins) and the
 * choice between them is made by 5-fold SESSION-LEVEL cross-validation scored
 * with importance-weighted log loss (a proper scoring rule). Everything here
 * sees TRAIN sessions only.
 */

import { fnv1a32 } from "../../../../src/shared/forecast/hash";

export type Calibrator =
  | { type: "platt"; a: number; b: number }
  | { type: "isotonic"; x: number[]; p: number[] };

const EPS = 1e-6;

function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

export function fitPlattCalibrator(
  margins: readonly number[] | Float64Array,
  labels: readonly number[] | Float64Array | Uint8Array,
  weights: readonly number[] | Float64Array,
  index: readonly number[],
): Calibrator {
  let a = 1;
  let b = 0;
  for (let iter = 0; iter < 100; iter += 1) {
    let ga = 0;
    let gb = 0;
    let haa = 1e-9;
    let hab = 0;
    let hbb = 1e-9;
    for (const i of index) {
      const z = margins[i] as number;
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
  return { type: "platt", a, b };
}

/**
 * Weighted isotonic regression (PAVA) on equal-weight margin bins, exposed as
 * a piecewise-linear monotone map. Binning first is what keeps it from
 * memorizing individual frames; the map is monotone in the margin, so no
 * ranking metric can change by a single tie.
 */
export function fitIsotonicCalibrator(
  margins: readonly number[] | Float64Array,
  labels: readonly number[] | Float64Array | Uint8Array,
  weights: readonly number[] | Float64Array,
  index: readonly number[],
  binCount = 1200,
): Calibrator {
  const sorted = [...index].sort((i, j) => (margins[i] as number) - (margins[j] as number));
  let totalWeight = 0;
  for (const i of sorted) {
    totalWeight += weights[i] as number;
  }
  const perBin = totalWeight / Math.max(1, binCount);

  const binX: number[] = [];
  const binY: number[] = [];
  const binW: number[] = [];
  let accW = 0;
  let accXW = 0;
  let accYW = 0;
  for (const i of sorted) {
    const w = weights[i] as number;
    accW += w;
    accXW += w * (margins[i] as number);
    accYW += w * (labels[i] as number);
    if (accW >= perBin) {
      binX.push(accXW / accW);
      binY.push(accYW / accW);
      binW.push(accW);
      accW = 0;
      accXW = 0;
      accYW = 0;
    }
  }
  if (accW > 0) {
    binX.push(accXW / accW);
    binY.push(accYW / accW);
    binW.push(accW);
  }

  // Pool-adjacent-violators on the binned means.
  const valueStack: number[] = [];
  const weightStack: number[] = [];
  const countStack: number[] = [];
  for (let b = 0; b < binY.length; b += 1) {
    let value = binY[b] as number;
    let w = binW[b] as number;
    let count = 1;
    while (
      valueStack.length > 0 &&
      (valueStack[valueStack.length - 1] as number) > value
    ) {
      const pv = valueStack.pop() as number;
      const pw = weightStack.pop() as number;
      const pc = countStack.pop() as number;
      value = (value * w + pv * pw) / (w + pw);
      w += pw;
      count += pc;
    }
    valueStack.push(value);
    weightStack.push(w);
    countStack.push(count);
  }
  const fitted: number[] = [];
  for (let s = 0; s < valueStack.length; s += 1) {
    for (let c = 0; c < (countStack[s] as number); c += 1) {
      fitted.push(valueStack[s] as number);
    }
  }

  // Collapse duplicate x (can happen with heavy ties in the margin).
  const x: number[] = [];
  const p: number[] = [];
  for (let b = 0; b < binX.length; b += 1) {
    const xb = binX[b] as number;
    if (x.length > 0 && xb <= (x[x.length - 1] as number)) {
      p[p.length - 1] = Math.max(p[p.length - 1] as number, fitted[b] as number);
      continue;
    }
    x.push(xb);
    p.push(Math.min(1 - 1e-3, Math.max(1e-4, fitted[b] as number)));
  }
  return { type: "isotonic", x, p };
}

/**
 * Isotonic maps are monotone but FLAT wherever PAVA pooled — and a flat region
 * turns distinct margins into identical risks, i.e. ties, which silently costs
 * ranking AUC. `TIE_BREAK` mixes in a vanishing, strictly increasing sigmoid so
 * the map is strictly monotone again: the ranking (and therefore every AUC) is
 * exactly the raw margin's, while no probability moves by more than 1e-6.
 */
const TIE_BREAK = 1e-6;

export function applyCalibrator(cal: Calibrator, margin: number): number {
  if (cal.type === "platt") {
    return sigmoid(cal.a * margin + cal.b);
  }
  const { x, p } = cal;
  if (x.length === 0) {
    return 0;
  }
  let value: number;
  if (margin <= (x[0] as number)) {
    value = p[0] as number;
  } else if (margin >= (x[x.length - 1] as number)) {
    value = p[p.length - 1] as number;
  } else {
    let lo = 0;
    let hi = x.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((x[mid] as number) <= margin) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const x0 = x[lo] as number;
    const x1 = x[hi] as number;
    const p0 = p[lo] as number;
    const p1 = p[hi] as number;
    const t = x1 > x0 ? (margin - x0) / (x1 - x0) : 0;
    value = p0 + t * (p1 - p0);
  }
  return value * (1 - TIE_BREAK) + TIE_BREAK * sigmoid(margin);
}

/** Highest risk the calibrator can emit — if it is below the 0.80 pre-arm line, the pre-arm band is unreachable. */
export function maxAttainableRisk(cal: Calibrator): number {
  if (cal.type === "platt") {
    return applyCalibrator(cal, 40);
  }
  return applyCalibrator(cal, (cal.x[cal.x.length - 1] as number) + 1e-9);
}

function weightedLogLoss(
  cal: Calibrator,
  margins: readonly number[] | Float64Array,
  labels: readonly number[] | Float64Array | Uint8Array,
  weights: readonly number[] | Float64Array,
  index: readonly number[],
): number {
  let loss = 0;
  let total = 0;
  for (const i of index) {
    const p = Math.min(1 - EPS, Math.max(EPS, applyCalibrator(cal, margins[i] as number)));
    const y = labels[i] as number;
    const w = weights[i] as number;
    loss += -w * (y * Math.log(p) + (1 - y) * Math.log(1 - p));
    total += w;
  }
  return total > 0 ? loss / total : 0;
}

export interface CalibratorChoice {
  calibrator: Calibrator;
  chosen: "platt" | "isotonic";
  cvLogLoss: { platt: number; isotonic: number };
  folds: number;
}

/**
 * Picks between Platt and isotonic by 5-fold session-level CV inside the
 * calibration split, then refits the winner on all of it.
 */
export function chooseCalibrator(
  margins: Float64Array,
  labels: Uint8Array,
  weights: Float64Array,
  sessionIds: readonly string[],
  seed: number,
  folds = 5,
): CalibratorChoice {
  const all = Array.from({ length: margins.length }, (_, i) => i);
  const foldOf = all.map(
    (i) => fnv1a32(`trees-cal-fold:${seed}:${sessionIds[i] as string}`) % folds,
  );
  const losses = { platt: 0, isotonic: 0 };
  let totalHeld = 0;
  for (let k = 0; k < folds; k += 1) {
    const fit = all.filter((i) => (foldOf[i] as number) !== k);
    const held = all.filter((i) => (foldOf[i] as number) === k);
    if (held.length === 0 || fit.length === 0) {
      continue;
    }
    const platt = fitPlattCalibrator(margins, labels, weights, fit);
    const isotonic = fitIsotonicCalibrator(margins, labels, weights, fit);
    let heldWeight = 0;
    for (const i of held) {
      heldWeight += weights[i] as number;
    }
    losses.platt += weightedLogLoss(platt, margins, labels, weights, held) * heldWeight;
    losses.isotonic += weightedLogLoss(isotonic, margins, labels, weights, held) * heldWeight;
    totalHeld += heldWeight;
  }
  const cvLogLoss = {
    platt: totalHeld > 0 ? losses.platt / totalHeld : Number.POSITIVE_INFINITY,
    isotonic: totalHeld > 0 ? losses.isotonic / totalHeld : Number.POSITIVE_INFINITY,
  };
  const chosen = cvLogLoss.isotonic < cvLogLoss.platt ? "isotonic" : "platt";
  const calibrator =
    chosen === "isotonic"
      ? fitIsotonicCalibrator(margins, labels, weights, all)
      : fitPlattCalibrator(margins, labels, weights, all);
  return { calibrator, chosen, cvLogLoss, folds };
}
