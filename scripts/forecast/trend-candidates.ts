import { classify } from "../../src/shared/policy";
import { extractFeatures } from "../../src/shared/forecast/features";
import { TelemetryRing, type TelemetryFrame, type Transition } from "../../src/shared/forecast/ring";
import { FORECAST_FEATURE_KEYS } from "../../src/shared/forecast/types";
import type { DeskSnapshot, FocusSnapshot } from "../../src/shared/types";
import {
  REPLAY_DESK_THRESHOLD,
  REPLAY_STRICT_MODE,
  type RawDeskEvent,
  type RawFocusEvent,
  type RawSession,
} from "./lib";

/**
 * ============================================================================
 * THE RETIRED TREND CANDIDATES — kept so the rejections stay re-derivable
 * ============================================================================
 *
 * Thirteen trend features were mined against the shipped level block; six
 * earned a place in `src/shared/forecast/features.ts` and seven did not. The
 * seven live here rather than in the shipped extractor, because a feature that
 * does not ship should not cost a runtime multiply — but deleting them would
 * make the published rejection table unreproducible, and "every number is
 * re-derivable by running the repo's own commands" is the rule this project is
 * built on. So `npm run forecast:features` still recomputes all thirteen: six
 * from the dataset's own columns (the real `extractFeatures` wrote them) and
 * seven from here.
 *
 * Every one of them reads the SAME `TelemetryRing` public API the shipped
 * extractor does — no new telemetry was ever proposed. The definitions are
 * verbatim what was measured; do not "improve" them, or the table stops being
 * a record of what happened. To re-open a rejection, add the feature back to
 * `FORECAST_FEATURE_KEYS` and re-run the mine.
 *
 * WHY EACH ONE WAS PROPOSED, and what the mine said (inner-val, train-split
 * sessions only; full numbers in `data/forecast/feature-mine.json`):
 *
 *  - `greyRun` — age of the CURRENT uninterrupted off-list run, log-compressed.
 *    `otherDwell30` saturates at 30 s and `fracOther60` at 60 s, so a 40 s
 *    loiter and a 200 s one encode identically; this restores episode age.
 *    Rejected: `greyLeaky120` already carries depth, and adds it more smoothly.
 *  - `sinceTitleFlip` — recency of the last same-process title change.
 *    Rejected: actively harmful (−0.0020 added back to the kept set).
 *  - `otherFrac180` — grey share over 180 s (hybrid's version of loiter depth).
 *    Rejected: +0.0004, dominated by `greyLeaky120`.
 *  - `repeatRatio60` — switches per distinct app; meant to separate
 *    research_churn's cycling inside a known set from real exploration.
 *    Rejected: −0.00001. `distinct60` and `switch60` already span it.
 *  - `deskConfDrop120`'s twin `allowSlip30v150` — allowlisted share now vs
 *    earlier. Rejected: −0.0002.
 *  - `newApps30` — apps focused in the last 30 s that were not seen in the
 *    preceding 4½ minutes; the exploration-vs-cycling discriminator.
 *    Rejected: +0.0001.
 *  - `switchAccel60v180` — a long-baseline sibling of `switchAccel`.
 *    Rejected: −0.0014, and its 128-entry transition ring truncates a 180 s
 *    window under heavy churn, which biases the denominator low.
 */

export const RETIRED_TREND_KEYS = [
  "greyRun",
  "sinceTitleFlip",
  "otherFrac180",
  "repeatRatio60",
  "allowSlip30v150",
  "newApps30",
  "switchAccel60v180",
] as const;

export type RetiredTrendKey = (typeof RETIRED_TREND_KEYS)[number];

/**
 * The full candidate block as it was mined, in the order the backward
 * elimination saw it: the six that shipped (read from the dataset's own
 * columns, so they are literally `extractFeatures` output) interleaved with the
 * seven retired ones (computed here). `source` says which is which.
 */
