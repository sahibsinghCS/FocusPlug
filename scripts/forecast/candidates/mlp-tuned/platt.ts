import { sigmoid } from "./net";

/**
 * Importance-weighted Platt scaling σ(a·z + b) by Newton's method — the same
 * routine `scripts/forecast/train.ts` uses (it is a local function there, not
 * an export, so it is reproduced rather than edited into shared code).
 *
 * Weights are 1/keep-probability, so the calibrated risk targets the NATURAL
 * prevalence of the world, not the rebalanced training file.
 */
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
