import { execSync } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WriteStream } from "node:fs";
import { FORECAST_FEATURE_KEYS, type ForecastFeatureKey } from "../../src/shared/forecast/types";
import { augmentLocal } from "./augment-local";
import { runAdaptionAugment, type AdaptionOutcome } from "./adaption";
import {
  AUGMENT_PARENTS_FILE,
  DATASET_FILE,
  MANIFEST_FILE,
  RAW_SESSIONS_FILE,
  boolFlag,
  deriveSeed,
  encodeRaw,
  forecastDataRoot,
  keepProbability,
  labelSession,
  mulberry32,
  numberArg,
  parsePrompt,
  promptFor,
  rawInBounds,
  readJsonl,
  round4,
  round6,
  splitForSession,
  stringArg,
  type DatasetManifest,
  type DatasetRow,
  type RawSession,
} from "./lib";

/**
 * Dataset builder: raw session streams → labeled 1 Hz frames in the frozen
 * JSONL schema (docs/FORECAST-CONTRACTS.md §4). Every session is replayed
 * through the SHARED ring + extractor + labeler — the same code path runtime
 * inference uses — then:
 *
 * - split assigned per SESSION (seeded 80/20 hash), never per frame;
 * - censored frames dropped from train AND eval (active drift, countdown,
 *   post-recovery, warm-up, right-censored tail) — prediction, not detection;
 * - easy train negatives downsampled (all kept within 120 s of a drift,
 *   25% of calm stretches); the eval split is NEVER rebalanced;
 * - each row carries prompt/completion columns so the same file uploads to
 *   Adaption Labs with `column_mapping {prompt, completion}`.
 *
 * `--adaption` attempts the sponsor API (upload seed → augment → download).
 * On ANY auth/network/non-2xx failure it logs one warning line, falls back to
 * the local augmenter, still exits 0, and stamps the truth into
 * `data/forecast/manifest.json` (which train/eval embed as provenance).
 *
 *   tsx scripts/forecast/build-dataset.ts [--adaption] [--seed 42]
 */

interface BuildConfig {
  raw: string;
  out: string;
  seed: number;
  augmentFraction: number;
  adaption: boolean;
  adaptionRows: number;
}

function readConfig(): BuildConfig {
  return {
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    out: stringArg("--out", join(forecastDataRoot(), DATASET_FILE)),
    seed: numberArg("--seed", 42),
    augmentFraction: numberArg("--augment-fraction", 0.25),
    adaption: boolFlag("--adaption"),
    adaptionRows: numberArg("--adaption-rows", 4000),
  };
}

interface Counts {
  rowsTrain: number;
  rowsEval: number;
  positivesTrain: number;
  positivesEval: number;
  excluded: number;
  rawFrames: number;
  rowsBySource: Record<string, number>;
  sessionsBySource: Record<string, number>;
  sessionsByArchetype: Record<string, number>;
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

async function writeLine(stream: WriteStream, line: string): Promise<void> {
  if (!stream.write(line)) {
    await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
  }
}

let selfChecked = 0;

/** Guards the lib.ts re-encoder (Adaption gate) against extractor drift. */
function selfCheckEncoding(raw: Record<ForecastFeatureKey, number>, values: number[]): void {
  if (selfChecked >= 200) {
    return;
  }
  selfChecked += 1;
  const encoded = encodeRaw(raw);
  for (let i = 0; i < FORECAST_FEATURE_KEYS.length; i += 1) {
    if (Math.abs((encoded[i] ?? 0) - (values[i] ?? 0)) > 1e-9) {
      throw new Error(
        `encodeRaw drifted from extractFeatures at ${FORECAST_FEATURE_KEYS[i]}: ` +
          `${encoded[i]} vs ${values[i]} — fix scripts/forecast/lib.ts`,
      );
    }
  }
}

/** Replay + label + censor + (train-only) downsample one session into rows. */
async function emitSessionRows(
  session: RawSession,
  split: "train" | "eval",
  seed: number,
  stream: WriteStream,
  seedStream: WriteStream | null,
  counts: Counts,
): Promise<void> {
  const { frames, labels } = labelSession(session);
  const sampler = mulberry32(deriveSeed(seed, `downsample:${session.id}`));
  counts.rawFrames += frames.length;
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    const label = labels[i];
    if (!frame || !label) {
      continue;
    }
    if (label.excluded) {
      counts.excluded += 1;
      continue;
    }
    if (split === "train") {
      const keep = keepProbability(label.label, label.secsToDrift);
      if (keep < 1 && sampler() >= keep) {
        continue;
      }
    }
    selfCheckEncoding(frame.raw, frame.values);
    const raw = {} as Record<ForecastFeatureKey, number>;
    for (const key of FORECAST_FEATURE_KEYS) {
      raw[key] = round4(frame.raw[key]);
    }
    const row: DatasetRow = {
      v: 1,
      session_id: session.id,
      source: session.source,
      archetype: session.archetype,
      split,
      t: frame.t,
      features: frame.values.map(round6),
      raw,
      label: label.label,
      secs_to_drift: label.secsToDrift,
      drift_type: label.driftType,
      prompt: promptFor(raw),
      completion: label.label === 1 ? "DRIFT" : "STAY",
    };
    await writeLine(stream, `${JSON.stringify(row)}\n`);
    if (split === "train") {
      counts.rowsTrain += 1;
      counts.positivesTrain += label.label;
      if (seedStream) {
        await writeLine(
          seedStream,
          `${JSON.stringify({ prompt: row.prompt, completion: row.completion })}\n`,
        );
      }
    } else {
      counts.rowsEval += 1;
      counts.positivesEval += label.label;
    }
    bump(counts.rowsBySource, session.source);
  }
}

