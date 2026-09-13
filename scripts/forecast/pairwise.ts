import { FORECAST_INPUT_DIM } from "../../src/shared/forecast/model";
import { FORECAST_FEATURE_KEYS } from "../../src/shared/forecast/types";

/**
 * The PAIRWISE POLYNOMIAL BASIS — `d` linear terms then every product
 * `x_i · x_j` for `i ≤ j` (squares included), in lexicographic order.
 *
 * This used to live in `src/shared/forecast/model.ts`, because it WAS the
 * shipped head: round 8's bake-off shipped an L2 logistic regression over this
 * basis. Round 11 replaced that head with a tanh MLP (GAUNTLET round 10
 * measured the GLM losing its own gate on a 900-session corpus), so the basis
 * is no longer part of the runtime contract and has moved here, to the
 * research pipeline that still fits GLMs:
 *
 * - `train.ts` records the plain additive logistic (no products) as the gate
 *   reference — it does NOT use this file;
 * - `feature-abtest.ts` and `feature-confirm.ts` re-fit the historical
 *   `lr+pairwise` head to keep round 9's ablations reproducible;
 * - `linear.ts` builds designs from it.
 *
 * Nothing in `src/` imports this. Keeping it out of the shared core is the
 * point: the browser demo and Electron both load `src/shared/forecast/model.ts`
 * and must carry only what the shipped head actually evaluates.
 */

export interface PairwiseTerm {
  i: number;
  j: number | null;
}

/** Canonical term list for an arbitrary width: `d` linear, then `d(d+1)/2` products. */
export function pairwiseTerms(d: number): PairwiseTerm[] {
  const terms: PairwiseTerm[] = [];
  for (let i = 0; i < d; i += 1) {
    terms.push({ i, j: null });
  }
  for (let i = 0; i < d; i += 1) {
    for (let j = i; j < d; j += 1) {
      terms.push({ i, j });
    }
  }
  return terms;
}

export function pairwiseTermCount(d: number): number {
  return d + (d * (d + 1)) / 2;
}

export function pairwiseTermName(term: PairwiseTerm, keys: readonly string[]): string {
  if (term.j === null) {
    return keys[term.i] as string;
  }
  return term.i === term.j ? `${keys[term.i]}^2` : `${keys[term.i]}*${keys[term.j]}`;
}

/** Expands one encoded vector into the basis values, in `pairwiseTerms` order. */
export function expandPairwise(
  terms: readonly PairwiseTerm[],
  encoded: readonly number[],
  out: number[] | Float64Array,
): void {
  for (let k = 0; k < terms.length; k += 1) {
    const term = terms[k] as PairwiseTerm;
    const xi = encoded[term.i] ?? 0;
    out[k] = term.j === null ? xi : xi * (encoded[term.j] ?? 0);
  }
}

/** The full-width basis over the shipped feature keys — what round 8 shipped. */
export const SHIPPED_WIDTH_TERMS: readonly PairwiseTerm[] = pairwiseTerms(FORECAST_INPUT_DIM);
export const SHIPPED_WIDTH_TERM_COUNT = SHIPPED_WIDTH_TERMS.length;
export const SHIPPED_WIDTH_TERM_KEYS: readonly string[] = SHIPPED_WIDTH_TERMS.map((term) =>
  pairwiseTermName(term, FORECAST_FEATURE_KEYS),
);

/** `expandPairwise` at the shipped feature width — the old `model.expandBasis`. */
export function expandBasis(encoded: readonly number[], out: number[] | Float64Array): void {
  expandPairwise(SHIPPED_WIDTH_TERMS, encoded, out);
}
