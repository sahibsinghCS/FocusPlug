import { createHash } from "node:crypto";
import { join } from "node:path";
import { ARCHETYPES, type Archetype, type SimConfig } from "./simulate";
import { deriveSeed, forecastDataRoot, type RawSession } from "./lib";

/**
 * THE HOLD-OUT SEED NAMESPACE — the one place that defines what "disjoint from
 * training data" means for the Focus Forecast power corpus, as executable
 * constants and assertions rather than a promise in a comment.
 *
 * Background. The training corpus is produced by
 * `scripts/forecast/simulate.ts` under base seed `--seed` (42 in every
 * committed run). For session `i` of archetype `a` it derives the PRNG seed
 *
 *     mulberry32( fnv1a32(`${seed}:session:${i}:${a}`) )        // simulate.ts
 *
 * and names the session `syn-` + zero-padded `i`. `build-dataset.ts` then
 * splits by `fnv1a32(`split:${seed}:${id}`) % 5`, so both the *content* and the
 * *split* of every training row descend from that one string.
 *
 * The hold-out corpus moves BOTH coordinates of that derivation and the name:
 *
 *   | coordinate    | training corpus          | hold-out corpus                  |
 *   |---------------|--------------------------|----------------------------------|
 *   | base seed     | `seed` (42)              | `seed + HOLDOUT_SEED_OFFSET`     |
 *   | session index | `0 … sessions-1`         | `HOLDOUT_INDEX_BASE + i`         |
 *   | session id    | `syn-000000 …`           | `hld-000000 …`                   |
 *   | split field   | seeded hash, 80/20       | literal `"eval"`, always         |
 *
 * Three independent barriers, any ONE of which is sufficient: the derivation
 * strings cannot collide unless fnv1a32 collides (checked, not assumed — see
 * `assertSeedNamespaceDisjoint`), the session ids live in a different prefix
 * namespace (checked against the actual `dataset.jsonl` every contender read),
 * and the raw event streams are compared by content hash against every session
 * that has ever entered the training dataset — synthetic AND locally augmented
 * (`assertContentDisjoint`).
 *
 * Nothing here is advisory. `build-evalset.ts` runs all three assertions on
 * every generation, and `eval.ts --holdout` re-checks the id namespace before
 * it scores a single frame.
 */

// ---------------------------------------------------------------------------
// The namespace itself
// ---------------------------------------------------------------------------

/**
 * Added to the base seed for the hold-out corpus. Large, round and far outside
 * any seed a human types on the command line, so `--seed 43` (or 100, or 2026)
 * on the training side can never wander into hold-out territory: the training
 * seed would have to be ≥ 700 000 000 for the two ranges to touch.
 */
export const HOLDOUT_SEED_OFFSET = 700_000_000;

/**
 * Added to the session index. Independent of the seed offset on purpose — a
 * mistake that reverts one of the two still leaves the derivation strings
 * disjoint. 9 000 000 is ~37 500× the largest corpus anyone has simulated.
 */
export const HOLDOUT_INDEX_BASE = 9_000_000;

/** Hold-out session ids. `syn-` = simulated train, `aug-` = locally augmented. */
export const HOLDOUT_SESSION_PREFIX = "hld-";

/** Every id prefix that has ever appeared in `dataset.jsonl`. */
export const TRAINING_SESSION_PREFIXES = ["syn-", "aug-", "adp-"] as const;

/** Directory for everything this corpus produces (under gitignored `data/`). */
export function holdoutRoot(): string {
  return join(forecastDataRoot(), "holdout");
}

export const HOLDOUT_SESSIONS_FILE = "holdout-sessions.jsonl";
export const HOLDOUT_DATASET_FILE = "holdout-dataset.jsonl";
export const HOLDOUT_MANIFEST_FILE = "holdout-manifest.json";
export const HOLDOUT_REPORT_FILE = "eval-report-holdout.json";

/** The base seed shifted into the hold-out namespace. */
export function holdoutSeed(baseSeed: number): number {
  return baseSeed + HOLDOUT_SEED_OFFSET;
}

/** The session index shifted into the hold-out namespace. */
export function holdoutSessionIndex(i: number): number {
  return HOLDOUT_INDEX_BASE + i;
}

export function holdoutSessionId(i: number): string {
  return `${HOLDOUT_SESSION_PREFIX}${String(i).padStart(6, "0")}`;
}

export function isHoldoutSessionId(id: string): boolean {
  return id.startsWith(HOLDOUT_SESSION_PREFIX);
}

/**
 * Lifts a simulator config into the hold-out namespace. Every other lever
 * (`--weights`, `--desk-hz`, `--hazard`, `--minutes-*`, …) is inherited
 * unchanged from `simulate.readConfig()`, so the hold-out corpus is the SAME
 * generative process as training — same six archetypes at the same mix,
 * including `research_churn` — sampled from a disjoint seed namespace.
 */
export function holdoutSimConfig(base: SimConfig): SimConfig {
  return {
    ...base,
    seed: holdoutSeed(base.seed),
    out: join(holdoutRoot(), HOLDOUT_SESSIONS_FILE),
  };
}

/**
 * The per-session PRNG seed `simulate.simulateSession` derives. Mirrored here
 * so the audit can enumerate seeds for sessions it does not generate (the
 * training sweep). `build-evalset.ts` asserts this against the `seed` field of
 * a really-generated session, so the mirror cannot silently drift.
 */
export function sessionSeedFor(seed: number, index: number, archetype: string): number {
  return deriveSeed(seed, `session:${index}:${archetype}`);
}

