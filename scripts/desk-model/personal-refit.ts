/**
 * The personal attention refit and its gate, as the trainer-side tools name
 * it — a re-export of `src/shared/correction/refit.ts` and nothing else.
 *
 * WHY THIS FILE IS A BARREL. The fit and the eleven gates run in two places:
 * on the student's machine, from `src/main/desk/corrections/refit.ts` behind
 * the Settings button; and on a developer's, from `refit-attention.ts` against
 * a copy of a `desk-corrections/` directory. Those are two shells around ONE
 * piece of arithmetic, and a second copy of it under `scripts/` would be a
 * second thing to keep in step with the frozen appendix — precisely the drift
 * `scripts/check-contracts.mjs` exists to stop. So the arithmetic lives in
 * `src/shared/correction/`, beside the types and the constants the doc
 * freezes, and this file is the name the trainer, the anchor builder, the
 * export script and `personal-refit.test.ts` reach it by.
 *
 * The purity fence, the constant mirroring and every numerical assertion in
 * `personal-refit.test.ts` therefore land on the shared module. That is the
 * point: the app cannot run a fit the trainer's tests did not check.
 */
export * from "@shared/correction/refit";
