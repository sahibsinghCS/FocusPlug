import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { FORECAST_FEATURE_KEYS, type ForecastFeatureKey } from "../../src/shared/forecast/types";
import { augmentLocal } from "./augment-local";
import {
  DATASET_FILE,
  MANIFEST_FILE,
  RAW_SESSIONS_FILE,
  boolFlag,
  forecastDataRoot,
  keepProbability,
  labelSession,
  numberArg,
  promptFor,
  round4,
  round6,
  splitForSession,
  stringArg,
  type DatasetRow,
  type RawSession,
} from "./lib";
import {
  HOLDOUT_DATASET_FILE,
  HOLDOUT_MANIFEST_FILE,
  HOLDOUT_SESSIONS_FILE,
  HOLDOUT_SESSION_PREFIX,
  HOLDOUT_INDEX_BASE,
  HOLDOUT_SEED_OFFSET,
  TRAINING_SESSION_PREFIXES,
  archetypeMix,
  assertContentDisjoint,
  assertIdNamespaceDisjoint,
  assertSeedNamespaceDisjoint,
  holdoutRoot,
  holdoutSessionId,
  holdoutSessionIndex,
  holdoutSimConfig,
  sessionContentHash,
  sessionSeedFor,
  type SeedDisjointness,
} from "./holdout-namespace";
import { archetypeForIndex, readConfig as readSimConfig, simulateSession } from "./simulate";

/**
 * Stage 2b — THE POWER CORPUS: a large, fresh, structurally uncontaminated
 * held-out evaluation set.
 *
 *   npm run forecast:evalset       # 900 sessions → data/forecast/holdout/
 *   npm run forecast:eval:holdout  # score the shipped head on it
 *   npm run forecast:power         # both, in order
 *
 * WHY. The bake-off (GAUNTLET round 8) compared five model families on 48
 * held-out sessions / 78 drift onsets / 858 lead-censored positives. The
 * paired session-clustered bootstrap put the SE of a model-vs-model
 * lead-censored AUC difference at ≈ 0.009, and every non-linear margin on
 * offer was 0.4–0.7 of one SE. "The neural net did not win" was therefore an
 * underpowered shrug, not a measurement. SE falls as 1/√sessions, so 18.75×
 * the sessions buys ≈ 0.002 — a difference of 0.01 becomes ~4–5 SE, and the
 * +0.0064 the temporal CNN posted becomes a number this evaluation can
 * actually accept or reject.
 *
 * WHAT IT IS. The SAME generative process as training — `simulate.ts`
 * untouched, all six archetypes at the default mix including `research_churn`,
 * the same `TelemetryRing` → `classify()` → `extractFeatures()` →
 * `findDriftOnsets()`/`labelFrames()` replay through `lib.labelSession`, the
 * same frozen row schema (FORECAST-CONTRACTS §4) — sampled from a seed
 * namespace no training run can reach, and NEVER downsampled: every calm
 * negative survives, so every metric estimates natural prevalence with unit
 * importance weights and no reweighting correction to get wrong.
 *
 * WHY IT IS NOT CONTAMINATED. Three independent barriers, defined and checked
 * in `holdout-namespace.ts`, all re-verified on every run of this script:
 *
 *   1. SEED — base seed shifted by HOLDOUT_SEED_OFFSET and session index by
 *      HOLDOUT_INDEX_BASE, so the string `simulate.ts` hashes into a PRNG seed
 *      differs from every training string in two places. Checked by
 *      intersecting the hold-out seeds with the seeds of the real training
 *      corpus on disk AND with every seed a training run of up to `--sweep`
 *      sessions could produce at any base seed of interest.
 *   2. ID — hold-out sessions are `hld-…`; training rows are `syn-`/`aug-`/
 *      `adp-`. Checked against the distinct `session_id` set of the actual
 *      `dataset.jsonl` every contender in the bake-off read, and re-checked by
 *      `eval.ts --holdout` before it scores a frame.
 *   3. CONTENT — every hold-out session's raw focus+desk stream is hashed and
 *      compared against the hash of every session that has ever entered the
 *      training dataset: the 240 simulated ones AND the locally augmented ones
 *      regenerated here from the same deterministic transform. Equal hashes
 *      would mean a model really could have seen the stream; the run aborts.
 *
 * Deterministic: no wall-clock value enters the manifest, and the sha-256 of
 * both output files is recorded, so a regeneration that differs by one byte is
 * visible in a diff of `holdout-manifest.json`.
 */