// ---------------------------------------------------------------------------
// Barrier 1 — seed derivation
// ---------------------------------------------------------------------------

export interface SeedDisjointness {
  /** Per-session seeds the hold-out corpus actually used. */
  holdoutSeeds: number;
  /** Seeds observed in the real training corpus on disk. */
  trainCorpusSeeds: number;
  /** Seeds a training run of up to `sweepSessions` sessions COULD produce. */
  sweptSeeds: number;
  sweepSessions: number;
  sweepBaseSeeds: number[];
  collisions: string[];
}

/**
 * Enumerates every per-session seed a training run could produce — all
 * archetypes × indices `0 … sweepSessions` × each base seed of interest, plus
 * the `augment:` labels `augment-local.ts` derives from — and asserts the
 * hold-out seeds intersect none of them. This is the check that turns "a
 * different seed" into "provably different streams": fnv1a32 is 32 bits, so a
 * collision is unlikely rather than impossible, and unlikely is not a proof.
 */
export function assertSeedNamespaceDisjoint(
  holdoutSeeds: ReadonlySet<number>,
  trainCorpusSeeds: ReadonlySet<number>,
  sweepBaseSeeds: readonly number[],
  sweepSessions: number,
): SeedDisjointness {
  const collisions: string[] = [];
  for (const seed of trainCorpusSeeds) {
    if (holdoutSeeds.has(seed)) {
      collisions.push(`train-corpus seed ${seed}`);
    }
  }
  const swept = new Set<number>();
  for (const base of sweepBaseSeeds) {
    for (let i = 0; i <= sweepSessions; i += 1) {
      for (const archetype of ARCHETYPES) {
        swept.add(sessionSeedFor(base, i, archetype));
      }
      swept.add(deriveSeed(base, `augment:${i}`));
      swept.add(deriveSeed(base, `downsample:syn-${String(i).padStart(6, "0")}`));
    }
  }
  for (const seed of holdoutSeeds) {
    if (swept.has(seed)) {
      collisions.push(`swept training seed ${seed}`);
    }
  }
  if (collisions.length > 0) {
    throw new Error(
      `HOLD-OUT SEED NAMESPACE VIOLATED — ${collisions.length} collision(s) with training ` +
        `seeds: ${collisions.slice(0, 5).join(", ")}. Raise HOLDOUT_SEED_OFFSET / ` +
        `HOLDOUT_INDEX_BASE in scripts/forecast/holdout-namespace.ts and regenerate; do NOT ` +
        `publish a metric from this corpus until it passes.`,
    );
  }
  return {
    holdoutSeeds: holdoutSeeds.size,
    trainCorpusSeeds: trainCorpusSeeds.size,
    sweptSeeds: swept.size,
    sweepSessions,
    sweepBaseSeeds: [...sweepBaseSeeds],
    collisions,
  };
}

// ---------------------------------------------------------------------------
// Barrier 2 — session-id namespace
// ---------------------------------------------------------------------------

export function assertIdNamespaceDisjoint(
  holdoutIds: ReadonlySet<string>,
  trainingIds: ReadonlySet<string>,
  where: string,
): void {
  const overlap: string[] = [];
  for (const id of holdoutIds) {
    if (trainingIds.has(id)) {
      overlap.push(id);
    }
  }
  for (const id of trainingIds) {
    if (isHoldoutSessionId(id)) {
      overlap.push(`${id} (hold-out id found in ${where})`);
    }
  }
  if (overlap.length > 0) {
    throw new Error(
      `HOLD-OUT ID NAMESPACE VIOLATED in ${where} — ${overlap.length} shared session id(s): ` +
        overlap.slice(0, 5).join(", "),
    );
  }
}

// ---------------------------------------------------------------------------
// Barrier 3 — raw stream content
// ---------------------------------------------------------------------------

/**
 * Hash of the behavior a session actually contains — archetype, duration and
 * every focus/desk event — deliberately NOT of its id or seed, so two sessions
 * that differ only in name still hash the same. Equal hashes would mean a
 * model really could have seen this stream; unequal hashes across the whole
 * training corpus is the direct, content-level form of the claim.
 */
export function sessionContentHash(session: RawSession): string {
  const hash = createHash("sha256");
  hash.update(`${session.archetype}|${session.durationSec}|`);
  for (const event of session.focus) {
    hash.update(`f${event.ts}:${event.proc}:${event.title}:${event.allow ? 1 : 0}${event.block ? 1 : 0}\n`);
  }
  for (const event of session.desk) {
    hash.update(`d${event.ts}:${event.on ? 1 : 0}:${event.label}:${event.conf}\n`);
  }
  return hash.digest("hex");
}

export function assertContentDisjoint(
  holdoutHash: string,
  holdoutId: string,
  trainingHashes: ReadonlyMap<string, string>,
): void {
  const twin = trainingHashes.get(holdoutHash);
  if (twin !== undefined) {
    throw new Error(
      `HOLD-OUT CONTENT COLLISION — ${holdoutId} is byte-identical in behavior to training ` +
        `session ${twin}. The corpus is contaminated; do not publish a metric from it.`,
    );
  }
}

/** Archetype mix helper — the eval corpus must carry the training mix. */
export function archetypeMix(counts: Record<string, number>): Record<Archetype, number> {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0) || 1;
  const mix = {} as Record<Archetype, number>;
  for (const archetype of ARCHETYPES) {
    mix[archetype] = Number(((counts[archetype] ?? 0) / total).toFixed(4));
  }
  return mix;
}
