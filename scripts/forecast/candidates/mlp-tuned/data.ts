import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  DATASET_FILE,
  RAW_SESSIONS_FILE,
  deriveSeed,
  forecastDataRoot,
  keepProbability,
  mulberry32,
  readJsonl,
  replaySession,
  splitForSession,
  type DatasetRow,
  type RawSession,
} from "../../lib";
import { findDriftOnsets, type DecisionFrame } from "../../../../src/shared/forecast/labels";
import { FORECAST_INPUT_DIM } from "../../../../src/shared/forecast/model";

/**
 * Loading for the mlp-tuned contender.
 *
 * The dataset is FIXED: `data/forecast/dataset.jsonl` is streamed verbatim
 * through the shared `readJsonl`, never rebuilt, resampled or re-split, and
 * `split: "eval"` rows are kept strictly apart from anything the trainer can
 * touch. No caching layer sits in between on purpose — the whole load is
 * ~3 s and a stale cache is exactly the kind of thing that quietly turns an
 * honest number into a fabricated one.
 */

export const CANDIDATE_DIR = join(forecastDataRoot(), "candidates", "mlp-tuned");

export function candidateDir(): string {
  mkdirSync(CANDIDATE_DIR, { recursive: true });
  return CANDIDATE_DIR;
}

export interface Rows {
  /** n × 18 encoded features, row-major (dataset order). */
  x: Float64Array;
  y: Uint8Array;
  /** Seconds to the next onset; NaN when none is ahead. */
  secs: Float64Array;
  /** Index into `sessions`. */
  sessionOf: Int32Array;
  sessions: string[];
  /** Index into `archetypes`. */
  archetypeOf: Int32Array;
  archetypes: string[];
  /** 1 when the row's session has `source: "augmented:local"`. */
  augmented: Uint8Array;
  n: number;
}

export interface Loaded {
  train: Rows;
  evalRows: Rows;
}

/** Importance weight 1/keepProbability — undoes the builder's train-only calm downsampling. */
export function importanceOf(rows: Rows, i: number): number {
  const secs = rows.secs[i] as number;
  return 1 / keepProbability(rows.y[i] as 0 | 1, Number.isNaN(secs) ? null : secs);
}

interface Acc {
  x: number[];
  y: number[];
  secs: number[];
  sessionOf: number[];
  archetypeOf: number[];
  augmented: number[];
  sessions: string[];
  sessionIndex: Map<string, number>;
  archetypes: string[];
  archetypeIndex: Map<string, number>;
}

function newAcc(): Acc {
  return {
    x: [],
    y: [],
    secs: [],
    sessionOf: [],
    archetypeOf: [],
    augmented: [],
    sessions: [],
    sessionIndex: new Map(),
    archetypes: [],
    archetypeIndex: new Map(),
  };
}

function pack(acc: Acc): Rows {
  return {
    x: Float64Array.from(acc.x),
    y: Uint8Array.from(acc.y),
    secs: Float64Array.from(acc.secs),
    sessionOf: Int32Array.from(acc.sessionOf),
    sessions: acc.sessions,
    archetypeOf: Int32Array.from(acc.archetypeOf),
    archetypes: acc.archetypes,
    augmented: Uint8Array.from(acc.augmented),
    n: acc.y.length,
  };
}

export async function loadDataset(): Promise<Loaded> {
  const datasetFile = join(forecastDataRoot(), DATASET_FILE);
  const train = newAcc();
  const evalAcc = newAcc();
  for await (const row of readJsonl<DatasetRow>(datasetFile)) {
    const acc = row.split === "eval" ? evalAcc : train;
    if (row.split === "eval" && row.source !== "synthetic" && row.source !== "recorded") {
      throw new Error(`eval split contains ${row.source} row (${row.session_id}) — refusing to score it`);
    }
    let s = acc.sessionIndex.get(row.session_id);
    if (s === undefined) {
      s = acc.sessions.length;
      acc.sessionIndex.set(row.session_id, s);
      acc.sessions.push(row.session_id);
    }
    let a = acc.archetypeIndex.get(row.archetype);
    if (a === undefined) {
      a = acc.archetypes.length;
      acc.archetypeIndex.set(row.archetype, a);
      acc.archetypes.push(row.archetype);
    }
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      acc.x.push(row.features[f] ?? 0);
    }
    acc.y.push(row.label);
    acc.secs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
    acc.sessionOf.push(s);
    acc.archetypeOf.push(a);
    acc.augmented.push(row.source === "augmented:local" ? 1 : 0);
  }
  return { train: pack(train), evalRows: pack(evalAcc) };
}