/**
 * Sessions to generate by default — 18.75× the 48-session eval split, which on
 * this generator's drift rate lands ~1 230 onsets, comfortably past the 800 the
 * power target asks for. Changing this changes the published corpus: the
 * numbers in the report are re-derivable only because `npm run forecast:evalset`
 * with no flags reproduces exactly this.
 */
const DEFAULT_HOLDOUT_SESSIONS = 900;

/** Requirements this corpus exists to satisfy (reported, never silently missed). */
const POWER_TARGET_SESSIONS = 600;
const POWER_TARGET_ONSETS = 800;

/** The 48-session baseline this corpus is scaling up from (GAUNTLET round 8). */
const REFERENCE_SESSIONS = 48;
const REFERENCE_PAIRED_SE = 0.009;

interface EvalsetConfig {
  sessions: number;
  /** The TRAINING base seed. The hold-out corpus runs at `seed + offset`. */
  baseSeed: number;
  outDir: string;
  trainRaw: string;
  trainData: string;
  trainManifest: string;
  augmentFraction: number;
  sweepSessions: number;
  auditOnly: boolean;
}

function readConfig(): EvalsetConfig {
  return {
    sessions: Math.max(1, Math.round(numberArg("--sessions", DEFAULT_HOLDOUT_SESSIONS))),
    baseSeed: numberArg("--seed", 42),
    outDir: stringArg("--out", holdoutRoot()),
    trainRaw: stringArg("--train-raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    trainData: stringArg("--train-data", join(forecastDataRoot(), DATASET_FILE)),
    trainManifest: stringArg("--train-manifest", join(forecastDataRoot(), MANIFEST_FILE)),
    augmentFraction: numberArg("--augment-fraction", 0.25),
    sweepSessions: Math.max(0, Math.round(numberArg("--sweep", 20_000))),
    auditOnly: boolFlag("--audit-only"),
  };
}

// ---------------------------------------------------------------------------
// Hashed line writer — the output sha is the determinism receipt
// ---------------------------------------------------------------------------

class HashedWriter {
  private readonly hash = createHash("sha256");
  private readonly stream: WriteStream;
  public bytes = 0;

  constructor(file: string) {
    this.stream = createWriteStream(file, "utf8");
  }

  async write(line: string): Promise<void> {
    this.hash.update(line);
    this.bytes += Buffer.byteLength(line);
    if (!this.stream.write(line)) {
      await new Promise<void>((resolve) => this.stream.once("drain", () => resolve()));
    }
  }

  async close(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end(() => resolve());
      this.stream.on("error", reject);
    });
    return this.hash.digest("hex");
  }
}

// ---------------------------------------------------------------------------
// Audit of the TRAINING corpus — what every contender was allowed to see
// ---------------------------------------------------------------------------

interface TrainingFootprint {
  /** contentHash → session id, over every session that entered the dataset. */
  contentHashes: Map<string, string>;
  seeds: Set<number>;
  ids: Set<string>;
  datasetSessionIds: Set<string>;
  syntheticSessions: number;
  augmentedSessions: number;
  datasetRows: number;
  manifest: Record<string, unknown> | null;
  scanned: { raw: boolean; dataset: boolean };
}

