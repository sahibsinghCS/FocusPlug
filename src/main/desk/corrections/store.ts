import {
  existsSync as fsExistsSync,
  mkdirSync as fsMkdirSync,
  readFileSync as fsReadFileSync,
  rmSync as fsRmSync,
  writeFileSync as fsWriteFileSync,
} from "node:fs";
import { CORRECTION_CAP_GROUPS } from "@shared/correction/constants";
import { correctionMeaning, correctionSplit, excludedBecause } from "@shared/correction/meaning";
import type {
  CorrectionListItem,
  CorrectionVerdict,
  DeskCorrection,
  DeskCorrectionFrame,
  DeskCorrectionRetraction,
  DeskCorrectionsFile,
} from "@shared/correction/types";
import { isPauseKind } from "@shared/nudge";
import type { DeskModelId } from "@shared/types";
import { readUserDataJson, writeUserDataJson } from "../../store/appStore";
import { framePrediction, type HeldCapture } from "./capture";
import { encodeFrameJpeg, encodeThumbJpeg, thumbDataUrl } from "./jpeg";
import {
  correctionDirPath,
  correctionFilePath,
  correctionFrameRelative,
  correctionId as makeCorrectionId,
  correctionThumbRelative,
  correctionsIndexPath,
  correctionsPath,
} from "./paths";

/**
 * `<userData>/desk-corrections/` — the student's own webcam photographs, the
 * label they gave them, and nothing else.
 *
 * Four properties this file is responsible for, in the order they matter:
 *
 * 1. **Nothing is written without a deliberate tap.** `record()` is the only
 *    method that creates a file, and the only caller is the verdict handler.
 * 2. **Nothing is uploaded.** There is no network import in this module and
 *    none is added; the only way a correction leaves the machine is a
 *    developer running the export script on their own laptop.
 * 3. **Deletion is one action and it is real.** `remove()` unlinks the frame
 *    tree; `clear()` takes the whole directory, the personal head and the
 *    refit report with it, because a head fitted on deleted data is deleted
 *    data.
 * 4. **No throw ever reaches a session start, a pause, or a verdict tap.**
 *    Every read is defensive and the service above catches every write.
 *
 * `docs/CORRECTION-LOOP.md § 3`.
 */

/** The fs seam, injectable so the uncoupling test can spy on every write. */
export interface CorrectionsFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string): void;
  writeFileSync(path: string, data: Uint8Array): void;
  readFileSync(path: string): Uint8Array;
  rmSync(path: string): void;
  readJson(path: string): unknown;
  writeJson(path: string, value: unknown): void;
}

export function nodeCorrectionsFs(): CorrectionsFs {
  return {
    existsSync: (path) => fsExistsSync(path),
    mkdirSync: (path) => {
      fsMkdirSync(path, { recursive: true });
    },
    writeFileSync: (path, data) => {
      fsWriteFileSync(path, data);
    },
    readFileSync: (path) => fsReadFileSync(path),
    rmSync: (path) => {
      fsRmSync(path, { recursive: true, force: true });
    },
    readJson: (path) => readUserDataJson(path),
    writeJson: (path, value) => {
      writeUserDataJson(path, value);
    },
  };
}