// ---------------------------------------------------------------------------
// Held-out RAW sessions, replayed through the SHARED ring/extractor so the
// alarm simulation can be driven by any scorer (`eval.ts`'s own simulateAlarms
// hard-codes `forward(weights, …)`, which cannot score an ensemble).
// Also recovers which train sessions each `augmented:local` session was
// derived from, so the train-internal validation split can stay leak-free.
// ---------------------------------------------------------------------------

export interface ReplayedSession {
  id: string;
  archetype: string;
  split: "train" | "eval";
  durationSec: number;
  /** frames × 18, row-major, one frame per whole second starting at t = 1. */
  values: Float64Array;
  frameCount: number;
  decisions: DecisionFrame[];
  onsets: ReturnType<typeof findDriftOnsets>;
}

export interface RawIndex {
  /** Every SYNTHETIC session replayed through the shared ring/extractor. */
  replays: ReplayedSession[];
  /** Synthetic train sessions in dataset-builder order (the augmentation pool). */
  trainPool: Array<{ id: string; archetype: string }>;
}

/**
 * Train-split sessions are replayed too, on purpose: the validation half of
 * them drives a train-internal copy of the alarm simulation, so the sweep can
 * see deployment-faithful nudge recall without ever touching an eval session.
 */
export async function loadRawIndex(seed: number): Promise<RawIndex> {
  const rawFile = join(forecastDataRoot(), RAW_SESSIONS_FILE);
  const replays: ReplayedSession[] = [];
  const trainPool: Array<{ id: string; archetype: string }> = [];
  for await (const session of readJsonl<RawSession>(rawFile)) {
    if (session.source !== "synthetic") {
      continue;
    }
    const split = splitForSession(session.id, seed);
    if (split === "train") {
      trainPool.push({ id: session.id, archetype: session.archetype });
    }
    const frames = replaySession(session);
    const decisions: DecisionFrame[] = frames.map((frame) => ({
      t: frame.t,
      decision: frame.decision,
      countdownActive: frame.countdownActive,
    }));
    const values = new Float64Array(frames.length * FORECAST_INPUT_DIM);
    frames.forEach((frame, i) => {
      for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
        values[i * FORECAST_INPUT_DIM + f] = frame.values[f] ?? 0;
      }
    });
    replays.push({
      id: session.id,
      archetype: session.archetype,
      split,
      durationSec: session.durationSec,
      values,
      frameCount: frames.length,
      decisions,
      onsets: findDriftOnsets(decisions),
    });
  }
  return { replays, trainPool };
}

/**
 * Re-derives `augment-local.ts`'s source selection (`mulberry32(deriveSeed(
 * seed, "augment:i"))`, jitter → warp → remix over the same train pool) so a
 * validation split can refuse any augmented session whose parent session is
 * in validation. Without this the 48 `augmented:local` sessions leak jittered
 * copies of val sessions into the fit set and every val number is optimistic.
 */
export function augmentationParents(
  trainPool: ReadonlyArray<{ id: string; archetype: string }>,
  seed: number,
  fraction: number,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const total = Math.round(trainPool.length * fraction);
  if (total <= 0 || trainPool.length === 0) {
    return out;
  }
  const byArchetype = new Map<string, Array<{ id: string; archetype: string }>>();
  for (const session of trainPool) {
    const group = byArchetype.get(session.archetype) ?? [];
    group.push(session);
    byArchetype.set(session.archetype, group);
  }
  for (let i = 0; i < total; i += 1) {
    const rand = mulberry32(deriveSeed(seed, `augment:${i}`));
    const source = trainPool[Math.floor(rand() * trainPool.length)] as { id: string; archetype: string };
    const id = `aug-${String(i).padStart(6, "0")}`;
    if (i % 3 !== 2) {
      out.set(id, [source.id]);
      continue;
    }
    const peers = byArchetype.get(source.archetype) ?? [source];
    const partner =
      peers.length > 1
        ? (peers.filter((peer) => peer.id !== source.id)[
            Math.floor(rand() * (peers.length - 1))
          ] as { id: string })
        : source;
    out.set(id, [source.id, partner.id]);
  }
  return out;
}