export const MINED_TREND_ORDER: ReadonlyArray<{
  key: string;
  source: "shipped" | "retired";
}> = [
  { key: "deskSagSlope30", source: "shipped" },
  { key: "dwellShrink30v90", source: "shipped" },
  { key: "titleChurnAccel", source: "shipped" },
  { key: "greyRun", source: "retired" },
  { key: "sinceTitleFlip", source: "retired" },
  { key: "otherFrac180", source: "retired" },
  { key: "greyLeaky120", source: "shipped" },
  { key: "absenceRun60", source: "shipped" },
  { key: "repeatRatio60", source: "retired" },
  { key: "deskConfDrop120", source: "shipped" },
  { key: "allowSlip30v150", source: "retired" },
  { key: "newApps30", source: "retired" },
  { key: "switchAccel60v180", source: "retired" },
];

/** Number of level-block features the trend candidates were mined against. */
export const MINED_BASE_DIM = 18;

const RATE_EPS = 0.01;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function logCompress(x: number, cap: number): number {
  if (!Number.isFinite(x) || x <= 0) {
    return 0;
  }
  return Math.min(Math.log1p(x) / Math.log1p(cap), 1);
}

function rateRatio(shortCount: number, shortSec: number, longCount: number, longSec: number): number {
  const ratio = (shortCount / shortSec + RATE_EPS) / (longCount / longSec + RATE_EPS);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

function processKeysIn(
  frames: readonly TelemetryFrame[],
  procTransitions: readonly Transition[],
  currentKey: string,
): Set<string> {
  const keys = new Set<string>();
  for (const frame of frames) {
    if (frame.processKey !== "") {
      keys.add(frame.processKey);
    }
  }
  for (const transition of procTransitions) {
    if (transition.fromKey !== "") {
      keys.add(transition.fromKey);
    }
    if (transition.toKey !== "") {
      keys.add(transition.toKey);
    }
  }
  if (currentKey !== "") {
    keys.add(currentKey);
  }
  return keys;
}

function meanOf(
  frames: readonly TelemetryFrame[],
  value: (frame: TelemetryFrame) => number,
  minFrames: number,
): number | null {
  if (frames.length < minFrames) {
    return null;
  }
  let sum = 0;
  for (const frame of frames) {
    sum += value(frame);
  }
  const mean = sum / frames.length;
  return Number.isFinite(mean) ? mean : null;
}

function windowDrop(current: number | null, earlier: number | null): number {
  if (current === null || earlier === null) {
    return 0;
  }
  const drop = earlier - current;
  return Number.isFinite(drop) && drop > 0 ? drop : 0;
}

/** The seven retired candidates, encoded to [0,1] in `RETIRED_TREND_KEYS` order. */
export function extractRetiredTrend(ring: TelemetryRing, ts: number): number[] {
  const frames600 = ring.framesInRange(ts - 600_000, ts);
  const transitions600 = ring.transitionsInRange(ts - 600_000, ts);
  const inWindow = <T extends { ts: number }>(items: readonly T[], sec: number): T[] =>
    items.filter((item) => item.ts > ts - sec * 1000);
  const frames60 = inWindow(frames600, 60);
  const frames30 = inWindow(frames60, 30);
  const procAll = transitions600.filter((transition) => transition.kind === "proc");
  const titleAll = transitions600.filter((transition) => transition.kind === "title");
  const proc60 = inWindow(procAll, 60).length;

  // greyRun — trailing run of "other" frames, in frames (1 Hz ⇒ seconds).
  let greyRun = 0;
  for (let i = frames600.length - 1; i >= 0; i -= 1) {
    if ((frames600[i] as TelemetryFrame).focusKind !== "other") {
      break;
    }
    greyRun += 1;
  }

  // sinceTitleFlip — seconds since the last same-process title change.
  const lastTitle = titleAll[titleAll.length - 1];
  const sinceTitleFlip =
    lastTitle === undefined ? 600 : Math.min(Math.max(0, (ts - lastTitle.ts) / 1000), 600);

  // otherFrac180 — grey share over 180 s.
  const frames180 = inWindow(frames600, 180);
  const otherFrac180 =
    frames180.length > 0
      ? frames180.filter((frame) => frame.focusKind === "other").length / frames180.length
      : 0;

  // repeatRatio60 — proc switches per distinct app over 60 s.
  const distinct = processKeysIn(frames60, inWindow(procAll, 60), ring.currentProcessKey);
  const repeatRatio60 = proc60 / Math.max(1, distinct.size);

  // allowSlip30v150 — allowlisted share now vs the preceding 120 s.
  const allowOf = (frame: TelemetryFrame): number => (frame.focusKind === "allow" ? 1 : 0);
  const allowSlip30v150 = windowDrop(
    meanOf(frames30, allowOf, 5),
    meanOf(
      frames600.filter((frame) => frame.ts > ts - 150_000 && frame.ts <= ts - 30_000),
      allowOf,
      5,
    ),
  );

  // newApps30 — apps in the last 30 s unseen in the preceding 4½ minutes.
  const recentKeys = processKeysIn(frames30, inWindow(procAll, 30), ring.currentProcessKey);
  const olderKeys = processKeysIn(
    frames600.filter((frame) => frame.ts > ts - 300_000 && frame.ts <= ts - 30_000),
    procAll.filter((transition) => transition.ts > ts - 300_000 && transition.ts <= ts - 30_000),
    "",
  );
  let newApps30 = 0;
  for (const key of recentKeys) {
    if (!olderKeys.has(key)) {
      newApps30 += 1;
    }
  }

  // switchAccel60v180 — long-baseline switch acceleration.
  const switchAccel60v180 = rateRatio(proc60, 60, inWindow(procAll, 180).length, 180);

  const encoded: Record<RetiredTrendKey, number> = {
    greyRun: logCompress(greyRun, 300),
    sinceTitleFlip: clamp01(1 - logCompress(sinceTitleFlip, 600)),
    otherFrac180: clamp01(otherFrac180),
    repeatRatio60: clamp01(repeatRatio60 / 5),
    allowSlip30v150: clamp01(allowSlip30v150),
    newApps30: clamp01(newApps30 / 3),
    switchAccel60v180: clamp01(switchAccel60v180 / 4),
  };
  return RETIRED_TREND_KEYS.map((key) => encoded[key]);
}

export interface CandidateFrame {
  /** Seconds since session start (1-based), matching dataset rows' `t`. */
  t: number;
  /** The SHIPPED features, from the real extractor — used to self-check the join. */
  base: number[];
  /** The retired candidates, `RETIRED_TREND_KEYS` order. */
  retired: number[];
}

/**
 * Replays one raw session through the SHARED ring + `classify` +
 * `extractFeatures` — the same loop `lib.replaySession` runs — and evaluates
 * the retired candidates on the same ring at the same instant. The base output
 * is asserted against `dataset.jsonl`'s own columns by the caller, so a drift
 * between this replay and the builder's cannot go unnoticed.
 */
export function replayWithCandidates(session: RawSession): CandidateFrame[] {
  const ring = new TelemetryRing(0);
  ring.reset(0);
  const out: CandidateFrame[] = [];
  let focusIndex = 0;
  let deskIndex = 0;
  let lastFocus: FocusSnapshot | null = null;
  let lastDesk: DeskSnapshot | null = null;

  for (let t = 1; t <= session.durationSec; t += 1) {
    const ts = t * 1000;
    while (
      focusIndex < session.focus.length &&
      (session.focus[focusIndex] as RawFocusEvent).ts <= ts
    ) {
      const event = session.focus[focusIndex] as RawFocusEvent;
      lastFocus = {
        ts: event.ts,
        processName: event.proc,
        windowTitle: event.title,
        matchedAllow: event.allow,
        matchedBlock: event.block,
      };
      ring.noteFocus(lastFocus);
      focusIndex += 1;
    }
    while (deskIndex < session.desk.length && (session.desk[deskIndex] as RawDeskEvent).ts <= ts) {
      const event = session.desk[deskIndex] as RawDeskEvent;
      lastDesk = {
        ts: event.ts,
        label: event.label,
        confidence: event.conf,
        webcamEnabled: event.on,
      };
      ring.noteDesk(lastDesk, REPLAY_DESK_THRESHOLD);
      deskIndex += 1;
    }
    const classified = classify({
      sessionActive: true,
      focus: lastFocus,
      desk: lastDesk,
      countdownSec: 10,
      deskThreshold: REPLAY_DESK_THRESHOLD,
      strictMode: REPLAY_STRICT_MODE,
    });
    ring.noteStatus(classified.decision);
    ring.commit(ts);
    out.push({
      t,
      base: extractFeatures(ring, ts).values,
      retired: extractRetiredTrend(ring, ts),
    });
  }
  return out;
}

/** Guard: the mined order must name every shipped trend key exactly once. */
export function assertMinedOrder(): void {
  for (const entry of MINED_TREND_ORDER) {
    if (entry.source === "shipped" && !FORECAST_FEATURE_KEYS.includes(entry.key as never)) {
      throw new Error(
        `MINED_TREND_ORDER names "${entry.key}" as shipped, but FORECAST_FEATURE_KEYS does not ` +
          `contain it — retire it here or add it back to the contract`,
      );
    }
    if (entry.source === "retired" && FORECAST_FEATURE_KEYS.includes(entry.key as never)) {
      throw new Error(
        `MINED_TREND_ORDER names "${entry.key}" as retired, but it is in FORECAST_FEATURE_KEYS — ` +
          `it would be counted twice`,
      );
    }
  }
  const shipped = FORECAST_FEATURE_KEYS.slice(MINED_BASE_DIM);
  const named = MINED_TREND_ORDER.filter((e) => e.source === "shipped").map((e) => e.key);
  for (const key of shipped) {
    if (!named.includes(key)) {
      throw new Error(
        `feature "${key}" ships but is not in MINED_TREND_ORDER — the mine would silently skip it`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The mined design matrix: dataset columns + retired candidates, joined
// ---------------------------------------------------------------------------

/** `MINED_BASE_DIM` level features + `MINED_TREND_ORDER.length` candidates. */
export const MINED_DIM = MINED_BASE_DIM + MINED_TREND_ORDER.length;

/** Column names of the mined matrix, in column order. */
export const MINED_KEYS: readonly string[] = [
  ...FORECAST_FEATURE_KEYS.slice(0, MINED_BASE_DIM),
  ...MINED_TREND_ORDER.map((entry) => entry.key),
];

export interface MinedRows {
  n: number;
  dim: number;
  /** n × MINED_DIM, encoded [0,1]. */
  x: Float32Array;
  y: Uint8Array;
  /** NaN ⇒ no onset ahead. */
  secs: Float64Array;
  importance: Float64Array;
  sessionOf: Int32Array;
  sessions: string[];
  /** Per session: true for synthetic/recorded, false for augmented derivatives. */
  synthetic: boolean[];
  selfCheck: { rows: number; worstDelta: number };
}

/**
 * Reads `split:"train"` rows of `dataFile` and joins the retired candidates
 * onto them by (session_id, t), replaying `rawFile` (plus the pipeline's own
 * `augmentLocal` derivatives) through the shared ring. The replay's base
 * output is checked against the dataset's own columns on a stride so a drift
 * between the two paths fails the run instead of biasing the mine.
 *
 * Only train rows are ever read. The eval split is not opened.
 */
export async function loadMinedTrainRows(
  dataFile: string,
  rawFile: string,
  seed: number,
  augmentFraction = 0.25,
): Promise<MinedRows> {
  assertMinedOrder();
  const { augmentLocal } = await import("./augment-local");
  const { keepProbability, readJsonl, splitForSession } = await import("./lib");
  type Row = import("./lib").DatasetRow;

  const rawSessions: RawSession[] = [];
  for await (const session of readJsonl<RawSession>(rawFile)) {
    rawSessions.push(session);
  }
  const trainRaw = rawSessions.filter((s) => splitForSession(s.id, seed) === "train");
  const augmented = augmentLocal(trainRaw, { fraction: augmentFraction, seed });
  const retiredBySession = new Map<string, Float32Array>();
  const baseBySession = new Map<string, Float32Array>();
  const retiredDim = RETIRED_TREND_KEYS.length;
  const baseDim = FORECAST_FEATURE_KEYS.length;
  for (const session of [...rawSessions, ...augmented]) {
    const frames = replayWithCandidates(session);
    const retired = new Float32Array(frames.length * retiredDim);
    const base = new Float32Array(frames.length * baseDim);
    frames.forEach((frame, i) => {
      for (let f = 0; f < retiredDim; f += 1) {
        retired[i * retiredDim + f] = frame.retired[f] as number;
      }
      for (let f = 0; f < baseDim; f += 1) {
        base[i * baseDim + f] = frame.base[f] as number;
      }
    });
    retiredBySession.set(session.id, retired);
    baseBySession.set(session.id, base);
  }

  const x: number[] = [];
  const y: number[] = [];
  const secs: number[] = [];
  const importance: number[] = [];
  const sessionOf: number[] = [];
  const sessions: string[] = [];
  const synthetic: boolean[] = [];
  const index = new Map<string, number>();
  const shippedColumn = new Map<string, number>();
  FORECAST_FEATURE_KEYS.forEach((key, i) => shippedColumn.set(key, i));
  const retiredColumn = new Map<string, number>();
  RETIRED_TREND_KEYS.forEach((key, i) => retiredColumn.set(key, i));
  let seen = 0;
  let checked = 0;
  let worstDelta = 0;

  for await (const row of readJsonl<Row>(dataFile)) {
    if (row.split !== "train") {
      continue;
    }
    if (row.features.length !== baseDim) {
      throw new Error(
        `dataset row has ${row.features.length} features, the extractor has ${baseDim} — ` +
          `rebuild with 'npm run forecast:data'`,
      );
    }
    const retired = retiredBySession.get(row.session_id);
    const base = baseBySession.get(row.session_id);
    if (retired === undefined || base === undefined) {
      throw new Error(
        `dataset session ${row.session_id} has no replay — the retired candidates would be ` +
          `undefined for it; refusing to guess`,
      );
    }
    seen += 1;
    if (seen % 257 === 0) {
      checked += 1;
      for (let f = 0; f < baseDim; f += 1) {
        worstDelta = Math.max(
          worstDelta,
          Math.abs((base[(row.t - 1) * baseDim + f] as number) - (row.features[f] as number)),
        );
      }
    }
    let s = index.get(row.session_id);
    if (s === undefined) {
      s = sessions.length;
      index.set(row.session_id, s);
      sessions.push(row.session_id);
      synthetic.push(row.source === "synthetic" || row.source === "recorded");
    }
    for (let f = 0; f < MINED_BASE_DIM; f += 1) {
      x.push(row.features[f] as number);
    }
    for (const entry of MINED_TREND_ORDER) {
      if (entry.source === "shipped") {
        x.push(row.features[shippedColumn.get(entry.key) as number] as number);
      } else {
        x.push(retired[(row.t - 1) * retiredDim + (retiredColumn.get(entry.key) as number)] as number);
      }
    }
    y.push(row.label);
    secs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
    importance.push(1 / keepProbability(row.label, row.secs_to_drift));
    sessionOf.push(s);
  }
  if (worstDelta > 1e-5) {
    throw new Error(
      `replay/dataset feature mismatch: worst |Δ| ${worstDelta} over ${checked} sampled rows`,
    );
  }
  return {
    n: y.length,
    dim: MINED_DIM,
    x: Float32Array.from(x),
    y: Uint8Array.from(y),
    secs: Float64Array.from(secs),
    importance: Float64Array.from(importance),
    sessionOf: Int32Array.from(sessionOf),
    sessions,
    synthetic,
    selfCheck: { rows: checked, worstDelta },
  };
}