export function emptyCorrectionsFile(): DeskCorrectionsFile {
  return { v: 1, lifetimeCorrections: 0, corrections: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isVerdict(value: unknown): value is CorrectionVerdict {
  return value === "wrong" || value === "right";
}

function isDeskModelIdLike(value: unknown): value is DeskModelId {
  return value === "stub" || value === "blazeface" || value === "custom";
}

/**
 * Revive one frame, dropping it when its JPEG is not on disk.
 *
 * A student who deleted a file by hand has deleted it: the record survives —
 * so the cooldown it armed is not resurrected by tidying up a folder — and the
 * frame does not, so nothing ever points at a picture that is gone.
 */
function reviveFrame(
  raw: unknown,
  frameExists: (relative: string) => boolean,
): DeskCorrectionFrame | null {
  if (!isRecord(raw)) {
    return null;
  }
  const file = stringOr(raw.file, "");
  // A stored path is a relative POSIX path under `desk-corrections/` and
  // nothing else: a record that escaped the directory would let a hand-edited
  // index point *Delete* at a file this feature does not own.
  if (file.length === 0 || file.includes("..") || file.startsWith("/") || file.includes("\\")) {
    return null;
  }
  if (!frameExists(file)) {
    return null;
  }
  const hidden =
    Array.isArray(raw.hidden) &&
    raw.hidden.every((value) => typeof value === "number" && Number.isFinite(value))
      ? (raw.hidden as number[])
      : null;
  return {
    file,
    at: finiteOr(raw.at, 0),
    width: Math.max(0, Math.trunc(finiteOr(raw.width, 0))),
    height: Math.max(0, Math.trunc(finiteOr(raw.height, 0))),
    bytes: Math.max(0, Math.trunc(finiteOr(raw.bytes, 0))),
    predicted: stringOr(raw.predicted, ""),
    confidence: finiteOr(raw.confidence, 0),
    hidden,
    hiddenFor: hidden !== null && typeof raw.hiddenFor === "string" ? raw.hiddenFor : null,
  };
}

function reviveRetraction(raw: unknown): DeskCorrectionRetraction | null {
  if (!isRecord(raw)) {
    return null;
  }
  const roundKey = stringOr(raw.roundKey, "");
  if (roundKey.length === 0) {
    return null;
  }
  const at = raw.retractedAtSec;
  return {
    roundKey,
    retractedAtSec: typeof at === "number" && Number.isFinite(at) ? at : null,
    refusal: (typeof raw.refusal === "string" ? raw.refusal : null) as DeskCorrectionRetraction["refusal"],
  };
}

/**
 * Wrong `v`, a non-array, a record with no id, a NaN offset, a frame file that
 * is not on disk: that record (or that frame) is dropped and the rest stands.
 * An unreadable file starts empty. Never a throw.
 */
export function reviveCorrections(
  raw: unknown,
  frameExists: (relative: string) => boolean,
): DeskCorrectionsFile {
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.corrections)) {
    return emptyCorrectionsFile();
  }
  const seen = new Set<string>();
  const corrections: DeskCorrection[] = [];
  for (const entry of raw.corrections) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = stringOr(entry.id, "");
    const kind = entry.kind;
    const verdict = entry.verdict;
    if (id.length === 0 || seen.has(id) || !isPauseKind(kind) || !isVerdict(verdict)) {
      continue;
    }
    const at = entry.at;
    if (typeof at !== "number" || !Number.isFinite(at)) {
      continue;
    }
    seen.add(id);
    // The table is the source of truth for what a correction MEANS: a
    // hand-edited `label` cannot make an `away:wrong` row train the attention
    // head, because the label is recomputed from the kind and the verdict.
    const meaning = correctionMeaning(kind, verdict);
    const frames = Array.isArray(entry.frames)
      ? entry.frames
          .map((frame) => reviveFrame(frame, frameExists))
          .filter((frame): frame is DeskCorrectionFrame => frame !== null)
      : [];
    corrections.push({
      v: 1,
      id,
      at,
      day: stringOr(entry.day, ""),
      kind,
      verdict,
      modelLabel: stringOr(entry.modelLabel, ""),
      modelConfidence: finiteOr(entry.modelConfidence, 0),
      label: meaning.label,
      head: meaning.head,
      split: entry.split === "eval" ? "eval" : "train",
      deskModelId: isDeskModelIdLike(entry.deskModelId) ? entry.deskModelId : "custom",
      baseHeadHash: stringOr(entry.baseHeadHash, ""),
      featureVersion: Math.trunc(finiteOr(entry.featureVersion, 0)),
      frames,
      bytes: Math.max(0, Math.trunc(finiteOr(entry.bytes, 0))),
      capped: entry.capped === true,
      retraction: reviveRetraction(entry.retraction),
    });
  }
  return {
    v: 1,
    lifetimeCorrections: Math.max(
      corrections.length,
      Math.trunc(finiteOr(raw.lifetimeCorrections, corrections.length)),
    ),
    corrections,
  };
}

export interface RecordInput {
  capture: HeldCapture;
  verdict: CorrectionVerdict;
  /** Local "YYYY-MM-DD", stamped in MAIN so the pure core never touches Date. */
  day: string;
  baseHeadHash: string;
  featureVersion: number;
  retraction: DeskCorrectionRetraction | null;
}

export interface CorrectionsStoreOptions {
  userDataDir: string;
  fs?: CorrectionsFs;
}

export class CorrectionsStore {
  private readonly dir: string;
  private readonly fs: CorrectionsFs;
  private file: DeskCorrectionsFile;
  /**
   * Thumbnails, memoised by correction id.
   *
   * `list()` runs on the pause path (the state push that raises the verdict
   * row) and a hundred-odd small reads there is work the enforcement loop
   * should not be doing. Records are append-only under a fresh id, so the only
   * invalidations are `remove` and `clear`.
   */
  private readonly thumbs = new Map<string, string | null>();

