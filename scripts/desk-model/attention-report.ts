import {
  assertClipCounted,
  census,
  dedupeByPath,
  censusLine,
  clipCount,
  firstPersonGate,
  firstPersonRefusal,
  groupsCaveat,
  isFirstPersonRow,
  type FirstPersonGate,
  type GroupCensus,
} from "./first-person";
import { formatMetrics, scorePredictions, type EvalMetrics } from "./lib";

/**
 * The pure half of `eval-attention.ts`: scored pairs in, the exact lines the
 * script prints and the exact JSON it writes out. Nothing here loads weights,
 * reads the data pack or touches the disk, so the parts that must not drift —
 * the stock / first-person separation, the group-count gate, and the clip
 * count that rides on every first-person number — are unit-testable rather
 * than only observable by running the script against a data pack.
 *
 * TWO POPULATIONS, NEVER POOLED. Stock photos are 3rd-person; webcam clips are
 * 1st-person, which is what the app actually sees. A pooled accuracy would
 * mostly report their mixing ratio, so the top-level report stays the stock
 * slice and the first-person slice is scored on its own, behind the gate.
 *
 * FRAMES ARE NOT SAMPLES. Consecutive frames of one clip are near-identical,
 * so a clip is one independent sample however many frames it holds. Every
 * printed first-person number therefore names the CLIPS behind it, and
 * `assertClipCounted` throws rather than let one through without them.
 */

export interface Pair {
  path: string;
  truth: string;
  predicted: string;
  confidence: number;
  workspace: boolean;
  packLabel: string;
  /** Near-duplicate group for stock photos; the clip id for webcam frames. */
  group: string;
  attention: string;
}

export interface Binary {
  precision: number;
  recall: number;
  f1: number;
  /** Positive FRAMES (tp + fn). */
  support: number;
  /** Independent groups behind those positives — the real sample count. */
  supportGroups: number;
}

/** Independent groups behind a metric and behind each of its per-class rows. */
export interface MetricClips {
  total: number;
  byLabel: Record<string, number>;
}

export interface SliceReport {
  images: number;
  groups: number;
  overall: EvalMetrics;
  workspace: EvalMetrics;
  majority: string;
  majorityBaseline: EvalMetrics;
  phone: Binary;
  offTask: Binary;
  packPhone: Binary;
  misses: Pair[];
  /** One entry per printed metric, so no number is renderable without them. */
  clips: { overall: MetricClips; workspace: MetricClips };
}

export const TWO_POPULATIONS_BANNER =
  "TWO POPULATIONS, SCORED SEPARATELY — 3rd-person stock photos and 1st-person webcam clips are different distributions, and a pooled number would mostly report their mixing ratio.";

/**
 * The pack's `distracted` class is a stock-photo label. Webcam rows carry the
 * label the recorder declared in `pack_label`, so `distracted` never appears
 * on them and scoring it as a detector there manufactures a flattering 0%
 * baseline out of a vocabulary mismatch. Say that instead of printing it.
 */
export const PACK_BASELINE_NOT_APPLICABLE =
  "pack label `distracted` as a phone detector: not applicable to webcam rows — the pack never labelled them (`pack_label` carries the label you declared before recording), so there is no pack baseline here to beat.";

function binary(pairs: ReadonlyArray<{ truth: boolean; predicted: boolean; group: string }>): Binary {
  const tp = pairs.filter((pair) => pair.truth && pair.predicted).length;
  const fp = pairs.filter((pair) => !pair.truth && pair.predicted).length;
  const fn = pairs.filter((pair) => pair.truth && !pair.predicted).length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return {
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    support: tp + fn,
    supportGroups: new Set(pairs.filter((pair) => pair.truth).map((pair) => pair.group)).size,
  };
}

function metricClips(pairs: readonly Pair[]): MetricClips {
  const all = new Set<string>();
  const perLabel = new Map<string, Set<string>>();
  for (const pair of pairs) {
    all.add(pair.group);
    const seen = perLabel.get(pair.truth) ?? new Set<string>();
    seen.add(pair.group);
    perLabel.set(pair.truth, seen);
  }
  const byLabel: Record<string, number> = {};
  for (const [label, seen] of perLabel) {
    byLabel[label] = seen.size;
  }
  return { total: all.size, byLabel };
}

