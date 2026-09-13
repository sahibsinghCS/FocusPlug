import { parseCsv, type AttentionLabelRow } from "./lib";
import {
  assertFirstPersonLabel,
  buildCaptureRows,
  clipDir,
  clipGroup,
  clipSplit,
  FIRST_PERSON_COUNTDOWN_SEC,
  FIRST_PERSON_DEFAULT_FPS,
  FIRST_PERSON_DEFAULT_SECONDS,
  FIRST_PERSON_JPEG_QUALITY,
  FIRST_PERSON_MAX_CLIP,
  FIRST_PERSON_MAX_FPS,
  FIRST_PERSON_MAX_SECONDS,
  formatAttentionRow,
  framePath,
  type FirstPersonLabel,
} from "./first-person";

/**
 * The pure half of `capture-attention.ts`: flags in, a fully determined plan
 * out. Nothing here opens a camera or touches the disk, so `--dry-run` and
 * the unit tests exercise the exact code path a real recording uses.
 */

export type CaptureSource = "auto" | "electron" | "ffmpeg";

export interface CaptureConfig {
  label: FirstPersonLabel;
  clip: number;
  seconds: number;
  fps: number;
  split: "train" | "eval";
  /** Whether the split came from the clip number or an explicit --split. */
  splitFrom: "clip" | "flag";
  source: CaptureSource;
  quality: number;
  countdownSec: number;
  dryRun: boolean;
  /**
   * `--retake`: re-record a clip id already in the CSV. The frames overwrite
   * take one (same filenames), so the rows REPLACE take one's rows too.
   */
  retake: boolean;
}

export interface CapturePlan {
  config: CaptureConfig;
  group: string;
  /** Pack-relative, e.g. `first-person/phone/fp-clip-003`. */
  dir: string;
  frames: number;
  /** Pack-relative JPEG paths, in capture order. */
  paths: string[];
  rows: AttentionLabelRow[];
  intervalMs: number;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numberFlag(argv: readonly string[], flag: string, fallback: number): number {
  const raw = flagValue(argv, flag);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a number — got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function inRange(flag: string, value: number, min: number, max: number): number {
  if (value < min || value > max) {
    throw new Error(`${flag} must be between ${min} and ${max} — got ${value}`);
  }
  return value;
}

/** Throws a one-line, human-readable message on anything invalid. */
export function parseCaptureArgs(argv: readonly string[]): CaptureConfig {
  const label = assertFirstPersonLabel(flagValue(argv, "--label"));

  const clipRaw = flagValue(argv, "--clip");
  if (clipRaw === undefined) {
    throw new Error(
      `--clip is required: it is the group key, so every frame of one clip stays on one side of the split (1..${FIRST_PERSON_MAX_CLIP})`,
    );
  }
  const clip = Number(clipRaw);
  if (!Number.isInteger(clip)) {
    throw new Error(`--clip must be a whole number — got ${JSON.stringify(clipRaw)}`);
  }
  clipGroup(clip); // range check, same message as everywhere else

  const seconds = inRange(
    "--seconds",
    numberFlag(argv, "--seconds", FIRST_PERSON_DEFAULT_SECONDS),
    1,
    FIRST_PERSON_MAX_SECONDS,
  );
  const fps = inRange("--fps", numberFlag(argv, "--fps", FIRST_PERSON_DEFAULT_FPS), 0.2, FIRST_PERSON_MAX_FPS);
  const quality = inRange(
    "--quality",
    numberFlag(argv, "--quality", FIRST_PERSON_JPEG_QUALITY),
    1,
    100,
  );

  const splitRaw = flagValue(argv, "--split");
  if (splitRaw !== undefined && splitRaw !== "train" && splitRaw !== "eval") {
    throw new Error(`--split must be train or eval — got ${JSON.stringify(splitRaw)}`);
  }

  const sourceRaw = flagValue(argv, "--source") ?? "auto";
  if (sourceRaw !== "auto" && sourceRaw !== "electron" && sourceRaw !== "ffmpeg") {
    throw new Error(`--source must be auto, electron or ffmpeg — got ${JSON.stringify(sourceRaw)}`);
  }

  return {
    label,
    clip,
    seconds,
    fps,
    split: splitRaw ?? clipSplit(clip),
    splitFrom: splitRaw ? "flag" : "clip",
    source: sourceRaw,
    quality,
    countdownSec: Math.max(0, numberFlag(argv, "--countdown", FIRST_PERSON_COUNTDOWN_SEC)),
    dryRun: argv.includes("--dry-run"),
    retake: argv.includes("--retake"),
  };
}

export function buildCapturePlan(config: CaptureConfig): CapturePlan {
  const frames = Math.max(1, Math.round(config.seconds * config.fps));
  const paths: string[] = [];
  for (let i = 1; i <= frames; i += 1) {
    paths.push(framePath(config.label, config.clip, i));
  }
  return {
    config,
    group: clipGroup(config.clip),
    dir: clipDir(config.label, config.clip),
    frames,
    paths,
    rows: buildCaptureRows({ label: config.label, clip: config.clip, split: config.split }, frames),
    intervalMs: Math.round(1000 / config.fps),
  };
}

/**
 * What the run will do, in the order it will do it. `--dry-run` prints this
 * and stops; a real run prints it before the countdown so there is no doubt
 * about which label is about to be recorded.
 */
export function describePlan(
  plan: CapturePlan,
  packRoot: string,
  csvFile: string,
  /** Rows already in the CSV for this clip — a retake REPLACES exactly these. */
  existingRows = 0,
): string[] {
  const { config } = plan;
  return [
    `label      ${config.label}   (declared by you — every frame of this clip gets it, no annotation step)`,
    `clip       ${config.clip} -> group ${plan.group}   (the group key: this clip can never straddle the split)`,
    `split      ${config.split}   (${config.splitFrom === "clip" ? "odd clips train, even clips eval" : "forced by --split"})`,
    `recording  ${config.seconds}s at ${config.fps} fps -> ${plan.frames} JPEG frames, one every ${plan.intervalMs} ms`,
    `frames     ${packRoot}/${plan.dir}/`,
    `           ${plan.paths[0]} … ${plan.paths[plan.frames - 1]}`,
    existingRows > 0
      ? `csv        ${csvFile}  (retake: replaces this clip's ${existingRows} existing row(s) with ${plan.rows.length}, existing schema, no new columns)`
      : `csv        ${csvFile}  (+${plan.rows.length} rows, existing schema, no new columns)`,
    `countdown  ${config.countdownSec}s before the first frame`,
    "note       this clip is ONE independent group, however many frames it holds",
  ];
}

/* ── the CSV write, as a pure function ──────────────────────────────── */

/**
 * Split CSV text into whole records, each keeping its own line terminator, so
 * rewriting the file leaves every untouched record byte-for-byte as it was. A
 * newline inside a quoted field is part of the record, not a boundary.
 */
export function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      // `""` inside a quoted field toggles twice, so it nets out correctly.
      quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      let end = i + 1;
      if (char === "\r" && text[i + 1] === "\n") {
        end += 1;
        i += 1;
      }
      records.push(text.slice(start, end));
      start = end;
    }
  }
  if (start < text.length) {
    records.push(text.slice(start));
  }
  return records;
}

