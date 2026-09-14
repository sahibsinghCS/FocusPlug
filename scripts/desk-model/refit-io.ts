import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deskRoot } from "../../src/main/desk/assets";
import { isAttentionProxyRow } from "./attention-proxies";
import type {
  AttentionAnchors,
  AttentionAnchorRow,
  PersonalAttentionHead,
  RefitReport,
} from "./personal-refit";
import { ATTENTION_LABELS, correctionPool, type CorrectionPool } from "./personal-refit";
import type { AttentionLabel } from "@shared/types";

/**
 * The IO shell for the personal refit: hashes, the committed anchor pack, and
 * a `<userData>/desk-corrections/` directory as the trainer sees it.
 *
 * Everything that DECIDES anything lives in `personal-refit.ts`, which is pure
 * and testable without a data pack or a user directory. This file only reads
 * bytes, and is deliberately paranoid about them: a corrections directory is
 * written by a running app on a student's machine and may be half-written, a
 * version old, or hand-edited. A bad record is dropped with a counted reason;
 * nothing here throws its way into a refit.
 */

/** Must match `ATTENTION_ANCHORS_RELATIVE_PATH` in your-model.ts. */
export const ATTENTION_ANCHORS_RELATIVE_PATH = join("model", "weights", "attention-anchors.json");
export const ATTENTION_HEAD_RELATIVE_PATH = join("model", "weights", "attention-head.json");

export function attentionHeadFile(): string {
  return join(deskRoot(), ATTENTION_HEAD_RELATIVE_PATH);
}

export function attentionAnchorsFile(): string {
  return join(deskRoot(), ATTENTION_ANCHORS_RELATIVE_PATH);
}

/** Provenance beside the pack, in the same shape as `*-head.metrics.json`. */
/**
 * The one hard licence rule for the committed anchor pack: the CC BY-NC-SA
 * `nc/` bucket (the Edinburgh office-webcam frames) never ships in this MIT
 * repository, not even as sixteen numbers derived from it. Vacuous today — no
 * `nc` image was ever attention-labelled — and enforced so it stays vacuous.
 */
export function isNonCommercialPath(path: string): boolean {
  return path === "nc" || path.startsWith("nc/");
}

/**
 * Which held-out population a row belongs to. The repo refuses to pool these
 * two: their truth is not equally good (one is an annotation, one is the
 * search query that found the photo) and their class mix is different, so the
 * gate scores them separately as well as together.
 */
export function anchorSlice(row: { path: string }): "adaption" | "proxy" {
  return isAttentionProxyRow(row) ? "proxy" : "adaption";
}

export function attentionAnchorsMetricsFile(): string {
  return attentionAnchorsFile().replace(/\.json$/, ".metrics.json");
}

