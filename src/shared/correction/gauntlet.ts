import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORRECTION_BOOTSTRAP_DRAWS,
  CORRECTION_GAUNTLET_MAX_FALSE_INSTALL,
  CORRECTION_GAUNTLET_MIN_TRUE_INSTALL,
  CORRECTION_GAUNTLET_SEED,
  CORRECTION_REFIT_MIN_GROUPS,
} from "./constants";
import {
  CORRECTABLE_LABELS,
  evaluateRefit,
  shippedOutputLayer,
  type AttentionAnchorRow,
  type AttentionAnchors,
  type AttentionHeadShape,
  type CorrectionGroupInput,
  type OutputLayer,
} from "./refit";
import type { AttentionLabel } from "../types";

/**
 * Does the refit gate actually decide anything?
 *
 *   npm run gauntlet:corrections
 *
 * A gate is only worth having if it can do both things. This runs it against
 * two populations of synthetic students, on the REAL shipped attention head
 * and the REAL 286 committed anchors, and fails the build unless both controls
 * hold:
 *
 *   NEGATIVE — corrections whose labels have been SHUFFLED carry no signal
 *     about anything. A gate that installs a head fitted on those is a
 *     rubber stamp. Bar: installs on fewer than
 *     `CORRECTION_GAUNTLET_MAX_FALSE_INSTALL` (5%) of runs.
 *
 *   POSITIVE — corrections drawn from a student whose camera and room really
 *     do shift the boundary a little. A gate that refuses those refuses
 *     everything, and the deferred half of the feature is dead while looking
 *     alive. Bar: installs on at least `CORRECTION_GAUNTLET_MIN_TRUE_INSTALL`
 *     (80%) of runs.
 *
 * The second bar is the one that matters here, and it is the reason this file
 * exists rather than only a shuffled-label test: this repo has a habit of
 * building gates, and a gate nobody checked in the *pass* direction is
 * indistinguishable from `return false`.
 *
 * WHAT THIS IS NOT. A simulation against simulated students, exactly like
 * `gauntlet:adapt` and `gauntlet:plan`. It says the instrument can be moved in
 * both directions by the right evidence. It says NOTHING about whether one
 * real student's corrections will pass — see `docs/CORRECTION-LOOP.md` §7.4.
 */

/** 200 a side. At 40 the false-install rate is a 2.5%-resolution estimate
 *  against a 5% bar, which is not a measurement. */
const RUNS = 200;
/** Corrections per synthetic student. The floor is 12; a student who has been
 *  correcting for a fortnight has more. */
const GROUPS = 20;

/* ── a deterministic PRNG, because a gauntlet that resamples is a sample ── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── the real head and the real anchors ─────────────────────────────────── */

const here = dirname(fileURLToPath(import.meta.url));
const weights = join(here, "..", "..", "main", "desk", "model", "weights");
const read = (file: string): unknown => JSON.parse(readFileSync(join(weights, file), "utf8"));

const head = read("attention-head.json") as AttentionHeadShape;
const anchors = read("attention-anchors.json") as AttentionAnchors;
const shipped = shippedOutputLayer(head);

/**
 * The negative control's pool: real photographs, meaningless labels.
 *
 * The hidden activations are REAL — they are anchor rows, sixteen numbers out
 * of the shipped bottleneck for real photographs. What is destroyed is the
 * relationship: the labels are the same multiset, Fisher-Yates'd, so the pool
 * is identical in size, class balance and image content and differs only in
 * carrying no information. A gate that installs a head fitted on this is a
 * rubber stamp, whatever else it prints.
 */
function shuffledPool(
  rows: readonly AttentionAnchorRow[],
  random: () => number,
): CorrectionGroupInput[] {
  const picked: AttentionAnchorRow[] = [];
  const used = new Set<number>();
  while (picked.length < GROUPS && used.size < rows.length) {
    const index = Math.floor(random() * rows.length);
    if (used.has(index)) {
      continue;
    }
    used.add(index);
    picked.push(rows[index] as AttentionAnchorRow);
  }
  const labels = picked.map((row) => row.truth);
  for (let i = labels.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = labels[i] as AttentionLabel;
    labels[i] = labels[j] as AttentionLabel;
    labels[j] = swap;
  }
  return picked.map((row, index) => ({
    id: `dc-${String(index + 1).padStart(4, "0")}`,
    label: labels[index] as AttentionLabel,
    split: index % 2 === 1 ? "train" : "eval",
    frames: [{ hidden: row.hidden, predicted: "phone", confidence: 0.6 }],
  }));
}