export interface CaptureCsvWrite {
  /** The full new file contents. */
  text: string;
  /** Rows of this clip that were dropped — a retake replaces, never adds. */
  replaced: number;
}

/**
 * The whole CSV after this capture: every record that is not this clip's kept
 * exactly as it was, this clip's old records dropped, the new rows appended.
 *
 * A FRESH clip drops nothing, so this is an append. A RETAKE drops take one's
 * rows first, which is the only honest answer once you notice that take two
 * overwrote take one's images: appending instead would leave two rows per
 * path, and the eval would score images that no longer exist while the
 * trainer mis-standardized every row in the run against the inflated count.
 */
export function csvWithClip(
  existingText: string,
  group: string,
  rows: readonly AttentionLabelRow[],
): CaptureCsvWrite {
  if (rows.length === 0) {
    throw new Error("refusing to rewrite the labels CSV with no rows for the clip");
  }
  const records = splitCsvRecords(existingText);
  const header = records[0];
  if (header === undefined) {
    throw new Error("the labels CSV has no header row");
  }
  const groupIndex = (parseCsv(header)[0] ?? []).indexOf("group");
  if (groupIndex < 0) {
    throw new Error("the labels CSV has no group column");
  }
  const kept: string[] = [header];
  let replaced = 0;
  for (const record of records.slice(1)) {
    const cells = parseCsv(record)[0] ?? [];
    if (cells.length > 1 && cells[groupIndex] === group) {
      replaced += 1;
      continue;
    }
    kept.push(record);
  }
  const body = kept.join("");
  return {
    text:
      (body.endsWith("\n") ? body : `${body}\n`) +
      rows.map(formatAttentionRow).join("\n") +
      "\n",
    replaced,
  };
}

/**
 * Frame files of an earlier, longer take that this one does not overwrite.
 * Leaving them behind would put images in the clip directory that no CSV row
 * points at — the same one-path-one-image drift, seen from the disk side.
 */
export function staleFrameNames(present: readonly string[], plan: CapturePlan): string[] {
  const keep = new Set(plan.paths.map((path) => path.slice(path.lastIndexOf("/") + 1)));
  return present.filter((name) => /^frame-\d{4}\.jpg$/.test(name) && !keep.has(name)).sort();
}

/**
 * Relaunch under the Electron binary the app already depends on, so the
 * capture uses `ElectronCameraSource` from src/main/desk/camera.ts — the same
 * source the shipped desk monitor opens. Args travel in an env var because
 * Electron rewrites `process.argv` with its own switches.
 */
export function electronRelaunchArgs(bootstrap: string, platform: string): string[] {
  // Chromium's sandbox needs kernel privileges a plain container may not give;
  // the app's own dev flow hits the same wall.
  return platform === "linux" ? ["--no-sandbox", bootstrap] : [bootstrap];
}

export const CAPTURE_ARGS_ENV = "FOCUSPLUG_CAPTURE_ARGS";

/** argv for this process: the relaunch env var wins over the command line. */
export function captureArgv(env: NodeJS.ProcessEnv, argv: readonly string[]): string[] {
  const packed = env[CAPTURE_ARGS_ENV];
  if (packed === undefined) {
    return argv.slice(2);
  }
  const parsed: unknown = JSON.parse(packed);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`${CAPTURE_ARGS_ENV} must be a JSON array of strings`);
  }
  return parsed as string[];
}
