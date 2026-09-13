/**
 * The drift dataset, as a file.
 *
 * On a real install the adaptive fuse never needs this: it learns from the
 * drifts happening in front of it and the data never leaves the machine. The
 * file format exists for two jobs that happen off-device:
 *
 *   1. Fitting the shipped prior — the weights a brand-new install starts from,
 *      before it has seen you drift even once. Those are currently hand-set
 *      numbers in `model.ts`, which is the weakest claim in the whole model.
 *      Fit them on a population and they stop being a guess.
 *
 *   2. Sending a dataset somewhere that improves datasets, and replaying the
 *      improved one through the same eval to see whether it actually helped.
 *
 * One row is one drift: the moment the countdown started, plus what the student
 * did about it. Rows hold the *raw* observations, not the feature vector —
 * `extractFeatures` stays the single definition of how a moment becomes numbers,
 * so a dataset written today still trains correctly after the features change.
 */

import { extractFeatures, type DriftMoment } from "./features";
import type { DeskLabel } from "../types";

/** Column order in the CSV. Stable: external tools key off it. */
export const DRIFT_COLUMNS = [
  "drift_id",
  "cohort",
  "ts_iso",
  "elapsed_min",
  "planned_min",
  "violation",
  "focus_process",
  "desk_label",
  "desk_confidence",
  "webcam_enabled",
  "dwell_ms",
  "switches_last_two_min",
  "prior_drifts",
  "prior_kills",
  "hour",
  "fuse_sec",
  "recovered_after_sec",
  "recovered",
] as const;

