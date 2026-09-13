import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeImageBuffer } from "../../src/main/desk/frame";
import {
  assignProxySplits,
  ATTENTION_PROXY_PREFIX,
  DHASH_MAX_DISTANCE,
  groupNearDuplicates,
  hamming,
  imageDhash,
  isAttentionProxyRow,
  proxyAttention,
  proxyBucketFromPath,
  proxyCensus,
  proxyGroupKey,
  type ProxyGroup,
  type ProxyManifestEntry,
  buildProxyRow,
} from "./attention-proxies";
import { formatAttentionRow } from "./first-person";
import { attentionLabelsFile, cacheDir, dataRoot, parseCsv, readAttentionLabels } from "./lib";

/**
 * Fold the `desk-data-attention-proxies-hq` release into the attention
 * labels — 225 free-licensed stock photos, appended to
 * `datasets/desk-attention-labels.csv` in its EXACT existing schema.
 *
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/ingest-proxies.ts --dry-run
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/ingest-proxies.ts
 *
 * The images live in the pack, next to `train/` and `eval/`, under
 * `attention-proxies/<bucket>/`. They are NOT in the pack's `labels.json` —
 * like the webcam captures, they are read straight out of the CSV by
 * `extract-features.ts`, which is the smallest adapter that lets the existing
 * loader reach them without restructuring either the pack or the release.
 *
 * WHAT THIS DOES NOT DO. It never rewrites an existing row and never moves an
 * existing image between train and eval: the 1,919 Adaption rows come through
 * byte for byte, so every number measured before this ingest can still be
 * measured after it (`eval-attention.ts --labels <old csv>`).
 *
 * SPLIT. Near-duplicates are grouped with the same dHash rule the stock rows
 * use (8×8 hash, within 6 bits), the group id carries the bucket, and a group
 * that near-duplicates an image ALREADY in the CSV inherits that image's side
 * of the split. Everything else is dealt 2-in-5 to eval, bucket by bucket, so
 * this new distribution is genuinely measured rather than mostly fitted.
 */

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] !== undefined
    ? (process.argv[index + 1] as string)
    : fallback;
}

