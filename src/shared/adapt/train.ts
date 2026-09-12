/**
 * Turning one observed drift into training examples.
 *
 * The naive version — one example per drift, labelled "recovered / killed" —
 * cannot tell you how long someone needs, only that they made it within the
 * fuse they happened to be given. Train on that and every fuse looks as good
 * as every other, so the chooser collapses to the shortest one.
 *
 * What we actually observe is richer:
 *
 *   Recovered after T seconds → for every candidate fuse F we know the answer:
 *     they would have made it if F >= T, and not if F < T.
 *
 *   Killed at fuse F0 → we know they had not recovered by F0, so every F <= F0
 *     is a known failure. Anything longer is censored: they might have come
 *     back at F0 + 1, and we will never know. Those examples are dropped
 *     rather than guessed.
 *
 * That is what identifies the fuse coefficient, and it is why the model can
 * answer "how long does this person need" from a signal the app was already
 * producing.
 */

import { extractFeatures, withFuse, type DriftMoment } from "./features";
import { FUSE_CANDIDATES } from "./fuse";
import { learn, type AdaptiveModel } from "./model";

export interface DriftOutcome {
  /**
   * Seconds from countdown start to the cancel, or `null` when it ran to a
   * kill. Comes straight from the gap between `start_countdown` and
   * `cancel_countdown` in the session log.
   */
  recoveredAfterSec: number | null;
  /** The fuse this countdown was given. */
  fuseSec: number;
  /** True when the fuse was a deliberate probe rather than the greedy choice. */
  probed?: boolean;
}

export interface TrainingExample {
  fuseSec: number;
  features: number[];
  recovered: boolean;
}

/** The labelled examples one drift yields. Censored candidates are omitted. */
export function examplesFor(
  moment: DriftMoment,
  outcome: DriftOutcome,
): TrainingExample[] {
  const examples: TrainingExample[] = [];
  const recoveredAt = outcome.recoveredAfterSec;

  for (const fuseSec of FUSE_CANDIDATES) {
    if (recoveredAt === null) {
      // Killed. Only fuses no longer than the one we used are decided.
      if (fuseSec > outcome.fuseSec) {
        continue;
      }
      examples.push({ fuseSec, features: extractFeatures(withFuse(moment, fuseSec)), recovered: false });
      continue;
    }
    examples.push({
      fuseSec,
      features: extractFeatures(withFuse(moment, fuseSec)),
      recovered: recoveredAt <= fuseSec,
    });
  }

  return examples;
}

/** Fold one real drift into the model. Counts as a single observation. */
export function observeDrift(
  model: AdaptiveModel,
  moment: DriftMoment,
  outcome: DriftOutcome,
): AdaptiveModel {
  const examples = examplesFor(moment, outcome);
  let next = model;
  for (const example of examples) {
    next = learn(next, example.features, example.recovered);
  }
  return {
    ...next,
    drifts: model.drifts + 1,
    recoveries: model.recoveries + (outcome.recoveredAfterSec === null ? 0 : 1),
    probes: model.probes + (outcome.probed === true ? 1 : 0),
  };
}