/**
 * The gate, run once, on one synthetic student.
 *
 * Every precondition is satisfied on purpose — the desk model is `custom`, no
 * session is running, the anchors match the head — so the only thing under
 * test is the comparison the whole feature exists for.
 */
function runOnce(groups: readonly CorrectionGroupInput[], base: OutputLayer): { installed: boolean; blockedBy: string | null; drift: number } {
  const r = evaluateRefit({
    at: 0,
    deskModelId: "custom",
    sessionActive: false,
    baseHeadHash: anchors.baseHeadHash,
    anchors,
    anchorsHash: "gauntlet",
    base,
    groups,
    // The bootstrap is reported beside the gate and never as it, so paying for
    // 2000 draws forty times over would buy this run nothing.
    bootstrapDraws: 1,
  }).report;
  return { installed: r.installed, blockedBy: r.blockedBy, drift: r.driftRatio };
}

/**
 * The positive control's student, and why they look like this.
 *
 * The obvious synthetic student — anchor rows relabelled, or the shipped head
 * nudged and asked to find its way back — is not the situation this feature is
 * for, and measuring against it says nothing. Those corrections ARE the eval
 * set: fitting on them necessarily drags the stock boundary around, so
 * `regressed-pooled` refuses, and the gate looks broken when the population
 * was wrong. (Measured: that student installs on 10% of runs at the shipped λ,
 * and on 10–20% at every λ from 0.05 to 2.0, so it is not a tuning problem.)
 *
 * The real situation is the one the whole feature exists for: FIRST-PERSON
 * frames from one webcam in one room, which is a different distribution from
 * 286 third-person stock photographs. So this student is built in the
 * bottleneck's own coordinates:
 *
 *   * they sit where the anchors sit — the centroid — because they are a
 *     person at a desk, not an outlier;
 *   * their two classes separate along `quietAxis`, the coordinate the 286
 *     anchors vary LEAST in. That is exactly what "a cue from your room the
 *     shipped head never had a reason to learn" means: your particular lamp,
 *     your particular angle, the way your phone catches the light.
 *
 * A fit that learns that axis helps them a lot and barely touches stock
 * photographs, which is how a personal head is supposed to pass a
 * do-no-harm gate. If the refit cannot install for THIS student it cannot
 * install for anyone, and the gate is a `return false` with paperwork.
 */
function quietAxis(): number {
  let best = 0;
  let bestVariance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < anchors.hiddenDim; i += 1) {
    let sum = 0;
    for (const row of anchors.rows) {
      sum += row.hidden[i] ?? 0;
    }
    const mean = sum / anchors.rows.length;
    let variance = 0;
    for (const row of anchors.rows) {
      variance += ((row.hidden[i] ?? 0) - mean) ** 2;
    }
    variance /= anchors.rows.length;
    if (variance < bestVariance) {
      bestVariance = variance;
      best = i;
    }
  }
  return best;
}

function centroid(): number[] {
  const out = new Array<number>(anchors.hiddenDim).fill(0);
  for (const row of anchors.rows) {
    for (let i = 0; i < anchors.hiddenDim; i += 1) {
      out[i] = (out[i] ?? 0) + (row.hidden[i] ?? 0) / anchors.rows.length;
    }
  }
  return out;
}

const AXIS = quietAxis();
const CENTRE = centroid();
/** How far along their own axis the student's two classes sit. Activations are
 *  ReLU outputs, so they are clamped at zero and never go negative. */
const SEPARATION = 3;

function firstPersonPool(random: () => number): CorrectionGroupInput[] {
  return Array.from({ length: GROUPS }, (_, index) => {
    const label = (index % 2 === 0 ? "focused" : "phone") as AttentionLabel;
    const hidden = CENTRE.map((value) => Math.max(0, value * (0.7 + random() * 0.6)));
    hidden[AXIS] = Math.max(0, label === "phone" ? SEPARATION : 0) + random() * 0.2;
    return {
      id: `dc-${String(index + 1).padStart(4, "0")}`,
      label,
      split: (index % 4 === 1 || index % 4 === 2 ? "train" : "eval") as "train" | "eval",
      frames: [{ hidden, predicted: "phone", confidence: 0.6 }],
    };
  });
}

