import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { csvWithClip } from "./capture-plan";
import { clipCollision, clipSplit, formatAttentionRow } from "./first-person";
import { attentionLabelsFile, dataRoot, readAttentionLabels, type AttentionLabelRow } from "./lib";
import { readCorrections, type StoredCorrection } from "./refit-io";

/**
 * Copy a student's stored corrections into the desk-data pack and the labels
 * CSV, so first-person corrections can eventually reach the SHIPPED attention
 * head — the long-run point of collecting them.
 *
 *   npm run corrections:export -- --from <a desk-corrections dir> --dry-run
 *   FOCUSPLUG_DESK_DATA=... npm run corrections:export -- --from <dir>
 *
 * READ THIS FIRST. This is a DEVELOPER command, run by a developer on their
 * own machine, against a directory they already have. It is not in the shipped
 * app, no UI reaches it, and the app contains no code that transmits a
 * correction anywhere. The frames are somebody's webcam images of somebody's
 * room: moving them into a training pack is a decision a person makes once,
 * deliberately, with `--dry-run` first — which is why this exists as a script
 * with a flag rather than as a button with a spinner.
 *
 * WHAT IT DOES, and what it refuses to do:
 *
 * 1. copies `frames/<dc-NNNN>/frame-*.jpg` into the pack at
 *    `first-person/corrections/<dc-NNNN>/`, never into the repo;
 * 2. writes rows into `datasets/desk-attention-labels.csv` in its existing ten
 *    columns, through the SAME `csvWithClip` group replacement the capture
 *    tool uses, so re-exporting a correction REPLACES its rows rather than
 *    duplicating a path;
 * 3. refuses a group id that already exists with a different label or split —
 *    `clipCollision`'s rule, reused rather than reimplemented;
 * 4. prints the census in CORRECTIONS, never frames, and prints no accuracy at
 *    all. Nothing here is a measurement.
 *
 * Because the rows land under `first-person/`, everything downstream already
 * handles them: `extract-features.ts` picks them up by path prefix,
 * `readFeatureRows` keeps them away from the presence head,
 * `train-attention.ts` group-splits them and `--first-person-weight` weighs
 * them, and `eval-attention.ts` gates them behind the clip count. No schema
 * change, and no change to any of those four files.
 */

export const CORRECTIONS_PREFIX = "first-person/corrections/";

/**
 * The `kind × verdict` table of docs/CORRECTION-LOOP.md appendix §3, for the
 * four cells the two buttons can produce. `person` / `workspace` / `phone` /
 * `gaze` are DERIVED from the verdict, never observed — the same rule
 * self-labelled clips and bucket-labelled proxies follow, and the note on
 * every row says so.
 */
export interface CorrectionMeaningRow {
  label: string;
  head: "attention" | "presence";
  attention: string;
  packLabel: string;
  person: string;
  workspace: string;
  phoneCell: string;
  gaze: string;
}

export const CORRECTION_MEANING: Readonly<Record<string, CorrectionMeaningRow>> = {
  "phone:wrong": {
    label: "focused", head: "attention", attention: "focused", packLabel: "focused",
    person: "face_or_body", workspace: "True", phoneCell: "none", gaze: "work",
  },
  "phone:right": {
    label: "phone", head: "attention", attention: "phone", packLabel: "phone",
    person: "face_or_body", workspace: "True", phoneCell: "in_use", gaze: "phone",
  },
  "away:wrong": {
    label: "at_desk", head: "presence", attention: "", packLabel: "at_desk",
    person: "face_or_body", workspace: "True", phoneCell: "none", gaze: "work",
  },
  "away:right": {
    label: "away", head: "presence", attention: "", packLabel: "away",
    person: "none", workspace: "True", phoneCell: "none", gaze: "elsewhere",
  },
};

