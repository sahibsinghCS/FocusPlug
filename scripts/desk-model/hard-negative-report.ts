import { join } from "node:path";
import {
  ATTENTION_HEAD_LABELS,
  attentionHeadPredict,
  loadDeskHeadWeights,
} from "../../src/main/desk/model/your-model";
import { deskRoot } from "../../src/main/desk/assets";
import { isAttentionProxyRow, proxyBucketFromPath } from "./attention-proxies";
import { dedupeByPath, isFirstPersonRow } from "./first-person";
import { attentionLabelsFile, readAttentionLabels, readFeatureRows } from "./lib";

/**
 * Did the hard negatives actually stop the false `phone` calls?
 *
 * The `hard_negative_down` bucket is 49 photos of somebody looking DOWN at a
 * notebook, a keyboard or a calculator — the exact input a head that learned
 * `phone` from phone product shots over-calls. A false `phone` is not a silent
 * error at runtime: `NudgeTracker` fires after two of them in a row and the
 * app pulls its window to the front and switches the lamp on, at somebody who
 * was working.
 *
 * So the question this script answers is narrower than accuracy: on the SAME
 * held-out images, how many non-phone photos does each head call `phone`?
 * Two heads, one image set, one number per bucket.
 *
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/hard-negative-report.ts \
 *     --before /tmp/attention-head-before.json \
 *     --after  src/main/desk/model/weights/attention-head.json
 *
 * The "before" head never saw a proxy image, so every proxy eval row is
 * genuinely held out for BOTH heads and the comparison is fair.
 */

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}

interface Row {
  slice: string;
  truth: string;
  vector: number[];
}

interface Tally {
  images: number;
  /** Truth is not `phone`, and the head said `phone` anyway. */
  falsePhone: number;
  /** Truth is `phone` and the head said so. */
  truePhone: number;
  phoneTruth: number;
  correct: number;
  /** What the head actually said, per class — a bucket's whole answer. */
  predicted: Record<string, number>;
}

function tally(rows: readonly Row[], predict: (vector: number[]) => string): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const row of rows) {
    const stats = out.get(row.slice) ?? {
      images: 0,
      falsePhone: 0,
      truePhone: 0,
      phoneTruth: 0,
      correct: 0,
      predicted: {},
    };
    const predicted = predict(row.vector);
    stats.predicted[predicted] = (stats.predicted[predicted] ?? 0) + 1;
    stats.images += 1;
    if (row.truth === "phone") {
      stats.phoneTruth += 1;
      if (predicted === "phone") {
        stats.truePhone += 1;
      }
    } else if (predicted === "phone") {
      stats.falsePhone += 1;
    }
    if (predicted === row.truth) {
      stats.correct += 1;
    }
    out.set(row.slice, stats);
  }
  return out;
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}