export interface DriftRow {
  /** Stable id, so an improved file can be matched back to this one. */
  driftId: string;
  /** Where the row came from: `sim:<habit>` or `device`. Never a person's name. */
  cohort: string;
  tsIso: string;
  /** Minutes into the session when the countdown started. */
  elapsedMin: number;
  /** How long the session was planned to run. */
  plannedMin: number;
  violation: "blocked" | "away";
  /** Process that triggered it. Not a feature — kept for reading the file. */
  focusProcess: string;
  /** Empty string when the webcam was off and there was no reading at all. */
  deskLabel: DeskLabel | "";
  deskConfidence: number;
  webcamEnabled: boolean;
  dwellMs: number;
  switchesLastTwoMin: number;
  priorDrifts: number;
  priorKills: number;
  hour: number;
  /** The fuse this countdown was actually given. */
  fuseSec: number;
  /** Seconds to the cancel, or `null` when it ran to a kill. The label. */
  recoveredAfterSec: number | null;
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function rowToCells(row: DriftRow): string[] {
  return [
    row.driftId,
    row.cohort,
    row.tsIso,
    String(round(row.elapsedMin, 2)),
    String(round(row.plannedMin, 2)),
    row.violation,
    row.focusProcess,
    row.deskLabel,
    String(round(row.deskConfidence, 4)),
    row.webcamEnabled ? "1" : "0",
    String(Math.round(row.dwellMs)),
    String(row.switchesLastTwoMin),
    String(row.priorDrifts),
    String(row.priorKills),
    String(row.hour),
    String(row.fuseSec),
    row.recoveredAfterSec === null ? "" : String(round(row.recoveredAfterSec, 3)),
    row.recoveredAfterSec === null ? "0" : "1",
  ];
}

export function toCsv(rows: readonly DriftRow[]): string {
  const lines = [DRIFT_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(rowToCells(row).map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** One JSON object per line, the other format the platform accepts. */
export function toJsonl(rows: readonly DriftRow[]): string {
  const tidy = rows.map((row) => ({
    ...row,
    elapsedMin: round(row.elapsedMin, 2),
    plannedMin: round(row.plannedMin, 2),
    deskConfidence: round(row.deskConfidence, 4),
    dwellMs: Math.round(row.dwellMs),
    recoveredAfterSec:
      row.recoveredAfterSec === null ? null : round(row.recoveredAfterSec, 3),
  }));
  return `${tidy.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

/** Read back the JSONL form. Rows missing the label are skipped, not guessed. */
export function parseJsonl(text: string): DriftRow[] {
  const rows: DriftRow[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    const parsed = JSON.parse(line) as Partial<DriftRow>;
    if (typeof parsed.fuseSec !== "number" || !("recoveredAfterSec" in parsed)) {
      return;
    }
    rows.push({
      driftId: parsed.driftId ?? `row-${index}`,
      cohort: parsed.cohort ?? "unknown",
      tsIso: parsed.tsIso ?? new Date(0).toISOString(),
      elapsedMin: parsed.elapsedMin ?? 0,
      plannedMin: parsed.plannedMin ?? 50,
      violation: parsed.violation === "away" ? "away" : "blocked",
      focusProcess: parsed.focusProcess ?? "",
      deskLabel: parsed.deskLabel ?? "",
      deskConfidence: parsed.deskConfidence ?? 0,
      webcamEnabled: parsed.webcamEnabled ?? false,
      dwellMs: parsed.dwellMs ?? 0,
      switchesLastTwoMin: parsed.switchesLastTwoMin ?? 0,
      priorDrifts: parsed.priorDrifts ?? 0,
      priorKills: parsed.priorKills ?? 0,
      hour: parsed.hour ?? 0,
      fuseSec: parsed.fuseSec,
      recoveredAfterSec: parsed.recoveredAfterSec ?? null,
    });
  });
  return rows;
}

/** Splits one CSV line, honouring quoted cells. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function num(cells: readonly string[], index: number, fallback = 0): number {
  const parsed = Number(cells[index]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DESK_LABELS: readonly string[] = ["at_desk", "away", "uncertain"];

/**
 * Read a dataset back. Unknown columns are ignored and missing ones fall back,
 * so a file that has been through an external tool still loads as long as the
 * names survive. `recovered_after_sec` is the label; the `recovered` column is
 * derived and not trusted on the way in.
 */
export function parseCsv(text: string): DriftRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }
  const header = splitCsvLine(lines[0]!).map((name) => name.trim());
  const at = (name: string): number => header.indexOf(name);

  const index = {
    driftId: at("drift_id"),
    cohort: at("cohort"),
    tsIso: at("ts_iso"),
    elapsedMin: at("elapsed_min"),
    plannedMin: at("planned_min"),
    violation: at("violation"),
    focusProcess: at("focus_process"),
    deskLabel: at("desk_label"),
    deskConfidence: at("desk_confidence"),
    webcamEnabled: at("webcam_enabled"),
    dwellMs: at("dwell_ms"),
    switchesLastTwoMin: at("switches_last_two_min"),
    priorDrifts: at("prior_drifts"),
    priorKills: at("prior_kills"),
    hour: at("hour"),
    fuseSec: at("fuse_sec"),
    recoveredAfterSec: at("recovered_after_sec"),
  };

  if (index.fuseSec < 0 || index.recoveredAfterSec < 0) {
    throw new Error(
      "Dataset needs at least the fuse_sec and recovered_after_sec columns; got: " +
        header.join(", "),
    );
  }

  const rows: DriftRow[] = [];
  for (let line = 1; line < lines.length; line += 1) {
    const cells = splitCsvLine(lines[line]!);
    const recoveredCell = (cells[index.recoveredAfterSec] ?? "").trim();
    const deskLabel = (cells[index.deskLabel] ?? "").trim();

    rows.push({
      driftId: (cells[index.driftId] ?? `row-${line}`).trim(),
      cohort: (cells[index.cohort] ?? "unknown").trim(),
      tsIso: (cells[index.tsIso] ?? new Date(0).toISOString()).trim(),
      elapsedMin: num(cells, index.elapsedMin),
      plannedMin: num(cells, index.plannedMin, 50),
      violation: (cells[index.violation] ?? "").trim() === "away" ? "away" : "blocked",
      focusProcess: (cells[index.focusProcess] ?? "").trim(),
      deskLabel: DESK_LABELS.includes(deskLabel) ? (deskLabel as DeskLabel) : "",
      deskConfidence: num(cells, index.deskConfidence),
      webcamEnabled: (cells[index.webcamEnabled] ?? "0").trim() === "1",
      dwellMs: num(cells, index.dwellMs),
      switchesLastTwoMin: num(cells, index.switchesLastTwoMin),
      priorDrifts: num(cells, index.priorDrifts),
      priorKills: num(cells, index.priorKills),
      hour: num(cells, index.hour),
      fuseSec: num(cells, index.fuseSec, 10),
      recoveredAfterSec: recoveredCell === "" ? null : Number(recoveredCell),
    });
  }
  return rows;
}

/** A row as the moment the policy would have seen. Lossless for features. */
export function rowToMoment(row: DriftRow): DriftMoment {
  const ts = Date.parse(row.tsIso);
  const at = Number.isFinite(ts) ? ts : 0;
  const sessionStartedAt = at - row.elapsedMin * 60_000;

  return {
    ts: at,
    sessionStartedAt,
    sessionEndsAt: sessionStartedAt + row.plannedMin * 60_000,
    focus: {
      ts: at,
      processName: row.focusProcess,
      windowTitle: row.focusProcess,
      matchedAllow: false,
      matchedBlock: row.violation === "blocked",
    },
    desk:
      row.deskLabel === ""
        ? null
        : {
            ts: at,
            label: row.deskLabel,
            confidence: row.deskConfidence,
            webcamEnabled: row.webcamEnabled,
          },
    violation: row.violation,
    dwellMs: row.dwellMs,
    switchesLastTwoMin: row.switchesLastTwoMin,
    priorDrifts: row.priorDrifts,
    priorKills: row.priorKills,
    fuseSec: row.fuseSec,
    hour: row.hour,
  };
}

export function momentToRow(
  moment: DriftMoment,
  outcome: { recoveredAfterSec: number | null },
  meta: { driftId: string; cohort: string },
): DriftRow {
  const elapsedMin = Math.max(0, moment.ts - moment.sessionStartedAt) / 60_000;
  const plannedMin = Math.max(1, moment.sessionEndsAt - moment.sessionStartedAt) / 60_000;

  return {
    driftId: meta.driftId,
    cohort: meta.cohort,
    tsIso: new Date(moment.ts).toISOString(),
    elapsedMin,
    plannedMin,
    violation: moment.violation,
    focusProcess: moment.focus?.processName ?? "",
    deskLabel: moment.desk?.label ?? "",
    deskConfidence: moment.desk?.confidence ?? 0,
    webcamEnabled: moment.desk?.webcamEnabled ?? false,
    dwellMs: moment.dwellMs,
    switchesLastTwoMin: moment.switchesLastTwoMin,
    priorDrifts: moment.priorDrifts,
    priorKills: moment.priorKills,
    hour: moment.hour,
    fuseSec: moment.fuseSec,
    recoveredAfterSec: outcome.recoveredAfterSec,
  };
}

/** Sanity report for a file that came back from somewhere else. */
export interface DatasetSummary {
  rows: number;
  recovered: number;
  killed: number;
  cohorts: string[];
  meanFuseSec: number;
  medianRecoverySec: number | null;
  /** Rows dropped as unusable, with the reason. */
  problems: string[];
}

export function summarise(rows: readonly DriftRow[]): DatasetSummary {
  const problems: string[] = [];
  const recoveries: number[] = [];
  let fuseSum = 0;
  let recovered = 0;

  for (const row of rows) {
    if (!Number.isFinite(row.fuseSec) || row.fuseSec <= 0) {
      problems.push(`${row.driftId}: fuse_sec is ${row.fuseSec}`);
    }
    fuseSum += row.fuseSec;
    if (row.recoveredAfterSec !== null) {
      recovered += 1;
      if (!Number.isFinite(row.recoveredAfterSec) || row.recoveredAfterSec < 0) {
        problems.push(`${row.driftId}: recovered_after_sec is ${row.recoveredAfterSec}`);
      } else {
        recoveries.push(row.recoveredAfterSec);
        if (row.recoveredAfterSec > row.fuseSec) {
          // They came back after the fuse had already fired, which cannot have
          // been observed — the kill would have happened first.
          problems.push(
            `${row.driftId}: recovered at ${row.recoveredAfterSec}s on a ${row.fuseSec}s fuse`,
          );
        }
      }
    }
  }

  recoveries.sort((a, b) => a - b);
  const middle = Math.floor(recoveries.length / 2);

  return {
    rows: rows.length,
    recovered,
    killed: rows.length - recovered,
    cohorts: [...new Set(rows.map((row) => row.cohort))].sort(),
    meanFuseSec: rows.length === 0 ? 0 : fuseSum / rows.length,
    medianRecoverySec: recoveries.length === 0 ? null : recoveries[middle]!,
    problems,
  };
}

/** Feature matrix for a whole file, for anything that wants plain numbers. */
export function featureMatrix(rows: readonly DriftRow[]): number[][] {
  return rows.map((row) => extractFeatures(rowToMoment(row)));
}
