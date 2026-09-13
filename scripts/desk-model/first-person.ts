import type { AttentionLabelRow } from "./lib";

/**
 * First-person (webcam) capture: the shared rules the capture tool, the
 * trainer, the eval and the docs all read from one place.
 *
 * WHY THIS EXISTS. The attention head learned `focused` / `unfocused` /
 * `phone` from Adaption-labelled THIRD-PERSON stock photos, but the runtime
 * camera is FIRST-PERSON: in a selfie view the phone is usually below the
 * frame and the tell is the head tilting down. Webcam clips fix the domain
 * gap and they are SELF-LABELLING — record 20 seconds while deliberately on
 * your phone and every frame in that clip is a phone frame by construction.
 *
 * THE TRAP THIS MODULE EXISTS TO CLOSE. Consecutive frames of one clip are
 * near-identical, so a clip is roughly ONE independent sample no matter how
 * many frames it holds. The clip id is therefore the group key, exactly like
 * the dHash near-duplicate groups on the stock photos: the split can never
 * cut a clip in half, and no accuracy computed over first-person rows may be
 * printed without saying how many independent CLIPS are behind it.
 */

export const FIRST_PERSON_LABELS = ["focused", "unfocused", "phone"] as const;
export type FirstPersonLabel = (typeof FIRST_PERSON_LABELS)[number];

/** Every capture path starts here; it is what marks a row as first-person. */
export const FIRST_PERSON_PREFIX = "first-person/";
/** `bucket` on the cached feature rows, so the presence head can skip them. */
export const FIRST_PERSON_BUCKET = "first_person";
export const FIRST_PERSON_NOTE = "first-person webcam capture, self-labelled by clip";

export const FIRST_PERSON_DEFAULT_SECONDS = 20;
/** ~2 frames/s. Adjacent frames add nothing: they are the same photograph. */
export const FIRST_PERSON_DEFAULT_FPS = 2;
export const FIRST_PERSON_MAX_FPS = 10;
export const FIRST_PERSON_MAX_SECONDS = 300;
export const FIRST_PERSON_MAX_CLIP = 999;
export const FIRST_PERSON_COUNTDOWN_SEC = 3;
export const FIRST_PERSON_JPEG_QUALITY = 88;

/** The protocol: two focused, two phone, two unfocused. */
export const FIRST_PERSON_PROTOCOL_CLIPS = 6;

/**
 * The floor for printing ANY first-person accuracy, in the same spirit as the
 * Focus Plan trend gates (`PLAN_TREND_MIN_EVENTS` and friends): below it the
 * eval prints a refusal and the census instead of a number. Three is the
 * protocol's eval half — one clip per label — and it is already tiny; it is a
 * floor for "is this measurable at all", not a bar for "this is reliable".
 */
export const FIRST_PERSON_MIN_EVAL_GROUPS = 3;

export function isFirstPersonLabel(value: string): value is FirstPersonLabel {
  return (FIRST_PERSON_LABELS as readonly string[]).includes(value);
}

