/**
 * ONE fuse authority.
 *
 * Two models want a say in how long the enforcement fuse burns, and both write
 * the same number — `countdownSec`, the single field the pure policy engine
 * reads. They are not rivals, because they answer different questions:
 *
 *   AdaptiveFuse   "how long does THIS person need to self-correct?"
 *                  → a PERSONALISED BASE LENGTH, learned per install.
 *   Focus Forecast "is a drift coming in the next 30 s?"
 *                  → a PRE-ARM, which shortens whatever base is in force.
 *
 * So they compose: the forecast SCALES the personalised length toward the
 * floor, it never replaces it.
 *
 *     prearmed ? clamp(round(personal × 0.5), MIN_FUSE_SEC, personal)
 *              : personal
 *
 * Why scaling and not `min(personal, prearmFuse)` (the first sketch in
 * docs/RECONCILIATION.md): replacement throws the personalisation away exactly
 * when it matters. Under `min`, a slow recoverer who has earned a 20 s fuse and
 * a fast one who has earned 8 s both collapse to the same 5 s the moment the
 * forecast fires — and adapt's fair-shot contract (the fuse must clear
 * RECOVERY_TARGET for THIS person) is not bent but broken. Scaling keeps the
 * ordering: 20 → 10 still beats 8 → 4. Everyone loses the same *fraction* of
 * their fair shot, which is a defensible price for a warning that has been
 * right often enough to earn a pre-arm.
 *
 * With the shipped 10 s default and a cold adaptive model this is exactly the
 * demo beat the branch already ships: 10 s → 5 s.
 */

import { MIN_FUSE_SEC } from "../../shared/adapt/fuse.ts";

export { MIN_FUSE_SEC };

/**
 * The fraction of the personalised fuse that survives a pre-arm. Half is the
 * number the 10 s → 5 s demo encodes; it is deliberately a constant rather
 * than a setting, because the authority has to be one rule, not a negotiation.
 */
export const PREARM_SCALE = 0.5;

export interface FuseInputs {
  /** AdaptiveFuse's personalised length for this moment, in seconds. */
  personalSec: number;
  /** True when the Focus Forecast has pre-armed and policy has not consumed it. */
  prearmed: boolean;
}

/**
 * The composed countdown, in seconds.
 *
 * Pure, total, and never throws: given a finite personal length it returns a
 * finite length, and with `prearmed: false` it returns that length untouched —
 * no rounding, no clamping — so a session with no forecast is byte-identical
 * to one without this file.
 *
 * The clamp is ordered so the pre-arm can only ever SHORTEN: the floor lifts a
 * scaled fuse back to `MIN_FUSE_SEC`, but never past the personal length, so a
 * user running a 2 s fuse on purpose still gets 2 s rather than being handed
 * an extra second by the safety floor.
 */
export function composeFuse({ personalSec, prearmed }: FuseInputs): number {
  if (!prearmed || !Number.isFinite(personalSec)) {
    return personalSec;
  }
  const scaled = Math.round(personalSec * PREARM_SCALE);
  return Math.min(personalSec, Math.max(MIN_FUSE_SEC, scaled));
}
