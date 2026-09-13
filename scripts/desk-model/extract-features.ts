import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImageBuffer } from "../../src/main/desk/frame";
import { extractDeskFeatures } from "../../src/main/desk/model/your-model";
import {
  attentionLabelsFile,
  dataRoot,
  featureShardFile,
  featureShardFiles,
  loadPackLabels,
  mapLabel,
  readAttentionLabels,
  type FeatureRow,
  type PackItem,
} from "./lib";
import { FIRST_PERSON_BUCKET, isFirstPersonRow } from "./first-person";

/**
 * One-time (cached, resumable) feature extraction over the desk-data pack.
 * Runs the EXACT runtime pipeline (`extractDeskFeatures` from your-model.ts):
 * decode → BlazeFace → scene features → feature vector, one JSONL row per
 * image. The pool is `labels.json` plus any first-person webcam clips recorded
 * by capture-attention.ts. Shard for process-level parallelism:
 *
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/extract-features.ts --shard 0 --of 4
 */

/**
 * Webcam captures live inside the pack but not in its `labels.json`, so they
 * are read straight out of `datasets/desk-attention-labels.csv` (path prefix
 * `first-person/`). They carry `bucket: "first_person"`, which `readFeatureRows`
 * skips by default — the presence head never sees them.
 */
function firstPersonItems(): PackItem[] {
  const file = attentionLabelsFile();
  if (!existsSync(file)) {
    return [];
  }
  const seen = new Set<string>();
  const items: PackItem[] = [];
  for (const row of readAttentionLabels(file)) {
    if (!isFirstPersonRow(row) || seen.has(row.path)) {
      continue;
    }
    seen.add(row.path);
    items.push({
      path: row.path,
      // The declared clip label, kept verbatim; `mapped` is at_desk because
      // every capture is the user sitting at their own desk by construction.
      label: row.attention,
      split: row.split,
      bucket: FIRST_PERSON_BUCKET,
    });
  }
  return items;
}

function argValue(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index >= 0) {
    const parsed = Number(process.argv[index + 1]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

async function main(): Promise<void> {
  const shard = argValue("--shard", 0);
  const of = argValue("--of", 1);
  const pack = loadPackLabels();
  const root = dataRoot();
  const outFile = featureShardFile(shard, of);

  // Any shard's cache counts: a pack update can move items between shards, and
  // an image already extracted elsewhere must not be extracted again.
  const done = new Set<string>();
  for (const file of featureShardFiles()) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed) {
        done.add((JSON.parse(trimmed) as FeatureRow).path);
      }
    }
  }

  const captures = firstPersonItems();
  const items = [...pack.items, ...captures];
  const mine = items.filter((_, index) => index % of === shard);
  const pending = mine.filter((item) => !done.has(item.path));
  console.log(
    `[shard ${shard}/${of}] ${mine.length} items (${captures.length} first-person captures in the pool), ${done.size} cached, ${pending.length} to extract`,
  );

  let processed = 0;
  let skipped = 0;
  const startedAt = Date.now();
  for (const item of pending) {
    const file = join(root, item.path);
    if (!existsSync(file)) {
      skipped += 1;
      console.warn(`[shard ${shard}] missing file: ${item.path}`);
      continue;
    }
    try {
      const frame = decodeImageBuffer(readFileSync(file));
      const { vector, base } = await extractDeskFeatures(frame);
      const row: FeatureRow = {
        path: item.path,
        label: item.label,
        mapped: item.bucket === FIRST_PERSON_BUCKET ? "at_desk" : mapLabel(pack, item.label),
        split: item.split,
        bucket: item.bucket,
        vector,
        baseLabel: base.label,
        baseConfidence: base.confidence,
      };
      appendFileSync(outFile, `${JSON.stringify(row)}\n`);
    } catch (error) {
      skipped += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[shard ${shard}] failed ${item.path}: ${message}`);
    }
    processed += 1;
    if (processed % 25 === 0) {
      const rate = processed / ((Date.now() - startedAt) / 1000);
      console.log(
        `[shard ${shard}] ${processed}/${pending.length} (${rate.toFixed(1)}/s)`,
      );
    }
  }
  console.log(`[shard ${shard}] done: ${processed - skipped} extracted, ${skipped} skipped`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