/**
 * Strict gate for downloaded Adaption rows: parse the prompt back into raw
 * units, range-check, re-encode with the shared formulas, take the label from
 * the completion token only when it is exactly DRIFT/STAY. Violations are
 * dropped and counted. All resulting rows are train-only.
 */
async function emitAdaptionRows(
  outcome: AdaptionOutcome,
  cap: number,
  stream: WriteStream,
  counts: Counts,
): Promise<number> {
  let kept = 0;
  let dropped = 0;
  const batch = outcome.augmentedDatasetId ?? "unknown";
  for (const candidate of outcome.rows) {
    if (kept >= cap) {
      break;
    }
    const raw = parsePrompt(candidate.prompt);
    const completion = candidate.completion.trim().toUpperCase();
    if (raw === null || !rawInBounds(raw) || (completion !== "DRIFT" && completion !== "STAY")) {
      dropped += 1;
      continue;
    }
    const rounded = {} as Record<ForecastFeatureKey, number>;
    for (const key of FORECAST_FEATURE_KEYS) {
      rounded[key] = round4(raw[key]);
    }
    const label: 0 | 1 = completion === "DRIFT" ? 1 : 0;
    const row: DatasetRow = {
      v: 1,
      session_id: `adp-${batch}-${Math.floor(kept / 256)}`,
      source: "augmented:adaption",
      archetype: "unknown",
      split: "train",
      t: kept % 256,
      features: encodeRaw(raw).map(round6),
      raw: rounded,
      label,
      secs_to_drift: null,
      drift_type: null,
      prompt: promptFor(rounded),
      completion: label === 1 ? "DRIFT" : "STAY",
    };
    await writeLine(stream, `${JSON.stringify(row)}\n`);
    counts.rowsTrain += 1;
    counts.positivesTrain += label;
    bump(counts.rowsBySource, "augmented:adaption");
    kept += 1;
  }
  outcome.rows.length = 0;
  return dropped;
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  const counts: Counts = {
    rowsTrain: 0,
    rowsEval: 0,
    positivesTrain: 0,
    positivesEval: 0,
    excluded: 0,
    rawFrames: 0,
    rowsBySource: {},
    sessionsBySource: {},
    sessionsByArchetype: {},
  };

  const stream = createWriteStream(config.out, "utf8");
  const seedFile = join(forecastDataRoot(), "adaption-seed.jsonl");
  const seedStream = createWriteStream(seedFile, "utf8");

  // Pass 1 — synthetic sessions: eval sessions are emitted and dropped,
  // train sessions are kept as the augmentation source pool.
  const trainSessions: RawSession[] = [];
  let evalResearchChurnSessions = 0;
  for await (const session of readJsonl<RawSession>(config.raw)) {
    const split = splitForSession(session.id, config.seed);
    bump(counts.sessionsBySource, session.source);
    bump(counts.sessionsByArchetype, session.archetype);
    if (split === "eval" && session.archetype === "research_churn") {
      evalResearchChurnSessions += 1;
    }
    await emitSessionRows(session, split, config.seed, stream, split === "train" ? seedStream : null, counts);
    if (split === "train") {
      trainSessions.push(session);
    }
  }
  if (evalResearchChurnSessions === 0) {
    throw new Error(
      "no research_churn sessions landed in the eval split — the anti-if-else slice would be empty",
    );
  }
  await new Promise<void>((resolve, reject) => {
    seedStream.end(() => resolve());
    seedStream.on("error", reject);
  });

  // Pass 2 — augmentation. Sponsor API when asked; local fallback always
  // available, and always the ending when the API refuses us (403 today).
  let adaption: DatasetManifest["adaption"] = {
    attempted: false,
    ok: false,
    httpStatus: null,
    error: null,
    datasetId: null,
    augmentedDatasetId: null,
    mergedRows: 0,
    droppedRows: 0,
  };
  let mode: DatasetManifest["mode"] = "offline";
  let useLocalAugment = true;

  if (config.adaption) {
    adaption.attempted = true;
    const outcome = await runAdaptionAugment(seedFile, config.adaptionRows);
    adaption.httpStatus = outcome.httpStatus;
    adaption.error = outcome.error;
    adaption.datasetId = outcome.datasetId;
    adaption.augmentedDatasetId = outcome.augmentedDatasetId;
    if (outcome.ok) {
      const cap = Math.floor(counts.rowsTrain * 0.25);
      const before = counts.rowsTrain;
      adaption.droppedRows = await emitAdaptionRows(outcome, cap, stream, counts);
      adaption.mergedRows = counts.rowsTrain - before;
      adaption.ok = true;
      mode = "adaption";
      useLocalAugment = false;
      console.log(
        `adaption: merged ${adaption.mergedRows} rows (dropped ${adaption.droppedRows}) from dataset ${adaption.augmentedDatasetId}`,
      );
    } else {
      mode = "offline-fallback";
      console.warn(
        `WARN adaption unavailable (${outcome.error ?? "unknown error"}${outcome.httpStatus !== null ? `, HTTP ${outcome.httpStatus}` : ""}) — falling back to local augmentation`,
      );
    }
  }

  // The augmenter's own lineage record: augmented session id -> parent TRAIN
  // session ids. Written beside the dataset (augmented sessions never reach
  // raw-sessions.jsonl) so train.ts can put a jittered copy of a validation
  // session in its parent's fold instead of in that fold's fit set.
  const augmentParents: Record<string, string[]> = {};
  if (useLocalAugment) {
    const augmented = augmentLocal(trainSessions, {
      fraction: config.augmentFraction,
      seed: config.seed,
    });
    for (const session of augmented) {
      bump(counts.sessionsBySource, session.source);
      bump(counts.sessionsByArchetype, session.archetype);
      augmentParents[session.id] = [...(session.parents ?? [])];
      // Augmented sessions are train-only by construction.
      await emitSessionRows(session, "train", config.seed, stream, null, counts);
    }
  }
  writeFileSync(
    join(forecastDataRoot(), AUGMENT_PARENTS_FILE),
    `${JSON.stringify(augmentParents, null, 2)}\n`,
  );

  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on("error", reject);
  });

  const manifest: DatasetManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    seed: config.seed,
    mode,
    gitCommit: gitCommit(),
    counts: {
      sessions: counts.sessionsBySource,
      sessionsByArchetype: counts.sessionsByArchetype,
      rows: {
        train: counts.rowsTrain,
        eval: counts.rowsEval,
        total: counts.rowsTrain + counts.rowsEval,
      },
      rowsBySource: counts.rowsBySource,
      positives: { train: counts.positivesTrain, eval: counts.positivesEval },
      excludedFrames: counts.excluded,
      rawFrames: counts.rawFrames,
    },
    adaption,
    downsample: { nearDriftKeepSec: 120, calmKeepProb: 0.25 },
  };
  writeFileSync(join(forecastDataRoot(), MANIFEST_FILE), JSON.stringify(manifest, null, 2));

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `dataset → ${config.out} (${seconds}s): train ${counts.rowsTrain} rows ` +
      `(${counts.positivesTrain} pos, ${(counts.rowsTrain / Math.max(1, counts.positivesTrain)).toFixed(1)}:1) | ` +
      `eval ${counts.rowsEval} rows (${counts.positivesEval} pos, natural prevalence)`,
  );
  console.log(
    `  raw frames ${counts.rawFrames} | censored ${counts.excluded} | mode ${mode} | sources ${JSON.stringify(counts.rowsBySource)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
