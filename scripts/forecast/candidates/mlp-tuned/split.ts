import { FORECAST_INPUT_DIM } from "../../../../src/shared/forecast/model";
import { mulberry32, shuffled } from "../../lib";
import { importanceOf, type ReplayedSession, type Rows } from "./data";

/**
 * Train-split partitioning for the mlp-tuned sweep.
 *
 * `split: "eval"` rows never appear here at all — everything below is carved
 * out of `split: "train"` only:
 *
 *   synthetic train sessions
 *     ├── CALIBRATION slice (calFraction): in NO fold's fit set. The final
 *     │   ensemble's blend standardization and Platt scaling are fit here, so
 *     │   the shipped risk numbers come from rows no member ever trained on.
 *     └── K cross-validation folds: fold f's fit set is every other fold,
 *         fold f's val set is fold f. Model selection is the MEAN of the
 *         per-fold held-out numbers, which is what keeps a 43-drift validation
 *         split from turning the sweep into a lottery.
 *
 *   augmented:local sessions are jittered / time-warped / remixed copies of
 *   specific train sessions, so each one is assigned to its PARENT's fold and
 *   dropped when its parents straddle folds or descend from the calibration
 *   slice. Without that, a fold's fit set contains near-copies of its own val
 *   sessions and every val number is optimistic.
 */

export interface Fold {
  index: number;
  fitIndex: Int32Array;
  valIndex: Int32Array;
  /** Positions into valIndex, calm negatives repeated ×4 (natural prevalence). */
  valLeadPos: Int32Array;
  valLeadLabels: number[];
  valLabels: number[];
  valImportance: number[];
  valSessionIds: string[];
  valReplays: ReplayedSession[];
}

export interface CalibrationSlice {
  index: Int32Array;
  labels: number[];
  importance: number[];
  leadPos: Int32Array;
  leadLabels: number[];
  sessionIds: string[];
  replays: ReplayedSession[];
}

export interface Setup {
  /** All train rows, z-scored with one shared mean/scale. */
  xNorm: Float64Array;
  mean: Float64Array;
  scale: Float64Array;
  folds: Fold[];
  calibration: CalibrationSlice;
  droppedAugmentedSessions: number;
  attachedAugmentedSessions: number;
}

function leadExpansion(
  train: Rows,
  index: readonly number[],
): { leadPos: Int32Array; leadLabels: number[]; labels: number[]; importance: number[] } {
  const leadPos: number[] = [];
  const leadLabels: number[] = [];
  const labels: number[] = [];
  const importance: number[] = [];
  for (let k = 0; k < index.length; k += 1) {
    const i = index[k] as number;
    const w = importanceOf(train, i);
    importance.push(w);
    labels.push(train.y[i] as number);
    const secs = train.secs[i] as number;
    if (!(Number.isNaN(secs) || secs >= 20)) {
      continue;
    }
    for (let r = 0; r < Math.round(w); r += 1) {
      leadPos.push(k);
      leadLabels.push(train.y[i] as number);
    }
  }
  return { leadPos: Int32Array.from(leadPos), leadLabels, labels, importance };
}