async function auditTrainingCorpus(config: EvalsetConfig): Promise<TrainingFootprint> {
  const footprint: TrainingFootprint = {
    contentHashes: new Map(),
    seeds: new Set(),
    ids: new Set(),
    datasetSessionIds: new Set(),
    syntheticSessions: 0,
    augmentedSessions: 0,
    datasetRows: 0,
    manifest: null,
    scanned: { raw: false, dataset: false },
  };

  if (existsSync(config.trainManifest)) {
    footprint.manifest = JSON.parse(readFileSync(config.trainManifest, "utf8")) as Record<string, unknown>;
  }

  // --- The raw training streams, plus the augmented copies derived from them.
  if (existsSync(config.trainRaw)) {
    footprint.scanned.raw = true;
    const trainSplit: RawSession[] = [];
    const lines = createInterface({
      input: createReadStream(config.trainRaw, "utf8"),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const session = JSON.parse(trimmed) as RawSession;
      footprint.syntheticSessions += 1;
      footprint.ids.add(session.id);
      footprint.seeds.add(session.seed);
      footprint.contentHashes.set(sessionContentHash(session), session.id);
      // build-dataset.ts feeds exactly the TRAIN-split sessions, in file order,
      // to the local augmenter — reproduce that pool to hash its output too.
      if (splitForSession(session.id, config.baseSeed) === "train") {
        trainSplit.push(session);
      }
    }
    const augmented = augmentLocal(trainSplit, {
      fraction: config.augmentFraction,
      seed: config.baseSeed,
    });
    footprint.augmentedSessions = augmented.length;
    for (const session of augmented) {
      footprint.ids.add(session.id);
      footprint.seeds.add(session.seed);
      footprint.contentHashes.set(sessionContentHash(session), session.id);
    }
    trainSplit.length = 0;
    augmented.length = 0;
  } else {
    console.warn(
      `WARN ${config.trainRaw} missing — the content-level audit cannot run. ` +
        `Run 'npm run forecast:simulate' first for the full contamination proof.`,
    );
  }

  // --- The dataset file every trainer and every bake-off contender read.
  if (existsSync(config.trainData)) {
    footprint.scanned.dataset = true;
    const idPattern = /"session_id":"([^"]+)"/;
    const lines = createInterface({
      input: createReadStream(config.trainData, "utf8"),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line) {
        continue;
      }
      footprint.datasetRows += 1;
      const match = idPattern.exec(line);
      if (match?.[1] !== undefined) {
        footprint.datasetSessionIds.add(match[1]);
      }
    }
  } else {
    console.warn(`WARN ${config.trainData} missing — skipping the dataset id scan.`);
  }

  return footprint;
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

interface Counts {
  sessions: number;
  sessionsByArchetype: Record<string, number>;
  durationSec: number;
  rawFrames: number;
  excludedFrames: number;
  rows: number;
  positives: number;
  onsets: number;
  onsetsByArchetype: Record<string, number>;
  onsetsByType: Record<string, number>;
  /** Rows the TRAIN path's calm-negative downsampling would have discarded. */
  wouldDownsample: number;
  eligible: { lead20: LeadCounts; lead10: LeadCounts };
}

interface LeadCounts {
  positives: number;
  negatives: number;
}