/** "dc-0007" -> 7. Null when the id is not one this exporter can split. */
export function correctionNumber(id: string): number | null {
  const match = /^dc-(\d+)$/.exec(id);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Where a frame lands in the pack. The `first-person/` prefix is load-bearing. */
export function exportedPath(id: string, frameFile: string): string {
  const name = frameFile.split("/").pop() ?? frameFile;
  return `${CORRECTIONS_PREFIX}${id}/${name}`;
}

/**
 * The note is where the model's own call survives next to the truth, so that
 * nobody downstream ever mistakes these rows for annotated photographs.
 */
export function correctionNote(record: StoredCorrection): string {
  const confidence = Number.isFinite(record.modelConfidence)
    ? (record.modelConfidence as number).toFixed(2)
    : "?";
  const meaning = CORRECTION_MEANING[`${record.kind}:${record.verdict}`];
  return (
    `first-person correction: the model said ${record.modelLabel || record.kind} at ${confidence}, ` +
    `the student said ${meaning?.label ?? record.label}; labelled in-app at the pause, not annotated`
  );
}

export interface ExportedGroup {
  id: string;
  rows: AttentionLabelRow[];
  /** Frame files to copy: [source relative to the corrections dir, pack path]. */
  files: Array<[string, string]>;
  head: "attention" | "presence";
  label: string;
  split: "train" | "eval";
}

export interface ExportPlan {
  groups: ExportedGroup[];
  /** id -> why it is not being exported. Printed, never silently dropped. */
  skipped: Array<[string, string]>;
  /** id -> the collision message from `clipCollision`, verbatim. */
  collisions: Array<[string, string]>;
}

/**
 * What would be written, decided before anything is. One correction is one
 * GROUP: three frames five seconds apart are one independent sample, so the
 * correction id goes in the `group` column and the train/eval split is
 * assigned per correction — exactly `clipSplit`, on the correction number.
 */
export function planExport(
  corrections: readonly StoredCorrection[],
  existing: readonly AttentionLabelRow[],
): ExportPlan {
  const groups: ExportedGroup[] = [];
  const skipped: Array<[string, string]> = [];
  const collisions: Array<[string, string]> = [];
  for (const record of corrections) {
    const meaning = CORRECTION_MEANING[`${record.kind}:${record.verdict}`];
    if (!meaning) {
      skipped.push([record.id, `no meaning for ${record.kind}:${record.verdict}`]);
      continue;
    }
    if (record.frames.length === 0) {
      skipped.push([
        record.id,
        record.capped ? "kept no photos (the store was at its cap)" : "has no frames",
      ]);
      continue;
    }
    const number = correctionNumber(record.id);
    if (number === null) {
      skipped.push([record.id, "id is not dc-NNNN, so its split cannot be assigned"]);
      continue;
    }
    // The record's own split is what the on-device refit held out, so it wins;
    // it is asserted against the rule rather than recomputed behind its back.
    const split = record.split;
    if (split !== clipSplit(number)) {
      skipped.push([
        record.id,
        `stored split ${split} disagrees with the odd-train/even-eval rule (${clipSplit(number)})`,
      ]);
      continue;
    }
    const note = correctionNote(record);
    const rows: AttentionLabelRow[] = record.frames.map((frame) => ({
      path: exportedPath(record.id, frame.file),
      split,
      group: record.id,
      attention: meaning.attention,
      person: meaning.person,
      workspace: meaning.workspace,
      phone: meaning.phoneCell,
      gaze: meaning.gaze,
      note,
      packLabel: meaning.packLabel,
    }));
    const collision = clipCollision(
      existing,
      { group: record.id, attention: meaning.attention, split },
      { retake: true },
    );
    if (collision) {
      collisions.push([record.id, collision]);
      continue;
    }
    groups.push({
      id: record.id,
      rows,
      files: record.frames.map((frame) => [frame.file, exportedPath(record.id, frame.file)]),
      head: meaning.head,
      label: meaning.label,
      split,
    });
  }
  return { groups, skipped, collisions };
}

/** In CORRECTIONS, never frames — and never an accuracy. */
export function censusLines(plan: ExportPlan): string[] {
  const byLabel: Record<string, number> = {};
  for (const group of plan.groups) {
    byLabel[group.label] = (byLabel[group.label] ?? 0) + 1;
  }
  const frames = plan.groups.reduce((sum, group) => sum + group.files.length, 0);
  const attention = plan.groups.filter((group) => group.head === "attention");
  return [
    `${plan.groups.length} correction(s) to export — ${Object.entries(byLabel)
      .map(([label, count]) => `${label} ${count}`)
      .join(", ") || "none"}`,
    `  ${frames} photo(s) across them, and one correction is ONE independent group however many photos it holds`,
    `  ${attention.length} of them are attention evidence (${attention.filter((g) => g.split === "train").length} train, ${attention.filter((g) => g.split === "eval").length} eval); the rest are presence corrections and carry no attention label`,
  ];
}

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] !== undefined
    ? (process.argv[index + 1] as string)
    : fallback;
}