/** dHashes are pure functions of the pixels, so they are cached like features. */
function loadHashCache(file: string): Map<string, bigint> {
  if (!existsSync(file)) {
    return new Map();
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  return new Map(Object.entries(raw).map(([path, hex]) => [path, BigInt(`0x${hex}`)]));
}

function saveHashCache(file: string, hashes: Map<string, bigint>): void {
  const out: Record<string, string> = {};
  for (const [path, hash] of [...hashes.entries()].sort()) {
    out[path] = hash.toString(16);
  }
  writeFileSync(file, JSON.stringify(out));
}

function hashImages(
  root: string,
  paths: readonly string[],
  cache: Map<string, bigint>,
  label: string,
): Map<string, bigint> {
  const hashes = new Map<string, bigint>();
  let decoded = 0;
  for (const path of paths) {
    const cached = cache.get(path);
    if (cached !== undefined) {
      hashes.set(path, cached);
      continue;
    }
    const file = join(root, path);
    if (!existsSync(file)) {
      console.warn(`missing image, skipped: ${path}`);
      continue;
    }
    const hash = imageDhash(decodeImageBuffer(readFileSync(file)));
    hashes.set(path, hash);
    cache.set(path, hash);
    decoded += 1;
    if (decoded % 250 === 0) {
      console.log(`  ${label}: hashed ${decoded} new image(s)`);
    }
  }
  console.log(`${label}: ${hashes.size} hash(es) (${decoded} decoded now, ${hashes.size - decoded} cached)`);
  return hashes;
}

function readManifest(file: string): ProxyManifestEntry[] {
  const [header, ...rows] = parseCsv(readFileSync(file, "utf8"));
  const column = (name: string): number => {
    const index = header?.indexOf(name) ?? -1;
    if (index < 0) {
      throw new Error(`${file} has no ${name} column`);
    }
    return index;
  };
  const index = {
    path: column("path"),
    proxyType: column("proxy_type"),
    license: column("license"),
    credit: column("credit"),
    source: column("source"),
    suggestedLabel: column("suggested_label"),
    sha256: column("sha256"),
    query: column("query"),
  };
  return rows
    .filter((cells) => cells.length > 1 && (cells[index.path] ?? "").length > 0)
    .map((cells) => ({
      path: cells[index.path] as string,
      bucket: cells[index.proxyType] as string,
      license: cells[index.license] ?? "",
      credit: cells[index.credit] ?? "",
      source: cells[index.source] ?? "",
      suggestedLabel: cells[index.suggestedLabel] ?? "",
      sha256: cells[index.sha256] ?? "",
      query: cells[index.query] ?? "",
    }));
}

function main(): void {
  const root = dataRoot();
  const manifestFile = stringArg("--manifest", join(root, "attention-proxies", "manifest.csv"));
  const labelsFile = stringArg("--labels", attentionLabelsFile());
  const provenanceFile = stringArg(
    "--provenance",
    join(repoRoot(), "datasets", "desk-attention-proxies.csv"),
  );
  const dryRun = process.argv.includes("--dry-run");

  const manifest = readManifest(manifestFile);
  console.log(`manifest: ${manifest.length} proxy image(s) from ${manifestFile}`);
  for (const entry of manifest) {
    // Fails loudly on an unmapped bucket rather than inventing a label, and
    // on a path that would not be recognised as a proxy row later.
    proxyAttention(entry.bucket);
    if (!entry.path.startsWith(`${ATTENTION_PROXY_PREFIX}${entry.bucket}/`)) {
      throw new Error(
        `manifest path ${entry.path} is not under ${ATTENTION_PROXY_PREFIX}${entry.bucket}/ — the bucket is read back out of the path, so the two must agree`,
      );
    }
  }

  const existing = readAttentionLabels(labelsFile);
  const known = new Set(existing.map((row) => row.path));
  const pending = manifest.filter((entry) => !known.has(entry.path));
  console.log(
    `labels file: ${existing.length} row(s), ${existing.filter(isAttentionProxyRow).length} already proxies — ${pending.length} to append`,
  );
  if (pending.length === 0) {
    console.log("nothing to do: every manifest path is already in the labels file");
    return;
  }

  const cacheFile = join(cacheDir(), "dhash-v1.json");
  const cache = loadHashCache(cacheFile);
  // Every stock row already in the CSV, so a new photo that duplicates one of
  // them lands on the same side of the split as the image it duplicates.
  const existingHashes = hashImages(
    root,
    existing.filter((row) => !isAttentionProxyRow(row)).map((row) => row.path),
    cache,
    "existing images",
  );
  const proxyHashes = hashImages(root, pending.map((entry) => entry.path), cache, "proxy images");
  if (!dryRun) {
    saveHashCache(cacheFile, cache);
  }

  const usable = pending.filter((entry) => proxyHashes.has(entry.path));
  const representatives = groupNearDuplicates(
    usable.map((entry) => proxyHashes.get(entry.path) as bigint),
    DHASH_MAX_DISTANCE,
  );
  const splitByPath = new Map(existing.map((row) => [row.path, row.split]));
  const members = new Map<number, ProxyManifestEntry[]>();
  usable.forEach((entry, index) => {
    const key = representatives[index] as number;
    const list = members.get(key) ?? [];
    list.push(entry);
    members.set(key, list);
  });

  let crossLinked = 0;
  const groups: ProxyGroup[] = [];
  for (const list of members.values()) {
    const paths = list.map((entry) => entry.path).sort();
    const buckets = [...new Set(list.map((entry) => entry.bucket))].sort();
    if (buckets.length > 1) {
      // Two buckets holding the same photograph is a fact about the release,
      // not something to paper over: the group still shares one split, and the
      // key names every bucket in it so the CSV shows what happened.
      console.warn(`near-duplicate group spans buckets ${buckets.join("+")}: ${paths.join(", ")}`);
    }
    let locked: "train" | "eval" | null = null;
    for (const path of paths) {
      const hash = proxyHashes.get(path) as bigint;
      for (const [otherPath, otherHash] of existingHashes) {
        if (hamming(hash, otherHash) <= DHASH_MAX_DISTANCE) {
          const split = splitByPath.get(otherPath);
          crossLinked += 1;
          console.log(`  ${path} near-duplicates ${otherPath} (${split}) — inheriting that split`);
          locked = split === "eval" || locked === "eval" ? "eval" : "train";
        }
      }
    }
    groups.push({ key: proxyGroupKey(buckets.join("+"), paths), bucket: buckets[0] as string, paths, lockedSplit: locked });
  }

  const splits = assignProxySplits(groups);
  const byPath = new Map<string, { group: string; split: "train" | "eval" }>();
  for (const group of groups) {
    const split = splits.get(group.key) as "train" | "eval";
    for (const path of group.paths) {
      byPath.set(path, { group: group.key, split });
    }
  }

  const rows = usable.map((entry) => {
    const placement = byPath.get(entry.path) as { group: string; split: "train" | "eval" };
    return buildProxyRow(entry, placement.group, placement.split);
  });

  const census = proxyCensus(rows);
  console.log(
    `\n${census.images} image(s) in ${census.groups} near-duplicate group(s); ${crossLinked} cross-link(s) to images already in the file`,
  );
  console.log("bucket                 images groups  train  eval  attention");
  for (const bucket of Object.keys(census.byBucket).sort()) {
    const stats = census.byBucket[bucket] as { images: number; groups: number; train: number; eval: number };
    const attention = proxyAttention(bucket);
    console.log(
      `  ${bucket.padEnd(20)} ${String(stats.images).padStart(5)} ${String(stats.groups).padStart(6)} ${String(stats.train).padStart(6)} ${String(stats.eval).padStart(5)}  ${attention === "" ? "(no label)" : attention}`,
    );
  }
  for (const label of Object.keys(census.byAttention).sort()) {
    const stats = census.byAttention[label] as { train: number; eval: number };
    console.log(`  ${label.padEnd(20)} train ${stats.train}, eval ${stats.eval}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written");
    console.log(rows.slice(0, 3).map(formatAttentionRow).join("\n"));
    return;
  }

  const text = readFileSync(labelsFile, "utf8");
  const prefix = text.endsWith("\n") ? "" : "\n";
  appendFileSync(labelsFile, `${prefix}${rows.map(formatAttentionRow).join("\n")}\n`);
  console.log(`\nappended ${rows.length} row(s) -> ${labelsFile}`);

  // The credits have to survive into the repo: the CSV's ten columns have no
  // licence field, so the release's manifest is committed next to the labels.
  copyFileSync(manifestFile, provenanceFile);
  console.log(`provenance -> ${provenanceFile}`);

  const missingBucket = rows.filter((row) => proxyBucketFromPath(row.path) === null);
  if (missingBucket.length > 0) {
    throw new Error(`${missingBucket.length} appended row(s) have no readable bucket in their path`);
  }
}

main();