  constructor(options: CorrectionsStoreOptions) {
    this.dir = options.userDataDir;
    this.fs = options.fs ?? nodeCorrectionsFs();
    this.file = this.load();
  }

  private load(): DeskCorrectionsFile {
    try {
      return reviveCorrections(this.fs.readJson(correctionsIndexPath(this.dir)), (relative) =>
        this.fs.existsSync(correctionFilePath(this.dir, relative)),
      );
    } catch {
      // An unreadable index is an empty one. It is derived data: losing it
      // must never take the settings or the log with it.
      return emptyCorrectionsFile();
    }
  }

  /** Re-read from disk. Used by tests and after an out-of-band change. */
  reload(): void {
    this.thumbs.clear();
    this.file = this.load();
  }

  root(): string {
    return correctionsPath(this.dir);
  }

  /** Create the corrections directory. Only *Reveal folder* calls this. */
  ensureRoot(): void {
    this.fs.mkdirSync(correctionsPath(this.dir));
  }

  /** Existence over the same seam every other path in this feature uses. */
  hasFile(path: string): boolean {
    return this.fs.existsSync(path);
  }

  readJsonAt(path: string): unknown {
    return this.fs.existsSync(path) ? this.fs.readJson(path) : null;
  }

  corrections(): readonly DeskCorrection[] {
    return this.file.corrections;
  }

  lifetimeCorrections(): number {
    return this.file.lifetimeCorrections;
  }

  /** Corrections that actually hold photographs — what the cap counts. */
  photoGroups(): number {
    return this.file.corrections.filter((correction) => correction.frames.length > 0).length;
  }

  /**
   * At the cap the loop stops storing PHOTOS and says so. It never deletes a
   * student's images to make room for more of their images, so this is a
   * ceiling on disk and never on the behavioural half — the verdict still
   * resumes, still silences, still retracts.
   */
  atCap(): boolean {
    return this.photoGroups() >= CORRECTION_CAP_GROUPS;
  }

  bytes(): number {
    return this.file.corrections.reduce((total, correction) => total + correction.bytes, 0);
  }

  find(id: string): DeskCorrection | null {
    return this.file.corrections.find((correction) => correction.id === id) ?? null;
  }

  /** The id the NEXT correction will get. Dense over recorded corrections, so
   *  `split` alternates train/eval exactly as `clipSplit` does over clips. */
  nextId(): string {
    return makeCorrectionId(this.nextIndex());
  }

  private nextIndex(): number {
    let highest = this.file.lifetimeCorrections;
    for (const correction of this.file.corrections) {
      const parsed = Number.parseInt(correction.id.replace(/^dc-/, ""), 10);
      if (Number.isFinite(parsed) && parsed > highest) {
        highest = parsed;
      }
    }
    return highest + 1;
  }

  /**
   * Write one correction: the JPEGs, the thumbnail, and one JSON record.
   *
   * THIS IS THE ONLY METHOD IN THE FEATURE THAT CREATES A FILE, and it runs
   * only from a verdict tap. It touches no weights and has no call path to any
   * fitting code — `no-retrain.test.ts` asserts that by spying on this seam
   * rather than by reading the code.
   */
  record(input: RecordInput): DeskCorrection {
    const index = this.nextIndex();
    const id = makeCorrectionId(index);
    const meaning = correctionMeaning(input.capture.kind, input.verdict);
    const capped = this.atCap();
    const frames: DeskCorrectionFrame[] = [];
    let bytes = 0;

    if (!capped) {
      this.fs.mkdirSync(correctionDirPath(this.dir, id));
      let frameIndex = 1;
      for (const retained of input.capture.frames) {
        const relative = correctionFrameRelative(id, frameIndex);
        const jpeg = encodeFrameJpeg(retained.frame);
        this.fs.writeFileSync(correctionFilePath(this.dir, relative), jpeg);
        const prediction = framePrediction(retained.snapshot, input.capture.kind);
        frames.push({
          file: relative,
          at: retained.at,
          width: retained.frame.width,
          height: retained.frame.height,
          bytes: jpeg.length,
          predicted: prediction.predicted,
          confidence: prediction.confidence,
          // Filled by the idle-only extraction queue, or by the refit itself.
          // The JPEG is the durable source of truth; this is only a cache.
          hidden: null,
          hiddenFor: null,
        });
        bytes += jpeg.length;
        frameIndex += 1;
      }
      const first = input.capture.frames[0];
      if (first !== undefined) {
        const thumb = encodeThumbJpeg(first.frame);
        this.fs.writeFileSync(
          correctionFilePath(this.dir, correctionThumbRelative(id)),
          thumb,
        );
        bytes += thumb.length;
      }
    }