export function buildSetup(
  train: Rows,
  parents: Map<string, string[]>,
  replays: readonly ReplayedSession[],
  options: { seed: number; folds: number; calFraction: number },
): Setup {
  const replayById = new Map(replays.map((session) => [session.id, session]));
  const synthetic: number[] = [];
  const augmented: number[] = [];
  for (let s = 0; s < train.sessions.length; s += 1) {
    ((train.sessions[s] as string).startsWith("aug-") ? augmented : synthetic).push(s);
  }

  // Deterministic assignment: calibration slice first, then round-robin folds.
  const rand = mulberry32(options.seed ^ 0x5eed);
  const order = shuffled(synthetic, rand);
  const calCount = Math.max(1, Math.round(synthetic.length * options.calFraction));
  const CAL = -1;
  const groupOf = new Map<number, number>();
  order.forEach((session, position) => {
    groupOf.set(session, position < calCount ? CAL : (position - calCount) % options.folds);
  });

  let dropped = 0;
  let attached = 0;
  for (const s of augmented) {
    const family = (parents.get(train.sessions[s] as string) ?? []).map((id) =>
      train.sessions.indexOf(id),
    );
    const groups = new Set(family.map((parent) => groupOf.get(parent)));
    const only = [...groups];
    if (family.some((parent) => parent < 0) || only.length !== 1 || only[0] === undefined || only[0] === CAL) {
      dropped += 1;
      continue;
    }
    groupOf.set(s, only[0]);
    attached += 1;
  }

  const calIndexList: number[] = [];
  const fitLists: number[][] = Array.from({ length: options.folds }, () => []);
  const valLists: number[][] = Array.from({ length: options.folds }, () => []);
  for (let i = 0; i < train.n; i += 1) {
    const s = train.sessionOf[i] as number;
    const group = groupOf.get(s);
    if (group === undefined) {
      continue; // dropped augmented session
    }
    if (group === CAL) {
      calIndexList.push(i);
      continue;
    }
    const isAugmented = (train.augmented[i] as number) === 1;
    for (let f = 0; f < options.folds; f += 1) {
      if (f === group) {
        if (!isAugmented) {
          (valLists[f] as number[]).push(i);
        }
      } else {
        (fitLists[f] as number[]).push(i);
      }
    }
  }

  // One shared z-score over every train row — the ensemble members must agree
  // on the input transform or they cannot be stacked into a single net.
  const mean = new Float64Array(FORECAST_INPUT_DIM);
  const scale = new Float64Array(FORECAST_INPUT_DIM);
  for (let i = 0; i < train.n; i += 1) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      mean[f] = (mean[f] as number) + (train.x[i * FORECAST_INPUT_DIM + f] as number);
    }
  }
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    mean[f] = (mean[f] as number) / train.n;
  }
  for (let i = 0; i < train.n; i += 1) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      const d = (train.x[i * FORECAST_INPUT_DIM + f] as number) - (mean[f] as number);
      scale[f] = (scale[f] as number) + d * d;
    }
  }
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    const s = Math.sqrt((scale[f] as number) / train.n);
    scale[f] = s > 1e-6 ? s : 1;
  }
  const xNorm = new Float64Array(train.n * FORECAST_INPUT_DIM);
  for (let i = 0; i < train.n; i += 1) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      xNorm[i * FORECAST_INPUT_DIM + f] =
        ((train.x[i * FORECAST_INPUT_DIM + f] as number) - (mean[f] as number)) / (scale[f] as number);
    }
  }

  const sessionIdsOf = (group: number): string[] =>
    [...groupOf.entries()]
      .filter(([session, g]) => g === group && !(train.sessions[session] as string).startsWith("aug-"))
      .map(([session]) => train.sessions[session] as string);

  const folds: Fold[] = [];
  for (let f = 0; f < options.folds; f += 1) {
    const valIndex = valLists[f] as number[];
    const expanded = leadExpansion(train, valIndex);
    const ids = sessionIdsOf(f);
    folds.push({
      index: f,
      fitIndex: Int32Array.from(fitLists[f] as number[]),
      valIndex: Int32Array.from(valIndex),
      valLeadPos: expanded.leadPos,
      valLeadLabels: expanded.leadLabels,
      valLabels: expanded.labels,
      valImportance: expanded.importance,
      valSessionIds: ids,
      valReplays: ids.map((id) => replayById.get(id)).filter((s): s is ReplayedSession => s !== undefined),
    });
  }

  const calExpanded = leadExpansion(train, calIndexList);
  const calIds = sessionIdsOf(CAL);
  return {
    xNorm,
    mean,
    scale,
    folds,
    calibration: {
      index: Int32Array.from(calIndexList),
      labels: calExpanded.labels,
      importance: calExpanded.importance,
      leadPos: calExpanded.leadPos,
      leadLabels: calExpanded.leadLabels,
      sessionIds: calIds,
      replays: calIds.map((id) => replayById.get(id)).filter((s): s is ReplayedSession => s !== undefined),
    },
    droppedAugmentedSessions: dropped,
    attachedAugmentedSessions: attached,
  };
}