function newCounts(): Counts {
  return {
    sessions: 0,
    sessionsByArchetype: {},
    durationSec: 0,
    rawFrames: 0,
    excludedFrames: 0,
    rows: 0,
    positives: 0,
    onsets: 0,
    onsetsByArchetype: {},
    onsetsByType: {},
    wouldDownsample: 0,
    eligible: { lead20: { positives: 0, negatives: 0 }, lead10: { positives: 0, negatives: 0 } },
  };
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  mkdirSync(config.outDir, { recursive: true });

  // Every simulator lever is inherited from simulate.readConfig() — same
  // archetype mix, same hazards, same desk model — then lifted into the
  // hold-out seed namespace. The ONLY things that change are the seed, the
  // session index and the name.
  const sim = { ...holdoutSimConfig(readSimConfig()), sessions: config.sessions };
  const rawFile = join(config.outDir, HOLDOUT_SESSIONS_FILE);
  const dataFile = join(config.outDir, HOLDOUT_DATASET_FILE);
  sim.out = rawFile;

  console.log(
    `hold-out namespace: seed ${config.baseSeed} + ${HOLDOUT_SEED_OFFSET} = ${sim.seed} | ` +
      `index base ${HOLDOUT_INDEX_BASE} | ids ${HOLDOUT_SESSION_PREFIX}…`,
  );

  const footprint = await auditTrainingCorpus(config);
  console.log(
    `training footprint: ${footprint.syntheticSessions} simulated + ${footprint.augmentedSessions} ` +
      `augmented sessions hashed | ${footprint.datasetSessionIds.size} distinct session ids across ` +
      `${footprint.datasetRows} dataset rows`,
  );

  if (config.auditOnly) {
    console.log("--audit-only: training footprint scanned, no corpus generated");
    return;
  }

  const rawOut = new HashedWriter(rawFile);
  const dataOut = new HashedWriter(dataFile);
  const counts = newCounts();
  const holdoutSeeds = new Set<number>();
  const holdoutIds = new Set<string>();

  for (let i = 0; i < config.sessions; i += 1) {
    // The archetype mix is a property of the LOCAL index within this corpus,
    // so a 900-session hold-out set carries the same proportions as a
    // 240-session training set. The seed is a property of the OFFSET index.
    const archetype = archetypeForIndex(i, config.sessions, sim.weights);
    const index = holdoutSessionIndex(i);
    const generated = simulateSession(index, archetype, sim);

    // The namespace module mirrors simulate.ts's seed derivation so it can
    // enumerate seeds for sessions it does not generate. Assert the mirror
    // against reality on every session — a refactor of either side fails here
    // instead of silently weakening the disjointness proof.
    const expectedSeed = sessionSeedFor(sim.seed, index, archetype);
    if (generated.seed !== expectedSeed) {
      throw new Error(
        `seed derivation mirror drifted: simulate.ts produced ${generated.seed}, ` +
          `holdout-namespace.sessionSeedFor says ${expectedSeed} (session ${index}/${archetype})`,
      );
    }

    const session: RawSession = { ...generated, id: holdoutSessionId(i) };
    const contentHash = sessionContentHash(session);
    assertContentDisjoint(contentHash, session.id, footprint.contentHashes);
    holdoutSeeds.add(session.seed);
    holdoutIds.add(session.id);

    await rawOut.write(`${JSON.stringify(session)}\n`);

    // Identical replay/label/censor path as build-dataset.ts — shared core,
    // shared helpers, no reimplementation of eligibility anywhere.
    const { frames, labels, onsets } = labelSession(session);
    counts.sessions += 1;
    counts.durationSec += session.durationSec;
    counts.rawFrames += frames.length;
    counts.onsets += onsets.length;
    bump(counts.sessionsByArchetype, session.archetype);
    bump(counts.onsetsByArchetype, session.archetype, onsets.length);
    for (const onset of onsets) {
      bump(counts.onsetsByType, onset.driftType);
    }

    for (let f = 0; f < frames.length; f += 1) {
      const frame = frames[f];
      const label = labels[f];
      if (!frame || !label) {
        continue;
      }
      if (label.excluded) {
        counts.excludedFrames += 1;
        continue;
      }
      // NO DOWNSAMPLING. The train path drops 75 % of calm negatives and
      // train.ts undoes it with 1/keepProbability importance weights; an
      // evaluation set that needs a reweighting correction to estimate
      // prevalence is one more thing to get wrong, so this corpus keeps every
      // eligible frame and every row carries weight 1. The count below records
      // exactly what the train rule WOULD have discarded.
      if (keepProbability(label.label, label.secsToDrift) < 1) {
        counts.wouldDownsample += 1;
      }

      const raw = {} as Record<ForecastFeatureKey, number>;
      for (const key of FORECAST_FEATURE_KEYS) {
        raw[key] = round4(frame.raw[key]);
      }
      const row: DatasetRow = {
        v: 1,
        session_id: session.id,
        source: "synthetic",
        archetype: session.archetype,
        split: "eval",
        t: frame.t,
        features: frame.values.map(round6),
        raw,
        label: label.label,
        secs_to_drift: label.secsToDrift,
        drift_type: label.driftType,
        prompt: promptFor(raw),
        completion: label.label === 1 ? "DRIFT" : "STAY",
      };
      await dataOut.write(`${JSON.stringify(row)}\n`);

      counts.rows += 1;
      counts.positives += label.label;
      for (const [key, lead] of [
        ["lead20", 20],
        ["lead10", 10],
      ] as const) {
        const eligible = label.secsToDrift === null || label.secsToDrift >= lead;
        if (!eligible) {
          continue;
        }
        const bucket = counts.eligible[key];
        if (label.label === 1) {
          bucket.positives += 1;
        } else {
          bucket.negatives += 1;
        }
      }
    }

    if ((i + 1) % 120 === 0) {
      console.log(
        `  ${i + 1}/${config.sessions} sessions | ${counts.onsets} onsets | ${counts.rows} rows | ` +
          `${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
      );
    }
  }

  const rawSha = await rawOut.close();
  const dataSha = await dataOut.close();

  // --- Barriers 1 and 2, over the whole corpus -------------------------------
  const seedAudit: SeedDisjointness = assertSeedNamespaceDisjoint(
    holdoutSeeds,
    footprint.seeds,
    [...new Set([config.baseSeed, 42, 0, 1, 7, 2026])],
    config.sweepSessions,
  );
  assertIdNamespaceDisjoint(holdoutIds, footprint.ids, "raw-sessions.jsonl");
  assertIdNamespaceDisjoint(holdoutIds, footprint.datasetSessionIds, "dataset.jsonl");
  for (const prefix of TRAINING_SESSION_PREFIXES) {
    for (const id of holdoutIds) {
      if (id.startsWith(prefix)) {
        throw new Error(`hold-out id ${id} uses training prefix ${prefix}`);
      }
    }
  }
  if ((counts.sessionsByArchetype["research_churn"] ?? 0) === 0) {
    throw new Error(
      "no research_churn sessions in the hold-out corpus — the anti-if-else slice would be empty",
    );
  }

  // --- Power bookkeeping -----------------------------------------------------
  const scale = Math.sqrt(counts.sessions / REFERENCE_SESSIONS);
  const projectedSe = REFERENCE_PAIRED_SE / scale;
  const meetsTarget =
    counts.sessions >= POWER_TARGET_SESSIONS && counts.onsets >= POWER_TARGET_ONSETS;

  const manifest = {
    version: 1,
    kind: "forecast-holdout-evalset",
    gitCommit: gitCommit(),
    // No wall-clock field anywhere: this manifest is a function of the code and
    // the flags, so two runs of `npm run forecast:evalset` must diff to nothing.
    regenerate: "npm run forecast:evalset",
    consume: "npm run forecast:eval:holdout",
    namespace: {
      baseSeed: config.baseSeed,
      holdoutSeed: sim.seed,
      seedOffset: HOLDOUT_SEED_OFFSET,
      indexBase: HOLDOUT_INDEX_BASE,
      sessionIndexRange: [holdoutSessionIndex(0), holdoutSessionIndex(config.sessions - 1)],
      sessionIdPrefix: HOLDOUT_SESSION_PREFIX,
      trainingIdPrefixes: [...TRAINING_SESSION_PREFIXES],
      splitField: "eval (literal, never hashed — splitForSession is not consulted)",
      definedIn: "scripts/forecast/holdout-namespace.ts",
    },
    contamination: {
      claim:
        "no model in the bake-off, and no model the trainer has produced, has ever seen these " +
        "sessions: they did not exist when those models were fitted, they carry seeds no training " +
        "run can derive, ids no training row uses, and streams that hash to nothing in the " +
        "training corpus.",
      barrier1SeedDerivation: seedAudit,
      barrier2IdNamespace: {
        holdoutIds: holdoutIds.size,
        trainingIdsInRawCorpus: footprint.ids.size,
        distinctSessionIdsInDatasetJsonl: footprint.datasetSessionIds.size,
        datasetRowsScanned: footprint.datasetRows,
        overlap: 0,
      },
      barrier3StreamContent: {
        trainingStreamsHashed: footprint.contentHashes.size,
        syntheticSessions: footprint.syntheticSessions,
        augmentedSessionsRegenerated: footprint.augmentedSessions,
        holdoutStreamsHashed: holdoutIds.size,
        collisions: 0,
        note:
          "hashes cover archetype + duration + every focus and desk event, not ids or seeds, so " +
          "a renamed copy of a training session would still be caught",
      },
      scanned: footprint.scanned,
      trainingManifest: footprint.manifest === null
        ? null
        : {
            seed: (footprint.manifest as { seed?: unknown }).seed ?? null,
            mode: (footprint.manifest as { mode?: unknown }).mode ?? null,
            gitCommit: (footprint.manifest as { gitCommit?: unknown }).gitCommit ?? null,
            adaptionMergedRows:
              ((footprint.manifest as { adaption?: { mergedRows?: number } }).adaption?.mergedRows) ?? 0,
          },
    },
    generator: {
      script: "scripts/forecast/build-evalset.ts",
      simulator: "scripts/forecast/simulate.ts (unmodified)",
      replay: "lib.labelSession → TelemetryRing + classify + extractFeatures + findDriftOnsets/labelFrames",
      schema: "docs/FORECAST-CONTRACTS.md §4 (identical to dataset.jsonl rows), split always 'eval'",
      archetypeWeights: sim.weights,
      deskHz: sim.deskHz,
      hazardScale: sim.hazardScale,
      minutes: [sim.minMinutes, sim.maxMinutes],
      webcamOffProb: sim.webcamOffProb,
      greyVocab: sim.greyVocab,
    },
    sampling: {
      calmNegativeDownsampling: "NONE — every eligible frame is kept",
      keepProbability: 1,
      importanceWeight: 1,
      naturalPrevalence: true,
      framesTheTrainRuleWouldHaveDropped: counts.wouldDownsample,
      note:
        "the train path keeps all negatives within 120 s of an onset and 25 % of calm stretches, " +
        "then train.ts undoes it with 1/keepProbability weights. This corpus needs no such " +
        "correction: metrics computed on it are already at natural prevalence.",
    },
    counts: {
      sessions: counts.sessions,
      sessionsByArchetype: counts.sessionsByArchetype,
      archetypeMix: archetypeMix(counts.sessionsByArchetype),
      hours: round4(counts.durationSec / 3600),
      driftOnsets: counts.onsets,
      driftOnsetsByArchetype: counts.onsetsByArchetype,
      driftOnsetsByType: counts.onsetsByType,
      rawFrames: counts.rawFrames,
      excludedFrames: counts.excludedFrames,
      rows: counts.rows,
      positives: counts.positives,
      baseRate: round6(counts.positives / Math.max(1, counts.rows)),
      leadCensored: {
        lead20: counts.eligible.lead20,
        lead10: counts.eligible.lead10,
      },
    },
    power: {
      targetSessions: POWER_TARGET_SESSIONS,
      targetDriftOnsets: POWER_TARGET_ONSETS,
      meetsTarget,
      referenceEvalSessions: REFERENCE_SESSIONS,
      referencePairedSe: REFERENCE_PAIRED_SE,
      sessionScale: round4(counts.sessions / REFERENCE_SESSIONS),
      projectedPairedSe: round6(projectedSe),
      projectedResolvableDiff95: round6(1.96 * projectedSe),
      note:
        "projection only — SE scales as 1/√(independent clusters) and sessions are the cluster. " +
        "The MEASURED paired session-clustered bootstrap SE is produced by " +
        "`npm run forecast:eval:holdout` and written to eval-report-holdout.json.",
    },
    files: {
      rawSessions: { path: HOLDOUT_SESSIONS_FILE, bytes: rawOut.bytes, sha256: rawSha },
      dataset: { path: HOLDOUT_DATASET_FILE, bytes: dataOut.bytes, sha256: dataSha },
    },
  };
  writeFileSync(
    join(config.outDir, HOLDOUT_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `hold-out corpus → ${config.outDir} (${seconds}s): ${counts.sessions} sessions | ` +
      `${counts.onsets} drift onsets | ${round4(counts.durationSec / 3600)} h | ${counts.rows} rows ` +
      `(${counts.positives} pos, ${(100 * counts.positives) / Math.max(1, counts.rows)}% — natural prevalence)`,
  );
  console.log(
    `  lead≥20s eligible: ${counts.eligible.lead20.positives} positives vs ` +
      `${counts.eligible.lead20.negatives} calm | lead≥10s: ${counts.eligible.lead10.positives} vs ` +
      `${counts.eligible.lead10.negatives}`,
  );
  console.log(
    `  archetypes ${JSON.stringify(counts.sessionsByArchetype)} | onsets ${JSON.stringify(counts.onsetsByArchetype)}`,
  );
  console.log(
    `  contamination: seeds ${seedAudit.holdoutSeeds} vs ${seedAudit.trainCorpusSeeds} corpus + ` +
      `${seedAudit.sweptSeeds} swept (0 collisions) | ids 0 shared | streams 0 of ` +
      `${footprint.contentHashes.size} training hashes matched`,
  );
  console.log(
    `  power: ${round4(counts.sessions / REFERENCE_SESSIONS)}× the 48-session split → projected ` +
      `paired SE ${round6(projectedSe)} (was ${REFERENCE_PAIRED_SE}); measure it with ` +
      `'npm run forecast:eval:holdout'`,
  );
  if (!meetsTarget) {
    console.warn(
      `WARN this corpus does NOT meet the power target (${POWER_TARGET_SESSIONS} sessions / ` +
        `${POWER_TARGET_ONSETS} onsets): it has ${counts.sessions} / ${counts.onsets}. ` +
        `Metrics from it are as underpowered as the 48-session split — say so if you publish them.`,
    );
  }
}

const invokedDirectly = process.argv[1]?.endsWith("build-evalset.ts") ?? false;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
