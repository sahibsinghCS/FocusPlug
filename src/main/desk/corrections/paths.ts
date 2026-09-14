import { join } from "node:path";

/**
 * The one directory a student's own webcam photographs live in, named once.
 *
 * A sibling of `adaptive-model.json` and `focus-plan.json`, for the same
 * stated reason: derived data that can always be thrown away, and losing it
 * must never take the settings or the log with it. Every path in this feature
 * is built from these functions so a tool — or a *Delete all* — cannot invent
 * a filename and miss one.
 *
 * `docs/CORRECTION-LOOP.md § 3.1`.
 */
export const DESK_CORRECTIONS_DIR = "desk-corrections";
export const CORRECTIONS_INDEX_FILE = "corrections.json";
export const CORRECTIONS_FRAMES_DIR = "frames";
export const PERSONAL_ATTENTION_HEAD_FILE = "personal-attention-head.json";
export const REFIT_REPORT_FILE = "refit-report.json";
export const CORRECTION_THUMB_FILE = "thumb.jpg";

/**
 * The shipped attention head, relative to `deskRoot()`.
 *
 * Named here rather than imported from `model/your-model.ts` so that writing a
 * JPEG does not drag TensorFlow into the store. It is the same string, and
 * `no-retrain.test.ts` asserts the two cannot drift.
 */
export const ATTENTION_HEAD_FILE = join("model", "weights", "attention-head.json");

/**
 * The attention head's feature-layout version, stamped on every record.
 *
 * Duplicated from `ATTENTION_HEAD_FEATURE_VERSION` for the same reason and
 * under the same test. If it bumps, cached activations are invalid and are
 * recomputed from the JPEGs — which is why the JPEG is the source of truth and
 * the activation is only ever a cache.
 */
export const ATTENTION_FEATURE_VERSION = 2;

/** `<userData>/desk-corrections` — the root of everything this feature owns. */
export function correctionsPath(directory: string): string {
  return join(directory, DESK_CORRECTIONS_DIR);
}

export function correctionsIndexPath(directory: string): string {
  return join(correctionsPath(directory), CORRECTIONS_INDEX_FILE);
}

export function correctionsFramesPath(directory: string): string {
  return join(correctionsPath(directory), CORRECTIONS_FRAMES_DIR);
}

export function correctionDirPath(directory: string, id: string): string {
  return join(correctionsFramesPath(directory), id);
}

export function personalAttentionHeadPath(directory: string): string {
  return join(correctionsPath(directory), PERSONAL_ATTENTION_HEAD_FILE);
}

export function refitReportPath(directory: string): string {
  return join(correctionsPath(directory), REFIT_REPORT_FILE);
}

/** "dc-0007" from 7. Also the CSV `group`: one correction is one group. */
export function correctionId(index: number): string {
  return `dc-${String(Math.max(0, Math.trunc(index))).padStart(4, "0")}`;
}

/** "frames/dc-0007/frame-0002.jpg" — POSIX, because it is stored in JSON and
 *  becomes a CSV path on export. `correctionFilePath` turns it back into a
 *  real one, so a Windows install never writes a backslash into the record. */
export function correctionFrameRelative(id: string, frameIndex: number): string {
  return `${CORRECTIONS_FRAMES_DIR}/${id}/frame-${String(frameIndex).padStart(4, "0")}.jpg`;
}

export function correctionThumbRelative(id: string): string {
  return `${CORRECTIONS_FRAMES_DIR}/${id}/${CORRECTION_THUMB_FILE}`;
}

/** Resolve a stored relative file back to an absolute path under `<userData>`. */
export function correctionFilePath(directory: string, relative: string): string {
  return join(correctionsPath(directory), ...relative.split("/"));
}
