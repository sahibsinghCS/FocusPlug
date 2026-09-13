import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImageBuffer } from "../../src/main/desk/frame";
import { extractDeskFeatures } from "../../src/main/desk/model/your-model";
import {
  dataRoot,
  featureShardFile,
  featureShardFiles,
  loadPackLabels,
  mapLabel,
  type FeatureRow,
} from "./lib";

/**
 * One-time (cached, resumable) feature extraction over the desk-data pack.
 * Runs the EXACT runtime pipeline (`extractDeskFeatures` from your-model.ts):
 * decode → BlazeFace → scene features → feature vector, one JSONL row per
 * image. Shard for process-level parallelism:
 *
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/extract-features.ts --shard 0 --of 4
 */

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

  const mine = pack.items.filter((_, index) => index % of === shard);
  const pending = mine.filter((item) => !done.has(item.path));
  console.log(
    `[shard ${shard}/${of}] ${mine.length} items, ${done.size} cached, ${pending.length} to extract`,
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
        mapped: mapLabel(pack, item.label),
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