const correctable = anchors.rows.filter(
  (row) => CORRECTABLE_LABELS.includes(row.truth) && row.hidden.length === anchors.hiddenDim,
);

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** "installed 38, regressed-pooled 2" — every run accounted for. */
function census(counts: Record<string, number>): string {
  return (
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${id} ${n}`)
      .join(", ") || "none"
  );
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

console.log(
  `the refit gate, against ${RUNS} synthetic students of ${GROUPS} corrections each — the real ` +
    `${anchors.rows.length}-image anchor pack, the real shipped head`,
);
console.log(
  `  a correction can only be ${CORRECTABLE_LABELS.join(" or ")}: the paused screen has two ` +
    `buttons, and ${anchors.rows.length - correctable.length} of the anchors are the ` +
    `\`unfocused\` class no student can ever label`,
);
console.log("");

let falseInstalls = 0;
let trueInstalls = 0;
const negBlocks: Record<string, number> = {};
const posBlocks: Record<string, number> = {};
const drifts: number[] = [];
for (let run = 0; run < RUNS; run += 1) {
  const random = mulberry32(CORRECTION_GAUNTLET_SEED + run);
  const neg = runOnce(shuffledPool(correctable, random), shipped);
  if (neg.installed) { falseInstalls += 1; }
  negBlocks[neg.blockedBy ?? "installed"] = (negBlocks[neg.blockedBy ?? "installed"] ?? 0) + 1;
  // A fresh stream per arm, so the two populations are independent rather than
  // one being the other's leftovers.
  const positive = mulberry32(CORRECTION_GAUNTLET_SEED + 1000 + run);
  const pos = runOnce(firstPersonPool(positive), shipped);
  if (pos.installed) { trueInstalls += 1; }
  posBlocks[pos.blockedBy ?? "installed"] = (posBlocks[pos.blockedBy ?? "installed"] ?? 0) + 1;
  drifts.push(pos.drift);
}

const falseRate = falseInstalls / RUNS;
const trueRate = trueInstalls / RUNS;

console.log("NEGATIVE CONTROL — the same photographs, the labels shuffled");
console.log(
  `  installed on ${falseInstalls} of ${RUNS} runs (${pct(falseRate)}); the bar is under ` +
    `${pct(CORRECTION_GAUNTLET_MAX_FALSE_INSTALL)}`,
);
console.log(
  "  a pool with no relationship between photograph and label must not produce a head anyone runs.",
);
console.log(`  which gate stopped them: ${census(negBlocks)}`);
console.log("");
console.log("POSITIVE CONTROL — a student whose own room tilts the boundary");
console.log(
  `  installed on ${trueInstalls} of ${RUNS} runs (${pct(trueRate)}); the bar is at least ` +
    `${pct(CORRECTION_GAUNTLET_MIN_TRUE_INSTALL)}`,
);
console.log(`  which gate stopped them: ${census(posBlocks)}`);
console.log(
  `  a personal head moved the output layer ${(median(drifts) * 100).toFixed(1)}% of its own ` +
    `size (median); the trust region is 50%, and at the original λ of 0.05 this was 50%`,
);
console.log(
  "  without this the gate could pass the first control by refusing everything, forever.",
);
console.log("");
console.log(
  `The floor is ${CORRECTION_REFIT_MIN_GROUPS} corrections and these students have ${GROUPS}. ` +
    `Nothing here says a real student's ${CORRECTION_REFIT_MIN_GROUPS} corrections will pass — ` +
    "the anchors are third-person stock photographs and the claim they license is do-no-harm " +
    "and nothing more (docs/CORRECTION-LOOP.md §7.4). What it says is that the instrument " +
    "moves in both directions.",
);
console.log(
  `  (the bootstrap beside the gate draws ${CORRECTION_BOOTSTRAP_DRAWS} times in the app; this ` +
    "run draws once, because it is reported and never gated on.)",
);

if (falseRate < CORRECTION_GAUNTLET_MAX_FALSE_INSTALL && trueRate >= CORRECTION_GAUNTLET_MIN_TRUE_INSTALL) {
  console.log(
    `\nPASS: the gate refused ${pct(1 - falseRate)} of shuffled-label pools and installed ` +
      `${pct(trueRate)} of the pools that carried real signal`,
  );
} else if (falseRate >= CORRECTION_GAUNTLET_MAX_FALSE_INSTALL) {
  console.error(
    `\nFAIL: the gate installed a head fitted on shuffled labels ${pct(falseRate)} of the time`,
  );
  process.exitCode = 1;
} else {
  console.error(
    `\nFAIL: the gate installed only ${pct(trueRate)} of the heads fitted on real signal — a gate ` +
      "that refuses everything is not a gate",
  );
  process.exitCode = 1;
}
