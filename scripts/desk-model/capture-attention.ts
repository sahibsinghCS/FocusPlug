import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encode as encodeJpeg } from "jpeg-js";
import { createDefaultFrameSource, ElectronCameraSource } from "../../src/main/desk/camera";
import type { FrameSource, RgbFrame } from "../../src/main/desk/types";
import {
  buildCapturePlan,
  CAPTURE_ARGS_ENV,
  captureArgv,
  csvWithClip,
  describePlan,
  electronRelaunchArgs,
  parseCaptureArgs,
  staleFrameNames,
  type CapturePlan,
} from "./capture-plan";
import {
  census,
  censusLine,
  clipCollision,
  FIRST_PERSON_LABELS,
  isFirstPersonRow,
  rowsInGroup,
} from "./first-person";
import { attentionLabelsFile, readAttentionLabels } from "./lib";

/**
 * Record a short first-person webcam clip and append it to
 * `datasets/desk-attention-labels.csv` as training data for the attention head.
 *
 *   npm run capture:attention -- --label phone --seconds 20 --clip 3
 *   npm run capture:attention -- --label focused --clip 1 --dry-run
 *   npm run capture:protocol            # the six-clip recording protocol
 *
 * SELF-LABELLING. You declare the label before recording, so every frame of
 * the clip carries it by construction: no annotation step, not by a human and
 * not by Adaption. Your whole cost is the recording itself.
 *
 * ONE CLIP IS ONE SAMPLE. Frames 400 ms apart are the same photograph, so the
 * clip id becomes the CSV `group` — the same device the stock photos use for
 * dHash near-duplicates. Six varied clips are six independent groups; one long
 * clip is one, and the eval says so out loud (see first-person.ts).
 *
 * ONE PATH IS ONE IMAGE. A frame filename is a pure function of label, clip
 * and frame index, so re-recording a clip OVERWRITES its frames. A second
 * take is therefore a replacement, never an addition: it needs `--retake`,
 * and it rewrites that clip's rows instead of appending a second set for
 * paths whose images no longer exist.
 *
 * The camera is the app's own `src/main/desk/camera.ts` source: with no
 * `--source` flag the script relaunches itself under the Electron binary the
 * app already depends on and opens `ElectronCameraSource`, exactly what the
 * shipped desk monitor uses. No new dependency.
 */

const USAGE = [
  "usage: npm run capture:attention -- --label <focused|unfocused|phone> --clip <n> [--seconds 20]",
  "",
  `  --label     required, one of ${FIRST_PERSON_LABELS.join(", ")}`,
  "  --clip      required, 1..999. The clip id IS the CSV group key.",
  "  --seconds   default 20",
  "  --fps       default 2 (adjacent frames are the same photograph)",
  "  --split     train|eval. Default: odd clips train, even clips eval.",
  "  --source    auto|electron|ffmpeg. Default auto (Electron, the app's camera).",
  "  --quality   JPEG quality, default 88",
  "  --countdown seconds before the first frame, default 3",
  "  --retake    re-record a clip already in the CSV: its rows are REPLACED,",
  "              because take two overwrites take one's frame files.",
  "  --dry-run   print the plan; no camera, no writes",
  "",
  "  npm run capture:protocol   prints the six-clip recording protocol",
].join("\n");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function scriptDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * RGB → RGBA → JPEG. Exported so a test can decode the result back through
 * `src/main/desk/frame.ts`: a capture that extract-features.ts cannot read is
 * worse than no capture at all.
 */
export function encodeFrame(frame: RgbFrame, quality: number): Buffer {
  const pixels = frame.width * frame.height;
  const rgba = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    const src = i * 3;
    const dst = i * 4;
    rgba[dst] = frame.data[src] ?? 0;
    rgba[dst + 1] = frame.data[src + 1] ?? 0;
    rgba[dst + 2] = frame.data[src + 2] ?? 0;
    rgba[dst + 3] = 255;
  }
  return Buffer.from(encodeJpeg({ data: rgba, width: frame.width, height: frame.height }, quality).data);
}

/** A webcam needs a moment after `start()`; a null grab is "not yet", not "no". */
async function grabOrThrow(source: FrameSource): Promise<RgbFrame> {
  const deadline = Date.now() + 4000;
  for (;;) {
    const frame = await source.grab();
    if (frame) {
      return frame;
    }
    if (Date.now() > deadline) {
      throw new Error("camera returned no frame for 4s — is the webcam free and permitted?");
    }
    await delay(100);
  }
}

