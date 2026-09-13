/**
 * Dataset loading for the trees contender. `data/forecast/dataset.jsonl` is
 * read AS-IS — never rebuilt, never resampled, never re-split. `split:"eval"`
 * rows are loaded into a separate array that no fitting or selection step in
 * this candidate ever touches.
 */

import { join } from "node:path";
import { fnv1a32 } from "../../../../src/shared/forecast/hash";
import {
  DATASET_FILE,
  forecastDataRoot,
  keepProbability,
  readJsonl,
  type DatasetRow,
} from "../../lib";

export const N_FEATURES = 18;

export interface LoadedData {
  file: string;
  /** nTrain × 18 encoded features, file order */
  trainX: Float64Array;
  trainY: Uint8Array;
  /** NaN ⇒ no onset ahead (dataset `secs_to_drift: null`) */
  trainSecs: Float64Array;
  /** 1 / keep-probability — undoes the builder's train-only downsampling */
  trainImportance: Float64Array;
  trainSessionOf: Int32Array;
  trainSessions: string[];
  trainCount: number;

  evalX: Float64Array;
  evalY: Uint8Array;
  evalSecs: Float64Array;
  evalArchetype: string[];
  evalSessionIds: string[];
  evalCount: number;
}

export async function loadDataset(file?: string): Promise<LoadedData> {
  const path = file ?? join(forecastDataRoot(), DATASET_FILE);
  const trainX: number[] = [];
  const trainY: number[] = [];
  const trainSecs: number[] = [];
  const trainImportance: number[] = [];
  const trainSessionOf: number[] = [];
  const trainSessions: string[] = [];
  const sessionIndex = new Map<string, number>();

  const evalX: number[] = [];
  const evalY: number[] = [];
  const evalSecs: number[] = [];
  const evalArchetype: string[] = [];
  const evalSessionIds: string[] = [];

  for await (const row of readJsonl<DatasetRow>(path)) {
    if (row.split === "eval") {
      for (let i = 0; i < N_FEATURES; i += 1) {
        evalX.push(row.features[i] ?? 0);
      }
      evalY.push(row.label);
      evalSecs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
      evalArchetype.push(row.archetype);
      evalSessionIds.push(row.session_id);
      continue;
    }
    let index = sessionIndex.get(row.session_id);
    if (index === undefined) {
      index = trainSessions.length;
      sessionIndex.set(row.session_id, index);
      trainSessions.push(row.session_id);
    }
    for (let i = 0; i < N_FEATURES; i += 1) {
      trainX.push(row.features[i] ?? 0);
    }
    trainY.push(row.label);
    trainSecs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
    trainImportance.push(1 / keepProbability(row.label, row.secs_to_drift));
    trainSessionOf.push(index);
  }

  return {
    file: path,
    trainX: Float64Array.from(trainX),
    trainY: Uint8Array.from(trainY),
    trainSecs: Float64Array.from(trainSecs),
    trainImportance: Float64Array.from(trainImportance),
    trainSessionOf: Int32Array.from(trainSessionOf),
    trainSessions,
    trainCount: trainY.length,
    evalX: Float64Array.from(evalX),
    evalY: Uint8Array.from(evalY),
    evalSecs: Float64Array.from(evalSecs),
    evalArchetype,
    evalSessionIds,
    evalCount: evalY.length,
  };
}

/**
 * Train-internal fit/val split by SESSION (never by frame — frames inside one
 * session are heavily autocorrelated). Seeded hash, ~20 % of train sessions
 * held out for hyper-parameter selection, early stopping and Platt
 * calibration. This is a split of the TRAIN split only; the dataset's own
 * eval sessions are untouched.
 */
export function valSessionSet(sessions: readonly string[], seed: number, everyNth = 5): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < sessions.length; i += 1) {
    if (fnv1a32(`trees-val:${seed}:${sessions[i] as string}`) % everyNth === 0) {
      out.add(i);
    }
  }
  return out;
}