function main(): void {
  const labelsFile = stringArg("--labels", attentionLabelsFile());
  const afterFile = stringArg("--after", join(deskRoot(), "model", "weights", "attention-head.json"));
  const beforeFile = stringArg("--before", "");
  const after = loadDeskHeadWeights(afterFile, ATTENTION_HEAD_LABELS);
  const before = beforeFile ? loadDeskHeadWeights(beforeFile, ATTENTION_HEAD_LABELS) : null;
  if (!after) {
    throw new Error(`no attention head at ${afterFile}`);
  }
  if (beforeFile && !before) {
    throw new Error(`no attention head at ${beforeFile}`);
  }

  const features = new Map(
    readFeatureRows(undefined, { includeAttentionOnly: true }).map((row) => [row.path, row]),
  );
  const labels = [...ATTENTION_HEAD_LABELS] as string[];
  const rows: Row[] = [];
  for (const label of dedupeByPath(readAttentionLabels(labelsFile)).rows) {
    if (label.split !== "eval" || !labels.includes(label.attention)) {
      continue;
    }
    const feature = features.get(label.path);
    if (!feature) {
      continue;
    }
    const slice = isFirstPersonRow(label)
      ? "first-person webcam"
      : isAttentionProxyRow(label)
        ? `proxy · ${proxyBucketFromPath(label.path)}`
        : "stock · Adaption";
    rows.push({ slice, truth: label.attention, vector: feature.vector });
  }
  if (rows.length === 0) {
    throw new Error("no labelled eval rows with cached features");
  }

  const predictWith = (weights: NonNullable<typeof after>) => (vector: number[]) =>
    attentionHeadPredict(weights, vector).label as string;
  const afterTally = tally(rows, predictWith(after));
  const beforeTally = before ? tally(rows, predictWith(before)) : null;

  console.log(`false \`phone\` calls on held-out eval rows (${labelsFile})`);
  console.log(
    "A false phone call fires a nudge at somebody who was working, so this is the number the hard negatives exist to move.\n",
  );
  const header = beforeTally
    ? "slice                          images  non-phone  before  after   phone recall before → after"
    : "slice                          images  non-phone   phone-called   phone recall";
  console.log(header);
  for (const slice of [...afterTally.keys()].sort()) {
    const now = afterTally.get(slice) as Tally;
    const nonPhone = now.images - now.phoneTruth;
    const then = beforeTally?.get(slice);
    const recall = `${pct(now.truePhone, now.phoneTruth)}`;
    if (then) {
      console.log(
        `${slice.padEnd(30)} ${String(now.images).padStart(6)} ${String(nonPhone).padStart(10)} ` +
          `${`${then.falsePhone} (${pct(then.falsePhone, nonPhone)})`.padStart(13)} ` +
          `${`${now.falsePhone} (${pct(now.falsePhone, nonPhone)})`.padStart(13)}   ` +
          `${pct(then.truePhone, then.phoneTruth)} → ${recall}`,
      );
    } else {
      console.log(
        `${slice.padEnd(30)} ${String(now.images).padStart(6)} ${String(nonPhone).padStart(10)} ` +
          `${`${now.falsePhone} (${pct(now.falsePhone, nonPhone)})`.padStart(14)}   ${recall}`,
      );
    }
  }

  // What each head actually calls a bucket, not just how often it says phone.
  // A bucket the heads mostly call `unfocused` while the release labelled it
  // `focused` is a disagreement about the WORD, not a model error, and it is
  // the first thing to check before blaming (or crediting) the images.
  console.log(`\nwhat each head calls each slice (predictions, not truth)`);
  console.log(
    beforeTally
      ? "slice                          truth mix                    before → after"
      : "slice                          truth mix                    predictions",
  );
  const mix = (counts: Record<string, number>): string =>
    [...ATTENTION_HEAD_LABELS]
      .map((label) => `${label} ${counts[label] ?? 0}`)
      .join(", ");
  for (const slice of [...afterTally.keys()].sort()) {
    const now = afterTally.get(slice) as Tally;
    const truth = { phone: now.phoneTruth, other: now.images - now.phoneTruth };
    const then = beforeTally?.get(slice);
    console.log(
      `${slice.padEnd(30)} ${`${truth.phone} phone / ${truth.other} not`.padEnd(28)} ` +
        (then ? `${mix(then.predicted)}  →  ${mix(now.predicted)}` : mix(now.predicted)),
    );
  }

  const total = (t: Map<string, Tally>): Tally =>
    [...t.values()].reduce(
      (acc, one) => ({
        predicted: acc.predicted,
        images: acc.images + one.images,
        falsePhone: acc.falsePhone + one.falsePhone,
        truePhone: acc.truePhone + one.truePhone,
        phoneTruth: acc.phoneTruth + one.phoneTruth,
        correct: acc.correct + one.correct,
      }),
      { images: 0, falsePhone: 0, truePhone: 0, phoneTruth: 0, correct: 0, predicted: {} },
    );
  const now = total(afterTally);
  const nonPhone = now.images - now.phoneTruth;
  console.log(
    `\nall eval rows: ${now.images} images, ${nonPhone} of them not phone. ` +
      (beforeTally
        ? `false phone ${(total(beforeTally) as Tally).falsePhone} → ${now.falsePhone}, ` +
          `phone recall ${pct((total(beforeTally) as Tally).truePhone, now.phoneTruth)} → ${pct(now.truePhone, now.phoneTruth)}`
        : `false phone ${now.falsePhone} (${pct(now.falsePhone, nonPhone)}), phone recall ${pct(now.truePhone, now.phoneTruth)}`),
  );
  console.log(
    "Proxy rows are STOCK photographs standing in for the first-person case, not webcam frames of anyone using the app.",
  );
}

main();