function main(): void {
  const from = stringArg("--from", "");
  if (!from) {
    throw new Error(
      '--from <dir> is required: the desk-corrections directory to export ' +
        "(<userData>/desk-corrections, or a copy of one).",
    );
  }
  const directory = resolve(from);
  const dryRun = process.argv.includes("--dry-run");
  const csvFile = stringArg("--labels", attentionLabelsFile());
  // dataRoot() throws with the download instructions when the pack is absent.
  // It is only needed for the copy, so a dry run can be done without it.
  const root = dryRun && !process.env.FOCUSPLUG_DESK_DATA ? null : dataRoot();

  const stored = readCorrections(directory);
  for (const dropped of stored.dropped) {
    console.warn(`corrections.json: dropped ${dropped}`);
  }
  const existing = readAttentionLabels(csvFile);
  const plan = planExport(stored.corrections, existing);

  console.log(`corrections dir: ${directory}`);
  console.log(`pack: ${root ?? "(not needed for --dry-run)"}`);
  console.log(`labels csv: ${csvFile}`);
  for (const line of censusLines(plan)) {
    console.log(line);
  }
  for (const [id, why] of plan.skipped) {
    console.log(`  skipped ${id}: ${why}`);
  }
  for (const [id, message] of plan.collisions) {
    console.error(`REFUSED ${id}: ${message}`);
  }
  if (plan.collisions.length > 0) {
    throw new Error(
      `${plan.collisions.length} correction(s) collide with rows already in the CSV. Nothing was written — resolve them and run again.`,
    );
  }
  if (plan.groups.length === 0) {
    console.log("nothing to export");
    return;
  }

  for (const group of plan.groups) {
    for (const [source, packPath] of group.files) {
      const from = join(directory, source);
      if (!existsSync(from)) {
        throw new Error(`${group.id}: ${from} does not exist — nothing was written`);
      }
      console.log(`  ${dryRun ? "would copy" : "copy"} ${source} -> ${packPath}`);
      if (!dryRun && root) {
        const target = join(root, packPath);
        mkdirSync(join(target, ".."), { recursive: true });
        copyFileSync(from, target);
      }
    }
  }

  let text = readFileSync(csvFile, "utf8");
  let replaced = 0;
  let appended = 0;
  for (const group of plan.groups) {
    const write = csvWithClip(text, group.id, group.rows);
    text = write.text;
    replaced += write.replaced;
    appended += group.rows.length;
  }
  console.log(
    `  ${dryRun ? "would write" : "wrote"} ${appended} row(s) across ${plan.groups.length} group(s) -> ${csvFile}` +
      (replaced > 0 ? ` (replacing ${replaced} existing row(s) for those groups)` : ""),
  );
  console.log(`  first row: ${formatAttentionRow(plan.groups[0]?.rows[0] as AttentionLabelRow)}`);
  if (dryRun) {
    console.log("--dry-run: no file was copied and the CSV was not touched");
    return;
  }
  const tmp = `${csvFile}.corrections-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, csvFile);
  console.log("");
  console.log("next: re-extract features and retrain, and read the first-person numbers separately");
  console.log("  npx tsx --tsconfig tsconfig.node.json scripts/desk-model/extract-features.ts --shard 0 --of 1");
  console.log("  npx tsx --tsconfig tsconfig.node.json scripts/desk-model/train-attention.ts --hidden 16 --l2 0.03 --slices 745-2025 --exclude-proxies");
  console.log("  npx tsx --tsconfig tsconfig.node.json scripts/desk-model/eval-attention.ts");
  console.log("then rebuild the anchor pack, because the head has changed: npm run anchors:attention");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