export function scoreSlice(labels: readonly string[], pairs: readonly Pair[]): SliceReport {
  const majority =
    (labels
      .map((label) => ({ label, count: pairs.filter((pair) => pair.truth === label).length }))
      .sort((a, b) => b.count - a.count)[0]?.label as string) ?? (labels[0] as string);
  const atWorkspace = pairs.filter((pair) => pair.workspace);
  return {
    images: pairs.length,
    groups: new Set(pairs.map((pair) => pair.group)).size,
    overall: scorePredictions(labels, pairs.slice()),
    workspace: scorePredictions(labels, atWorkspace),
    majority,
    majorityBaseline: scorePredictions(
      labels,
      pairs.map((pair) => ({ truth: pair.truth, predicted: majority })),
    ),
    phone: binary(
      pairs.map((pair) => ({
        truth: pair.truth === "phone",
        predicted: pair.predicted === "phone",
        group: pair.group,
      })),
    ),
    offTask: binary(
      pairs.map((pair) => ({
        truth: pair.truth !== "focused",
        predicted: pair.predicted !== "focused",
        group: pair.group,
      })),
    ),
    // What the pack's own label would have said, scored against the same truth.
    packPhone: binary(
      pairs.map((pair) => ({
        truth: pair.truth === "phone",
        predicted: pair.packLabel === "distracted",
        group: pair.group,
      })),
    ),
    misses: pairs.filter((pair) => pair.truth !== pair.predicted),
    clips: { overall: metricClips(pairs), workspace: metricClips(atWorkspace) },
  };
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

function formatBinary(name: string, value: Binary): string {
  return `${name}: precision ${pct(value.precision)} · recall ${pct(value.recall)} · F1 ${pct(value.f1)} (${value.support} positives)`;
}

/** The same line, with the clips behind BOTH its denominators named. */
function formatBinaryWithClips(name: string, value: Binary, scored: number): string {
  return `${name}: precision ${pct(value.precision)} · recall ${pct(value.recall)} · F1 ${pct(value.f1)} (${value.support} positive frames from ${clipCount(value.supportGroups)}; scored over ${clipCount(scored)})`;
}

/** `formatMetrics`, with the clip count on the headline and every class row. */
function formatMetricsWithClips(name: string, metrics: EvalMetrics, clips: MetricClips): string[] {
  const lines = [
    `${name}: ${(metrics.accuracy * 100).toFixed(2)}% (${metrics.correct}/${metrics.total} frames · ${clipCount(clips.total)})`,
  ];
  for (const [label, cls] of Object.entries(metrics.perClass)) {
    if (cls.total > 0) {
      lines.push(
        `  ${label.padEnd(10)} ${(cls.accuracy * 100).toFixed(2).padStart(6)}% (${cls.correct}/${cls.total} frames · ${clipCount(clips.byLabel[label] ?? 0)})`,
      );
    }
  }
  return lines;
}

/**
 * Stock rows render exactly as they did before webcam capture existed, so
 * `--stock-only` reproduces the pre-capture output. First-person rows render
 * through the clip-counted forms and then through `assertClipCounted`.
 */
export function renderSlice(
  title: string,
  slice: SliceReport,
  population: "stock" | "first-person",
): string[] {
  if (population === "stock") {
    return [
      formatMetrics(title, slice.overall),
      formatMetrics("  at a workspace only", slice.workspace),
      formatMetrics(`majority baseline (always ${slice.majority})`, slice.majorityBaseline),
      formatBinary("phone detection", slice.phone),
      formatBinary("off task (unfocused or phone)", slice.offTask),
      formatBinary("pack label `distracted` as a phone detector", slice.packPhone),
    ].flatMap((block) => block.split("\n"));
  }
  const scored = slice.clips.overall.total;
  return assertClipCounted([
    ...formatMetricsWithClips(title, slice.overall, slice.clips.overall),
    ...formatMetricsWithClips("  at a workspace only", slice.workspace, slice.clips.workspace),
    ...formatMetricsWithClips(
      `majority baseline (always ${slice.majority})`,
      slice.majorityBaseline,
      slice.clips.overall,
    ),
    formatBinaryWithClips("phone detection", slice.phone, scored),
    formatBinaryWithClips("off task (unfocused or phone)", slice.offTask, scored),
    PACK_BASELINE_NOT_APPLICABLE,
  ]);
}

export interface AttentionEvalInput {
  labels: readonly string[];
  pairs: readonly Pair[];
  /** Already through `resolveMinGroups`, which can only raise the floor. */
  minGroups: number;
  stockOnly: boolean;
  evaluatedAt: string;
}

export interface FirstPersonSection {
  minGroups: number;
  /** The webcam eval rows, scored or not — clips first, frames second. */
  census: GroupCensus;
  blockedBy: FirstPersonGate | null;
  /** True when `--stock-only` held the rows out before the gate ran. */
  excludedByStockOnly: boolean;
  /** Stays null unless the slice was scored: a number in the report gets quoted. */
  metrics: SliceReport | null;
  note: string;
}

export interface AttentionEvalReport extends SliceReport {
  evaluatedAt: string;
  truth: string;
  /** Top-level keys are the STOCK slice — what they were before captures existed. */
  population: "stock";
  stock: SliceReport;
  firstPerson: FirstPersonSection;
}

export interface AttentionEval {
  /** Everything the script prints, in order, one console.log per entry. */
  lines: string[];
  stockLines: string[];
  firstPersonLines: string[];
  report: AttentionEvalReport;
}

export function buildAttentionEval(input: AttentionEvalInput): AttentionEval {
  const { labels, minGroups, stockOnly, evaluatedAt } = input;
  // ONE PATH IS ONE IMAGE. The shell dedupes on the way in; this refuses to
  // render a report at all if a duplicate ever reaches here, because every
  // frame count below would then describe images that do not exist and every
  // ratio would count one image twice. Clip counts would stay honest, which
  // is exactly what makes the inflated frame counts hard to spot.
  const distinct = dedupeByPath(input.pairs);
  if (distinct.dropped > 0) {
    throw new Error(
      `${distinct.dropped} eval row(s) repeat a path already scored (${distinct.duplicatePaths.slice(0, 3).join(", ")}) — the same image scored twice is one sample counted twice, not two samples. Deduplicate datasets/desk-attention-labels.csv; a re-recorded clip must REPLACE its rows (--retake), never append a second set.`,
    );
  }
  const stockPairs = input.pairs.filter((pair) => !isFirstPersonRow(pair));
  const firstPersonPairs = input.pairs.filter((pair) => isFirstPersonRow(pair));
  if (stockPairs.length === 0) {
    throw new Error(
      "No stock (3rd-person) eval rows to score — the top-level report is the stock slice, and 0/0 is not an accuracy",
    );
  }
  // --stock-only holds the webcam rows out BEFORE the gate, so the block below
  // is byte-for-byte the pre-capture output.
  const mixed = !stockOnly && firstPersonPairs.length > 0;

  const stock = scoreSlice(labels, stockPairs);
  const stockLines: string[] = [];
  if (mixed) {
    stockLines.push(TWO_POPULATIONS_BANNER, "");
  }
  stockLines.push(
    ...renderSlice(
      mixed ? "attention head (eval · stock 3rd-person)" : "attention head (eval)",
      stock,
      "stock",
    ),
    `truth = Adaption Labs annotation${mixed ? " (stock rows only)" : ""}; see datasets/desk-attention-labels.csv`,
  );

  const counts = census(firstPersonPairs);
  const firstPersonLines: string[] = [];
  let gate: FirstPersonGate | null = null;
  let metrics: SliceReport | null = null;
  let note: string;

  if (stockOnly) {
    note =
      counts.frames > 0
        ? `first-person: NOT SCORED — --stock-only held out ${censusLine(counts)}. The block above is the stock slice on its own, exactly as it read before any capture.`
        : "first-person: NOT SCORED — --stock-only, and there are no webcam rows on the eval split anyway.";
    firstPersonLines.push(note);
  } else {
    gate = firstPersonGate(counts, minGroups);
    if (gate !== null) {
      note = firstPersonRefusal(gate, counts, minGroups);
      firstPersonLines.push(note);
      if (counts.frames > 0) {
        firstPersonLines.push(`  census: ${censusLine(counts)}`);
      }
    } else {
      metrics = scoreSlice(labels, firstPersonPairs);
      note = `${counts.groups} independent clips — a clip is one sample, however many frames it holds`;
      firstPersonLines.push(
        `first-person webcam — ${censusLine(counts)}`,
        "truth = the label declared before recording; every frame of a clip carries it by construction.",
        // The clip count rides on the headline AND on every line under it, so
        // no number here can be copied out of the report without it.
        ...renderSlice(
          `attention head (eval · 1st-person webcam, ${groupsCaveat(counts)})`,
          metrics,
          "first-person",
        ),
        `NOT a headline accuracy: ${counts.groups} clips is a ${counts.groups}-sample measurement. The honest claim is "adapted toward first-person, measured on ${counts.groups} clips".`,
      );
    }
  }
  assertClipCounted(firstPersonLines);

  return {
    lines: [...stockLines, "", ...firstPersonLines],
    stockLines,
    firstPersonLines,
    report: {
      evaluatedAt,
      truth:
        "Adaption Labs Adaptive Data annotation (stock) / the declared clip label (first-person)",
      population: "stock",
      ...stock,
      stock,
      firstPerson: {
        minGroups,
        census: counts,
        blockedBy: gate,
        excludedByStockOnly: stockOnly,
        metrics,
        note,
      },
    },
  };
}