/** sha256, first 16 hex — the whole definition of `baseHeadHash`. */
export function sha16(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/**
 * The hash of the head file AS IT IS ON DISK. Hashing the bytes rather than a
 * re-serialisation means an app update that reformats the JSON counts as a
 * different head, which is the safe direction: the anchors are rebuilt and the
 * cached activations recomputed, instead of being scored against a layer 0
 * they were not computed from.
 */
export function attentionHeadHash(file: string = attentionHeadFile()): string {
  return sha16(readFileSync(file));
}

function isFiniteNumberArray(value: unknown, length?: number): value is number[] {
  return (
    Array.isArray(value) &&
    (length === undefined || value.length === length) &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function isAttentionLabel(value: unknown): value is AttentionLabel {
  return typeof value === "string" && (ATTENTION_LABELS as readonly string[]).includes(value);
}

export interface LoadedAnchors {
  anchors: AttentionAnchors;
  /** sha256 of the file's bytes, first 16 — `RefitReport.anchorsHash`. */
  hash: string;
}

/** null when the file is absent, unparseable, or not an anchor pack. */
export function loadAttentionAnchors(file: string = attentionAnchorsFile()): LoadedAnchors | null {
  if (!existsSync(file)) {
    return null;
  }
  const bytes = readFileSync(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  const pack = parsed as AttentionAnchors;
  if (
    typeof pack !== "object" ||
    pack === null ||
    pack.v !== 1 ||
    typeof pack.baseHeadHash !== "string" ||
    typeof pack.hiddenDim !== "number" ||
    !Array.isArray(pack.labels) ||
    pack.labels.length !== ATTENTION_LABELS.length ||
    pack.labels.some((label, index) => label !== ATTENTION_LABELS[index]) ||
    !Array.isArray(pack.rows)
  ) {
    return null;
  }
  const rows: AttentionAnchorRow[] = [];
  for (const row of pack.rows) {
    if (
      typeof row?.path === "string" &&
      (row.slice === "adaption" || row.slice === "proxy") &&
      isAttentionLabel(row.truth) &&
      isFiniteNumberArray(row.hidden, pack.hiddenDim)
    ) {
      rows.push({ path: row.path, slice: row.slice, truth: row.truth, hidden: row.hidden });
    }
  }
  return { anchors: { ...pack, rows }, hash: sha16(bytes) };
}

/* ────────────────────────────────────────────────────────────────────────
 * <userData>/desk-corrections/ — the student's own directory
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The pool builder is the app's, re-exported here rather than restated: the
 * three exclusions it counts (an `away` correction is presence evidence, a
 * capped record kept no photos, an activation computed against another head
 * is a wrong number) decide what a refit is fitted on, and a trainer that
 * excluded a different set would not be checking the app's arithmetic.
 */
export { correctionPool, type CorrectionPool };

export const DESK_CORRECTIONS_DIR = "desk-corrections";
export const CORRECTIONS_INDEX = "corrections.json";
export const PERSONAL_HEAD_FILE = "personal-attention-head.json";
export const REFIT_REPORT_FILE = "refit-report.json";

export function correctionsIndexPath(directory: string): string {
  return join(directory, CORRECTIONS_INDEX);
}

export function personalHeadPath(directory: string): string {
  return join(directory, PERSONAL_HEAD_FILE);
}

export function refitReportPath(directory: string): string {
  return join(directory, REFIT_REPORT_FILE);
}

/** The frozen `DeskCorrectionFrame`, as much of it as a refit reads. */
export interface StoredFrame {
  file: string;
  at: number;
  bytes: number;
  predicted: string;
  confidence: number;
  hidden: number[] | null;
  hiddenFor: string | null;
}

/** The frozen `DeskCorrection`, as much of it as a refit reads. */
export interface StoredCorrection {
  id: string;
  at: number;
  kind: string;
  verdict: string;
  /** What the model said, and how sure it was, at the moment it paused. */
  modelLabel: string;
  modelConfidence: number;
  label: string;
  head: string;
  split: "train" | "eval";
  baseHeadHash: string;
  frames: StoredFrame[];
  capped: boolean;
}

export interface StoredCorrections {
  v: 1;
  lifetimeCorrections: number;
  corrections: StoredCorrection[];
  /** Records the revive dropped, and why — printed, never swallowed. */
  dropped: string[];
}

/**
 * Defensive revive, in the house style: a wrong `v`, a non-array, a record
 * with no id, a NaN — that record is dropped and the rest of the file is
 * still read. A refit is derived data; losing one malformed record must never
 * cost the student the other hundred.
 */
export function readCorrections(directory: string): StoredCorrections {
  const empty: StoredCorrections = { v: 1, lifetimeCorrections: 0, corrections: [], dropped: [] };
  const file = correctionsIndexPath(directory);
  if (!existsSync(file)) {
    return { ...empty, dropped: [`${file} does not exist`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { ...empty, dropped: [`${file} is not JSON: ${(error as Error).message}`] };
  }
  const raw = parsed as { v?: unknown; lifetimeCorrections?: unknown; corrections?: unknown };
  if (typeof raw !== "object" || raw === null || raw.v !== 1 || !Array.isArray(raw.corrections)) {
    return { ...empty, dropped: [`${file} is not a v1 corrections file`] };
  }
  const dropped: string[] = [];
  const corrections: StoredCorrection[] = [];
  const seen = new Set<string>();
  for (const entry of raw.corrections as unknown[]) {
    const record = entry as Partial<StoredCorrection>;
    if (typeof record?.id !== "string" || record.id.length === 0) {
      dropped.push("a record with no id");
      continue;
    }
    if (seen.has(record.id)) {
      dropped.push(`${record.id}: repeated id`);
      continue;
    }
    if (record.split !== "train" && record.split !== "eval") {
      dropped.push(`${record.id}: split is not train or eval`);
      continue;
    }
    if (typeof record.label !== "string" || typeof record.head !== "string") {
      dropped.push(`${record.id}: no label or head`);
      continue;
    }
    const frames: StoredFrame[] = [];
    for (const frame of Array.isArray(record.frames) ? record.frames : []) {
      const candidate = frame as Partial<StoredFrame>;
      if (typeof candidate?.file !== "string") {
        dropped.push(`${record.id}: a frame with no file`);
        continue;
      }
      const hidden =
        candidate.hidden === null || candidate.hidden === undefined
          ? null
          : isFiniteNumberArray(candidate.hidden)
            ? candidate.hidden
            : null;
      if (hidden === null && candidate.hidden !== null && candidate.hidden !== undefined) {
        dropped.push(`${record.id}/${candidate.file}: activations are not finite numbers`);
      }
      frames.push({
        file: candidate.file,
        at: Number.isFinite(candidate.at) ? (candidate.at as number) : 0,
        bytes: Number.isFinite(candidate.bytes) ? (candidate.bytes as number) : 0,
        predicted: typeof candidate.predicted === "string" ? candidate.predicted : "",
        confidence: Number.isFinite(candidate.confidence) ? (candidate.confidence as number) : 0,
        hidden,
        hiddenFor: typeof candidate.hiddenFor === "string" ? candidate.hiddenFor : null,
      });
    }
    seen.add(record.id);
    corrections.push({
      id: record.id,
      at: Number.isFinite(record.at) ? (record.at as number) : 0,
      kind: typeof record.kind === "string" ? record.kind : "",
      verdict: typeof record.verdict === "string" ? record.verdict : "",
      modelLabel: typeof record.modelLabel === "string" ? record.modelLabel : "",
      modelConfidence: Number.isFinite(record.modelConfidence)
        ? (record.modelConfidence as number)
        : Number.NaN,
      label: record.label,
      head: record.head,
      split: record.split,
      baseHeadHash: typeof record.baseHeadHash === "string" ? record.baseHeadHash : "",
      frames,
      capped: record.capped === true,
    });
  }
  return {
    v: 1,
    lifetimeCorrections: Number.isFinite(raw.lifetimeCorrections)
      ? (raw.lifetimeCorrections as number)
      : corrections.length,
    corrections,
    dropped,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Writing: the head only when it passed, the report always
 * ──────────────────────────────────────────────────────────────────────── */

export function writeJsonAtomic(file: string, value: unknown, pretty = true): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
  renameSync(tmp, file);
}

/**
 * A failing refit DELETES any personal head that was there and writes only the
 * report, so there is no "inactive head" file for a bug to load by accident.
 * That is gate 4 of §6.1 in one function, and it is why this returns what it
 * did rather than taking it on trust.
 */
export function installPersonalHead(
  directory: string,
  head: PersonalAttentionHead | null,
): { installed: boolean; removed: boolean } {
  const file = personalHeadPath(directory);
  const existed = existsSync(file);
  if (head === null) {
    if (existed) {
      rmSync(file, { force: true });
    }
    return { installed: false, removed: existed };
  }
  writeJsonAtomic(file, head);
  return { installed: true, removed: false };
}

export function writeRefitReport(directory: string, report: RefitReport): string {
  const file = refitReportPath(directory);
  writeJsonAtomic(file, report);
  return file;
}

export interface ActivationUpdate {
  correctionId: string;
  /** Frame file, relative to the corrections directory. */
  file: string;
  hidden: number[];
  hiddenFor: string;
}

/**
 * Write recomputed activations back into `corrections.json` WITHOUT touching
 * anything else in it.
 *
 * The index is the student's file and carries fields this trainer has no
 * opinion about (the local day, the Focus Plan retraction, frame dimensions).
 * So the patch re-reads the raw JSON and edits two keys per frame in place,
 * rather than re-serialising the normalised view `readCorrections` returns —
 * a revive that drops what it does not understand is fine for reading and
 * would be data loss on the way back out.
 */
export function saveCachedActivations(
  directory: string,
  updates: readonly ActivationUpdate[],
): number {
  if (updates.length === 0) {
    return 0;
  }
  const file = correctionsIndexPath(directory);
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    corrections?: Array<{ id?: string; frames?: Array<{ file?: string } & Record<string, unknown>> }>;
  };
  const byId = new Map<string, Map<string, ActivationUpdate>>();
  for (const update of updates) {
    const frames = byId.get(update.correctionId) ?? new Map<string, ActivationUpdate>();
    frames.set(update.file, update);
    byId.set(update.correctionId, frames);
  }
  let patched = 0;
  for (const record of raw.corrections ?? []) {
    const frames = byId.get(String(record?.id ?? ""));
    if (!frames) {
      continue;
    }
    for (const frame of record.frames ?? []) {
      const update = frames.get(String(frame?.file ?? ""));
      if (update) {
        frame.hidden = update.hidden;
        frame.hiddenFor = update.hiddenFor;
        patched += 1;
      }
    }
  }
  writeJsonAtomic(file, raw);
  return patched;
}