/** Throwing validator — the capture tool refuses anything else outright. */
export function assertFirstPersonLabel(value: string | undefined): FirstPersonLabel {
  if (value === undefined || value.length === 0) {
    throw new Error(`--label is required (one of ${FIRST_PERSON_LABELS.join(", ")})`);
  }
  if (!isFirstPersonLabel(value)) {
    throw new Error(
      `--label must be one of ${FIRST_PERSON_LABELS.join(", ")} — got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** The clip id IS the group key: one clip, one group, one side of the split. */
export function clipGroup(clip: number): string {
  if (!Number.isInteger(clip) || clip < 1 || clip > FIRST_PERSON_MAX_CLIP) {
    throw new Error(`--clip must be a whole number 1..${FIRST_PERSON_MAX_CLIP} — got ${clip}`);
  }
  return `fp-clip-${String(clip).padStart(3, "0")}`;
}

/**
 * Odd clips train, even clips eval. Recorded in protocol order (1-2 focused,
 * 3-4 phone, 5-6 unfocused) that lands exactly one clip per label on each
 * side, so the eval half covers all three labels with three groups.
 */
export function clipSplit(clip: number): "train" | "eval" {
  return clip % 2 === 1 ? "train" : "eval";
}

export function clipDir(label: FirstPersonLabel, clip: number): string {
  return `${FIRST_PERSON_PREFIX}${label}/${clipGroup(clip)}`;
}

export function framePath(label: FirstPersonLabel, clip: number, frameIndex: number): string {
  return `${clipDir(label, clip)}/frame-${String(frameIndex).padStart(4, "0")}.jpg`;
}

export function isFirstPersonPath(path: string): boolean {
  return path.startsWith(FIRST_PERSON_PREFIX);
}

/** The canonical marker is the path prefix; the note is free text for humans. */
export function isFirstPersonRow(row: { path: string }): boolean {
  return isFirstPersonPath(row.path);
}

/* ── one path is one image ──────────────────────────────────────────── */

export interface PathDedupe<T> {
  /** The first row for each path, in the order the paths first appeared. */
  rows: T[];
  /** Paths that appeared on more than one row, first-seen order. */
  duplicatePaths: string[];
  /** How many rows were dropped (every occurrence after the first). */
  dropped: number;
}

/**
 * A path in the CSV is ONE image on disk, so two rows carrying the same path
 * are one sample counted twice — never two samples. The stock pipeline has
 * always held this by construction (1,919 rows, 1,919 distinct paths) and
 * `extract-features.ts` already enforces it when it enumerates work; the
 * trainer and the eval must not be the two places that quietly do not.
 *
 * A duplicate path is not a rounding error there. `eval-attention.ts` would
 * score the same image twice and print frame counts for images that do not
 * exist, and `train-attention.ts` would standardize the ENTIRE run — stock
 * rows included — against a mean and std divided by a row count larger than
 * the population they were summed over.
 */
export function dedupeByPath<T extends { path: string }>(rows: readonly T[]): PathDedupe<T> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const kept: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    if (seen.has(row.path)) {
      duplicated.add(row.path);
      dropped += 1;
      continue;
    }
    seen.add(row.path);
    kept.push(row);
  }
  return { rows: kept, duplicatePaths: [...duplicated], dropped };
}

/** null when the rows were already distinct — nothing to warn about. */
export function duplicatePathWarning(dedupe: PathDedupe<unknown>, file: string): string | null {
  if (dedupe.dropped === 0) {
    return null;
  }
  const shown = dedupe.duplicatePaths.slice(0, 3);
  const more = dedupe.duplicatePaths.length - shown.length;
  return (
    `WARNING: ${file} repeats ${dedupe.duplicatePaths.length} path(s) — ${shown.join(", ")}` +
    `${more > 0 ? `, +${more} more` : ""} — so ${dedupe.dropped} row(s) were ignored. ` +
    "One path is one image on disk: a repeated path is one sample counted twice, not a new sample. " +
    "A re-recorded clip must REPLACE its rows (npm run capture:attention -- --clip N --label L --retake), never append a second copy."
  );
}

/* ── CSV, in the exact existing schema ──────────────────────────────── */

export const ATTENTION_CSV_COLUMNS = [
  "path",
  "split",
  "group",
  "attention",
  "person",
  "workspace",
  "phone",
  "gaze",
  "note",
  "pack_label",
] as const;

/** RFC 4180: quote only when the cell needs it, which is what the file does. */
export function formatCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatCsvRow(cells: readonly string[]): string {
  return cells.map(formatCsvCell).join(",");
}

export function attentionRowCells(row: AttentionLabelRow): string[] {
  return [
    row.path,
    row.split,
    row.group,
    row.attention,
    row.person,
    row.workspace,
    row.phone,
    row.gaze,
    row.note,
    row.packLabel,
  ];
}

export function formatAttentionRow(row: AttentionLabelRow): string {
  return formatCsvRow(attentionRowCells(row));
}

export interface CaptureRowInput {
  label: FirstPersonLabel;
  clip: number;
  split: "train" | "eval";
  frameIndex: number;
}

/**
 * One CSV row for one captured frame.
 *
 * `attention` is the label the user declared before recording — that
 * declaration is the ONLY ground truth here, so the four annotation columns
 * are derived from it rather than observed. `pack_label` carries the same
 * declared label (not a desk-data pack class) because that is honestly where
 * the row came from, and `group` is the clip id so the frames of one clip can
 * never straddle the train/eval split.
 */
export function buildCaptureRow({ label, clip, split, frameIndex }: CaptureRowInput): AttentionLabelRow {
  return {
    path: framePath(label, clip, frameIndex),
    split,
    group: clipGroup(clip),
    attention: label,
    person: "face_or_body",
    workspace: "True",
    phone: label === "phone" ? "in_use" : "none",
    gaze: label === "phone" ? "phone" : label === "focused" ? "work" : "elsewhere",
    note: FIRST_PERSON_NOTE,
    packLabel: label,
  };
}

export function buildCaptureRows(
  input: Omit<CaptureRowInput, "frameIndex">,
  frames: number,
): AttentionLabelRow[] {
  const rows: AttentionLabelRow[] = [];
  for (let i = 1; i <= frames; i += 1) {
    rows.push(buildCaptureRow({ ...input, frameIndex: i }));
  }
  return rows;
}

/** Rows already in the CSV for one clip — what a retake would replace. */
export function rowsInGroup(
  rows: readonly AttentionLabelRow[],
  group: string,
): AttentionLabelRow[] {
  return rows.filter((row) => row.group === group);
}

export interface ClipReuseOptions {
  /**
   * `--retake`: the recorder means to REPLACE this clip, and the caller will
   * rewrite its rows rather than append. It never relaxes the two refusals
   * below — a retake is the SAME clip re-recorded, or it is not a retake.
   */
  retake?: boolean;
}

/**
 * A clip id already in the CSV may only be re-recorded as the same label on
 * the same split, and even then only with `--retake`, because a retake is a
 * REPLACEMENT and never an addition.
 *
 * WHY IT CANNOT JUST BE ALLOWED. `framePath` is a pure function of
 * label + clip + frame index, so take two writes exactly the filenames take
 * one wrote: the images are overwritten, no new image exists. Appending a
 * second set of rows for those same paths therefore does not add data — it
 * duplicates paths, which makes the eval score each image twice and prints
 * frame counts for images that are gone, and makes the trainer standardize
 * every row in the run against a mean divided by a count it never summed.
 * The CSV has had one row per path for all 1,919 stock rows; nothing here may
 * be the first thing to break that.
 */
export function clipCollision(
  existing: readonly AttentionLabelRow[],
  candidate: { group: string; attention: string; split: string },
  options: ClipReuseOptions = {},
): string | null {
  const clash = rowsInGroup(existing, candidate.group);
  if (clash.length === 0) {
    return null;
  }
  const labels = [...new Set(clash.map((row) => row.attention))];
  const splits = [...new Set(clash.map((row) => row.split))];
  if (labels.length !== 1 || labels[0] !== candidate.attention) {
    return `group ${candidate.group} already holds ${clash.length} row(s) labelled ${labels.join("/")} — clip ${candidate.group} cannot also be ${candidate.attention}. Use a new --clip number.`;
  }
  if (splits.length !== 1 || splits[0] !== candidate.split) {
    return `group ${candidate.group} is already on the ${splits.join("/")} split — appending ${candidate.split} rows would straddle the split. Use a new --clip number.`;
  }
  if (options.retake !== true) {
    return `group ${candidate.group} already holds ${clash.length} row(s) for ${candidate.attention} on the ${candidate.split} split. Re-recording this clip writes the SAME frame filenames, so take two REPLACES take one on disk and appending rows would leave ${clash.length} row(s) pointing at overwritten images — one path, two rows. Pass --retake to replace this clip (its ${clash.length} row(s) are rewritten, not added), or use a new --clip number for a genuinely different clip.`;
  }
  return null;
}

/* ── the honesty gate ───────────────────────────────────────────────── */

export interface GroupCensus {
  frames: number;
  groups: number;
  /** Independent clips per label — the only counts worth reasoning about. */
  groupsByLabel: Record<string, number>;
  framesByLabel: Record<string, number>;
}

export function census(rows: ReadonlyArray<{ group: string; attention: string }>): GroupCensus {
  const groups = new Map<string, string>();
  const framesByLabel: Record<string, number> = {};
  for (const row of rows) {
    groups.set(row.group, row.attention);
    framesByLabel[row.attention] = (framesByLabel[row.attention] ?? 0) + 1;
  }
  const groupsByLabel: Record<string, number> = {};
  for (const label of groups.values()) {
    groupsByLabel[label] = (groupsByLabel[label] ?? 0) + 1;
  }
  return { frames: rows.length, groups: groups.size, groupsByLabel, framesByLabel };
}

export type FirstPersonGate = "no-rows" | "too-few-groups" | "missing-label";

/**
 * The floor may be RAISED but never lowered: a flag that could talk the eval
 * into printing a number off two clips would defeat the point of the gate.
 */
export function resolveMinGroups(requested: number | undefined): number {
  return requested !== undefined && Number.isFinite(requested)
    ? Math.max(FIRST_PERSON_MIN_EVAL_GROUPS, Math.trunc(requested))
    : FIRST_PERSON_MIN_EVAL_GROUPS;
}

/** null = the slice may be scored. Anything else = print the refusal instead. */
export function firstPersonGate(
  counts: GroupCensus,
  minGroups: number = FIRST_PERSON_MIN_EVAL_GROUPS,
): FirstPersonGate | null {
  if (counts.frames === 0) {
    return "no-rows";
  }
  if (counts.groups < minGroups) {
    return "too-few-groups";
  }
  if (FIRST_PERSON_LABELS.some((label) => (counts.groupsByLabel[label] ?? 0) < 1)) {
    return "missing-label";
  }
  return null;
}

export function censusLine(counts: GroupCensus): string {
  const perLabel = FIRST_PERSON_LABELS.map(
    (label) => `${label} ${counts.groupsByLabel[label] ?? 0} clip(s)/${counts.framesByLabel[label] ?? 0} frames`,
  ).join(", ");
  return `${counts.groups} independent clip(s), ${counts.frames} frames — ${perLabel}`;
}

/** Every gate gets its own sentence, so the refusal names the missing thing. */
export function firstPersonRefusal(
  gate: FirstPersonGate,
  counts: GroupCensus,
  minGroups: number = FIRST_PERSON_MIN_EVAL_GROUPS,
): string {
  const missing = FIRST_PERSON_LABELS.filter((label) => (counts.groupsByLabel[label] ?? 0) < 1);
  switch (gate) {
    case "no-rows":
      return "first-person: no webcam rows on the eval split — nothing to score. Record the six-clip protocol (npm run capture:protocol).";
    case "too-few-groups":
      return `first-person: NOT SCORED — ${counts.groups} independent clip(s) on the eval split, ${minGroups} needed. Frames are not samples: one clip is one sample however many frames it holds.`;
    case "missing-label":
      return `first-person: NOT SCORED — no eval clip for ${missing.join(", ")}. An accuracy that never sees a label is not an accuracy.`;
    default:
      return "first-person: NOT SCORED.";
  }
}

/** Rides along with every first-person number that IS printed. */
export function groupsCaveat(counts: GroupCensus): string {
  return `over ${counts.groups} independent clip(s), ${counts.frames} frames — a clip is one sample, so this rests on ${counts.groups} samples`;
}

/** "1 clip" / "3 clips" — the unit that is actually a sample. */
export function clipCount(clips: number): string {
  return `${clips} clip${clips === 1 ? "" : "s"}`;
}

/** A percentage, or a `(correct/total` ratio — anything a reader would quote. */
const PRINTS_A_NUMBER = /\d+(?:\.\d+)?\s*%|\(\d+\s*\/\s*\d+/;
const NAMES_CLIPS = /\bclips?\b/i;

/**
 * The promise in docs/CUSTOM-MODEL.md — "every first-person number printed
 * carries its clip count, not just its frame count" — kept mechanically
 * rather than by memory.
 *
 * A first-person line that shows a percentage or an n/m ratio without naming
 * the clips behind it is exactly the frames-as-samples inflation this module
 * exists to stop: "(80 positives)" off three clips reads like 80 samples. So
 * it throws instead of being printed. Refusal sentences carry no number at
 * all and pass untouched.
 */
export function assertClipCounted(lines: readonly string[]): string[] {
  for (const line of lines) {
    if (PRINTS_A_NUMBER.test(line) && !NAMES_CLIPS.test(line)) {
      throw new Error(
        `first-person output would print a number with no clip count behind it: ${line.trim()}`,
      );
    }
  }
  return [...lines];
}

/* ── the recording protocol (single source; docs must quote it) ─────── */

export const FIRST_PERSON_PROTOCOL: readonly string[] = [
  "Six clips of 20 seconds: two focused, two phone, two unfocused. That is about two minutes of your time, and there is no labelling step at all — the label you declare before recording IS the label of every frame in that clip.",
  "Vary the clips on purpose: different lighting, a different camera angle, a different time of day. Six varied clips are six independent groups; one long clip is one group no matter how many frames it holds, so a single long take teaches almost nothing and measures nothing.",
  "Record them in this order, one command per clip:",
  "npm run capture:attention -- --label focused   --seconds 20 --clip 1",
  "npm run capture:attention -- --label focused   --seconds 20 --clip 2",
  "npm run capture:attention -- --label phone     --seconds 20 --clip 3",
  "npm run capture:attention -- --label phone     --seconds 20 --clip 4",
  "npm run capture:attention -- --label unfocused --seconds 20 --clip 5",
  "npm run capture:attention -- --label unfocused --seconds 20 --clip 6",
  "Odd clip numbers go to the train split and even ones to eval, so each label lands one clip on each side. That gives three eval clips — the minimum the eval will score at all, and still only a three-sample measurement.",
  "focused: work as you actually work. phone: hold the phone where you really hold it, below the frame, and let your head tilt down. unfocused: at the desk but off task — staring away, leaning back, talking to someone.",
  "Then re-extract features and retrain, and read the first-person and stock numbers separately:",
  "npx tsx --tsconfig tsconfig.node.json scripts/desk-model/extract-features.ts --shard 0 --of 1",
  "npx tsx --tsconfig tsconfig.node.json scripts/desk-model/train-attention.ts --hidden 16 --l2 0.03 --slices 745-2025",
  "npx tsx --tsconfig tsconfig.node.json scripts/desk-model/eval-attention.ts",
  "The honest claim after six clips is \"adapted toward first-person, measured on 3 eval clips\" — not a new headline accuracy. Three clips cannot move a headline number, and the eval refuses to print one that pretends otherwise.",
];