    const correction: DeskCorrection = {
      v: 1,
      id,
      at: input.capture.at,
      day: input.day,
      kind: input.capture.kind,
      verdict: input.verdict,
      modelLabel: input.capture.modelLabel,
      modelConfidence: input.capture.modelConfidence,
      label: meaning.label,
      head: meaning.head,
      split: correctionSplit(index),
      deskModelId: input.capture.deskModelId,
      baseHeadHash: input.baseHeadHash,
      featureVersion: input.featureVersion,
      frames,
      bytes,
      capped,
      retraction: input.retraction,
    };

    this.file = {
      v: 1,
      lifetimeCorrections: this.file.lifetimeCorrections + 1,
      corrections: [...this.file.corrections, correction],
    };
    this.flush();
    return correction;
  }

  /** One row, gone: the photographs and the record together. */
  remove(id: string): boolean {
    const correction = this.find(id);
    if (correction === null) {
      return false;
    }
    this.fs.rmSync(correctionDirPath(this.dir, id));
    this.thumbs.delete(id);
    this.file = {
      ...this.file,
      corrections: this.file.corrections.filter((entry) => entry.id !== id),
    };
    this.flush();
    return true;
  }

  /**
   * *Delete all my correction photos.*
   *
   * The frame tree, the index, the personal head AND the refit report, in one
   * `rmSync`. Keeping a model fitted on photographs the student just erased
   * would be the loophole that makes the erase cosmetic — which is why this
   * takes the whole directory rather than only `frames/`.
   */
  clear(): void {
    this.fs.rmSync(correctionsPath(this.dir));
    this.thumbs.clear();
    this.file = emptyCorrectionsFile();
  }

  /**
   * Cache the 16 hidden activations for one frame. A no-op for an unknown id
   * or frame: the cache is allowed to be missing, and the JPEG can always
   * regenerate it.
   */
  setFrameHidden(id: string, file: string, hidden: number[], hiddenFor: string): boolean {
    const applied = this.applyHidden(id, file, hidden, hiddenFor);
    if (applied) {
      this.flush();
    }
    return applied;
  }

  /**
   * The same, for a whole refit's worth of frames, with ONE write at the end.
   *
   * A refit recomputes up to `CORRECTION_CAP_GROUPS × 3` activations in a row,
   * and flushing the entire index after each of them would rewrite a growing
   * file three hundred and sixty times for one button. Returns how many landed.
   */
  setFramesHidden(
    updates: readonly { id: string; file: string; hidden: number[]; hiddenFor: string }[],
  ): number {
    let applied = 0;
    for (const update of updates) {
      if (this.applyHidden(update.id, update.file, update.hidden, update.hiddenFor)) {
        applied += 1;
      }
    }
    if (applied > 0) {
      this.flush();
    }
    return applied;
  }

  private applyHidden(id: string, file: string, hidden: number[], hiddenFor: string): boolean {
    const correction = this.find(id);
    if (correction === null) {
      return false;
    }
    const frame = correction.frames.find((entry) => entry.file === file);
    if (frame === undefined) {
      return false;
    }
    frame.hidden = [...hidden];
    frame.hiddenFor = hiddenFor;
    return true;
  }

  /** Newest first, with a thumbnail per row and never a full frame. */
  list(): CorrectionListItem[] {
    return [...this.file.corrections].reverse().map((correction) => ({
      id: correction.id,
      at: correction.at,
      day: correction.day,
      kind: correction.kind,
      verdict: correction.verdict,
      modelLabel: correction.modelLabel,
      modelConfidence: correction.modelConfidence,
      label: correction.label,
      head: correction.head,
      frames: correction.frames.length,
      bytes: correction.bytes,
      capped: correction.capped,
      thumbnail: this.readThumb(correction.id),
      excludedBecause: excludedBecause(correction.kind, correction.verdict),
    }));
  }

  private readThumb(id: string): string | null {
    const cached = this.thumbs.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const path = correctionFilePath(this.dir, correctionThumbRelative(id));
    let thumb: string | null = null;
    try {
      if (this.fs.existsSync(path)) {
        thumb = thumbDataUrl(this.fs.readFileSync(path));
      }
    } catch {
      // A missing or unreadable thumbnail costs a picture in a list, never
      // the list.
      thumb = null;
    }
    this.thumbs.set(id, thumb);
    return thumb;
  }

  private flush(): void {
    this.fs.writeJson(correctionsIndexPath(this.dir), this.file);
  }
}