async function record(source: FrameSource, plan: CapturePlan): Promise<Buffer[]> {
  await source.start();
  try {
    // Warm the pipeline before the countdown so "1…" really means one second.
    await grabOrThrow(source);
    for (let n = Math.round(plan.config.countdownSec); n > 0; n -= 1) {
      console.log(`  ${n}…`);
      await delay(1000);
    }
    console.log(`  RECORDING ${plan.config.label} — ${plan.config.seconds}s`);
    const jpegs: Buffer[] = [];
    const startedAt = Date.now();
    for (let i = 0; i < plan.frames; i += 1) {
      const wait = startedAt + i * plan.intervalMs - Date.now();
      if (wait > 0) {
        await delay(wait);
      }
      jpegs.push(encodeFrame(await grabOrThrow(source), plan.config.quality));
      if ((i + 1) % 10 === 0 || i + 1 === plan.frames) {
        console.log(`  ${i + 1}/${plan.frames} frames`);
      }
    }
    return jpegs;
  } finally {
    await source.stop();
  }
}

function electronBinary(): string | null {
  try {
    const path: unknown = createRequire(import.meta.url)("electron");
    return typeof path === "string" && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** Run this same script inside Electron, where the app's camera source works. */
function relaunchUnderElectron(binary: string, args: readonly string[]): Promise<number> {
  const bootstrap = join(scriptDir(), "capture-boot.cjs");
  const child = spawn(binary, electronRelaunchArgs(bootstrap, process.platform), {
    stdio: "inherit",
    env: { ...process.env, [CAPTURE_ARGS_ENV]: JSON.stringify(args) },
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function electronCameraSource(): Promise<FrameSource> {
  const { app } = await import("electron");
  // The hidden camera window closing must not quit the app before the frames
  // are written; the script decides when the process ends.
  app.on("window-all-closed", () => undefined);
  await app.whenReady();
  return new ElectronCameraSource();
}

function packRoot(dryRun: boolean): string {
  const configured = process.env["FOCUSPLUG_DESK_DATA"];
  if (configured) {
    return configured;
  }
  if (dryRun) {
    return "<FOCUSPLUG_DESK_DATA>";
  }
  throw new Error(
    "FOCUSPLUG_DESK_DATA is not set — point it at the extracted focusplug-desk-data " +
      "directory (see docs/CUSTOM-MODEL.md). Captures live inside the pack, never in the repo.",
  );
}

function firstPersonCensusLines(csvFile: string): string[] {
  if (!existsSync(csvFile)) {
    return [];
  }
  const rows = readAttentionLabels(csvFile).filter(isFirstPersonRow);
  if (rows.length === 0) {
    return ["first-person rows in the CSV: none yet"];
  }
  return [
    `first-person train: ${censusLine(census(rows.filter((row) => row.split === "train")))}`,
    `first-person eval:  ${censusLine(census(rows.filter((row) => row.split === "eval")))}`,
  ];
}

async function main(): Promise<void> {
  const args = captureArgv(process.env, process.argv);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const config = parseCaptureArgs(args);
  const plan = buildCapturePlan(config);
  const csvFile = attentionLabelsFile();
  if (!existsSync(csvFile)) {
    // Fail before the camera, not after: the rows have nowhere honest to go,
    // and a bare file created here would have no header for the next run.
    throw new Error(
      `${csvFile} does not exist — run adaption-label.py export first. Capture rows join that file in its existing schema; they never start one.`,
    );
  }
  const existing = readAttentionLabels(csvFile);

  const priorRows = rowsInGroup(existing, plan.group);
  const collision = clipCollision(
    existing,
    { group: plan.group, attention: config.label, split: config.split },
    { retake: config.retake },
  );
  if (collision) {
    throw new Error(collision);
  }

  const root = packRoot(config.dryRun);
  for (const line of describePlan(plan, root, "datasets/desk-attention-labels.csv", priorRows.length)) {
    console.log(line);
  }
  if (config.retake && priorRows.length === 0) {
    console.log(`retake     nothing to replace — ${plan.group} has no rows yet, so this is a first take`);
  }

  if (config.dryRun) {
    console.log("");
    console.log(
      priorRows.length > 0
        ? `dry run — no camera opened, no files written; a real run would REPLACE this clip's ${priorRows.length} row(s), not add to them.`
        : "dry run — no camera opened, no files written, no CSV rows appended.",
    );
    for (const line of firstPersonCensusLines(csvFile)) {
      console.log(line);
    }
    return;
  }

  // Prefer the Electron source the app ships. Relaunching is the only way to
  // reach it from a plain `tsx` run, and a failed child must NOT silently
  // retry through ffmpeg: the child may have written its frames already.
  if (!process.versions.electron && config.source !== "ffmpeg") {
    const binary = electronBinary();
    if (binary) {
      const code = await relaunchUnderElectron(binary, args);
      if (code !== 0) {
        throw new Error(
          `the Electron capture exited ${code}. Retry with --source ffmpeg to use camera.ts's ffmpeg source instead.`,
        );
      }
      return;
    }
    if (config.source === "electron") {
      throw new Error("--source electron, but the electron binary is not installed");
    }
    console.warn("electron binary not found — falling back to camera.ts's ffmpeg source");
  }

  const source = process.versions.electron
    ? await electronCameraSource()
    : await createDefaultFrameSource();
  console.log(`camera source: ${source.constructor.name}`);
  const jpegs = await record(source, plan);

  const dir = join(root, plan.dir);
  mkdirSync(dir, { recursive: true });
  jpegs.forEach((jpeg, index) => {
    writeFileSync(join(root, plan.paths[index] as string), jpeg);
  });
  // A shorter retake leaves take one's extra frames behind, and an image no
  // CSV row points at is the same one-path-one-image drift seen from disk.
  const stale = staleFrameNames(readdirSync(dir), plan);
  for (const name of stale) {
    rmSync(join(dir, name));
  }

  // One write, after every frame is safely on disk: a half-written clip would
  // leave CSV rows pointing at files that do not exist. `csvWithClip` keeps
  // every other record byte-for-byte and drops this clip's old rows first, so
  // a retake replaces take one instead of duplicating its paths.
  const write = csvWithClip(readFileSync(csvFile, "utf8"), plan.group, plan.rows);
  const tmp = `${csvFile}.capture-tmp`;
  writeFileSync(tmp, write.text);
  renameSync(tmp, csvFile);

  const bytes = jpegs.reduce((sum, jpeg) => sum + jpeg.length, 0);
  console.log("");
  console.log(`wrote ${jpegs.length} JPEG frames (${(bytes / 1024).toFixed(0)} KB) -> ${dir}`);
  console.log(`  ${plan.paths[0]}`);
  console.log(`  … ${plan.paths[plan.frames - 1]}`);
  if (stale.length > 0) {
    console.log(`  removed ${stale.length} stale frame(s) from the previous take (${stale[0]} …)`);
  }
  console.log(
    write.replaced > 0
      ? `replaced this clip's ${write.replaced} rows with ${plan.rows.length} -> datasets/desk-attention-labels.csv (retake: one path, one row)`
      : `appended ${plan.rows.length} rows -> datasets/desk-attention-labels.csv`,
  );
  console.log(
    `  group ${plan.group} · split ${config.split} · attention ${config.label} · pack_label ${config.label}`,
  );
  console.log(`  note: ${plan.rows[0]?.note ?? ""}`);
  console.log("");
  console.log(`this clip is ONE independent group (${plan.frames} frames, not ${plan.frames} samples)`);
  for (const line of firstPersonCensusLines(csvFile)) {
    console.log(line);
  }
  console.log("next: extract-features.ts, then train-attention.ts / eval-attention.ts");

  if (process.versions.electron) {
    const { app } = await import("electron");
    app.exit(0);
  }
}

/**
 * Run only when this file IS the command — under tsx directly, or inside the
 * Electron relaunch (which carries its flags in the env var). Importing it
 * from a test must not open a camera.
 */
const isEntry =
  process.env[CAPTURE_ARGS_ENV] !== undefined ||
  /capture-attention\.ts$/.test(process.argv[1] ?? "");

if (isEntry) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    if (process.versions.electron) {
      const { app } = await import("electron");
      app.exit(1);
    }
  });
}
