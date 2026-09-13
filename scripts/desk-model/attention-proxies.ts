import { createHash } from "node:crypto";
import type { AttentionLabelRow } from "./lib";

/**
 * Stock ATTENTION PROXIES: the `desk-data-attention-proxies-hq` release, 225
 * free-licensed photos chosen to cover what the attention head keeps getting
 * wrong.
 *
 * WHAT THEY ARE. Free-license stock photographs — Pexels, plus one public
 * domain Wikimedia image — sorted into six buckets by the query that found
 * them. They are **proxies, not first-person webcam frames**: nobody sat at
 * their own laptop and recorded these, so they narrow the domain gap the same
 * way the rest of the stock pack does (a bit) and no further. Every claim
 * about them in docs/CUSTOM-MODEL.md has to keep saying so.
 *
 * WHY THEY EXIST. `hard_negative_down` is the point of the release: 49 photos
 * of people looking DOWN at a notebook, a keyboard or a calculator and not at
 * a phone. The head learned `phone` mostly from phone product shots, so a
 * tilted-down head is exactly the input it over-calls — and a false `phone`
 * is not a silent error at runtime, it fires a nudge (window to the front,
 * lamp on) at somebody who was working.
 *
 * LABELS ARE BUCKET-LEVEL, NOT ANNOTATIONS. The pack's `suggested_label` is in
 * the PRESENCE vocabulary (at_desk / distracted / uncertain), so it cannot be
 * copied into the `attention` column. `PROXY_BUCKET_ATTENTION` maps bucket →
 * attention class instead, and the four annotation columns are DERIVED from
 * that mapping — the same honesty rule capture-attention.ts follows for
 * self-labelled clips, and the row's `note` says it out loud. Nothing here is
 * an Adaption annotation and nothing here was checked image by image.
 *
 * ONE BUCKET IS NOT ONE GROUP. Near-duplicates are found with the same dHash
 * rule adaption-label.py uses (8×8, within 6 bits) so the split can never cut
 * a duplicate pair in half, and the group key carries the BUCKET so two
 * groups from different queries can never collide on one id.
 */

/** Every proxy path starts here; it is what marks a row as a stock proxy. */
export const ATTENTION_PROXY_PREFIX = "attention-proxies/";
/** `bucket` on the cached feature rows, so the presence head can skip them. */
export const ATTENTION_PROXY_BUCKET = "attention_proxy";

/**
 * Bucket → attention class. `""` means the row is kept for the record but is
 * not a usable example, exactly as the Adaption rows use it.
 *
 * `posture_focus` ("lean back, chin in hand, glance aside while at the desk")
 * is mapped to `focused` because the release collected it as still-working
 * posture. That is a judgement about a whole bucket, not about each photo, and
 * some of those frames would read as `unfocused` to a person. It is the
 * loosest label in here and the docs say so.
 */
export const PROXY_BUCKET_ATTENTION: Readonly<Record<string, string>> = {
  hard_negative_down: "focused",
  webcam_angle: "focused",
  lighting: "focused",
  posture_focus: "focused",
  phone_low: "phone",
  uncertain: "",
};

/** The bucket the whole release exists for: head down, no phone. */
export const HARD_NEGATIVE_BUCKET = "hard_negative_down";

export function isAttentionProxyPath(path: string): boolean {
  return path.startsWith(ATTENTION_PROXY_PREFIX);
}

export function isAttentionProxyRow(row: { path: string }): boolean {
  return isAttentionProxyPath(row.path);
}

/**
 * `attention-proxies/hard_negative_down/x.jpg` → `hard_negative_down`.
 * Reading the bucket back out of the path means the eval and the diagnostics
 * never need a second source of truth for it.
 */
export function proxyBucketFromPath(path: string): string | null {
  if (!isAttentionProxyPath(path)) {
    return null;
  }
  const rest = path.slice(ATTENTION_PROXY_PREFIX.length);
  const slash = rest.indexOf("/");
  return slash > 0 ? rest.slice(0, slash) : null;
}

/**
 * An unknown bucket is a hard error, never a default label: a later release
 * that adds a bucket must be mapped deliberately, not folded into `focused`
 * because that is what four of the six happen to be.
 */
export function proxyAttention(bucket: string): string {
  const mapped = PROXY_BUCKET_ATTENTION[bucket];
  if (mapped === undefined) {
    throw new Error(
      `unknown attention-proxy bucket ${JSON.stringify(bucket)} — map it in PROXY_BUCKET_ATTENTION ` +
        `(known: ${Object.keys(PROXY_BUCKET_ATTENTION).join(", ")}). Guessing a label for a bucket nobody mapped is how a hard negative becomes a phone photo.`,
    );
  }
  return mapped;
}

/* ── near-duplicate detection: the same rule the stock rows already use ── */

/** dHash side. 8 → a 64-bit hash from a 9×8 grayscale reduction. */
export const DHASH_SIDE = 8;
/** adaption-label.py's threshold, kept identical so one rule governs the file. */
export const DHASH_MAX_DISTANCE = 6;

export interface GrayImage {
  width: number;
  height: number;
  /** Row-major luma, 0..255. */
  data: Float64Array;
}

/**
 * Area-average downscale to `width`×`height` luma. PIL's LANCZOS (what
 * adaption-label.py used) is not reproducible here without a new dependency;
 * a box filter finds the same near-duplicates for this purpose and, more
 * importantly, is applied to BOTH sides of every comparison in this file, so
 * old and new images are always hashed the same way.
 */
export function grayscaleBox(
  frame: { width: number; height: number; data: ArrayLike<number> },
  width: number,
  height: number,
): GrayImage {
  const out = new Float64Array(width * height);
  const counts = new Float64Array(width * height);
  for (let y = 0; y < frame.height; y += 1) {
    const ty = Math.min(height - 1, Math.floor((y * height) / frame.height));
    for (let x = 0; x < frame.width; x += 1) {
      const tx = Math.min(width - 1, Math.floor((x * width) / frame.width));
      const i = (y * frame.width + x) * 3;
      const luma =
        0.299 * (frame.data[i] ?? 0) + 0.587 * (frame.data[i + 1] ?? 0) + 0.114 * (frame.data[i + 2] ?? 0);
      const t = ty * width + tx;
      out[t] = (out[t] ?? 0) + luma;
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  for (let i = 0; i < out.length; i += 1) {
    const n = counts[i] ?? 0;
    out[i] = n > 0 ? (out[i] ?? 0) / n : 0;
  }
  return { width, height, data: out };
}

/** Row-wise "is this pixel brighter than the next" — 64 bits for side 8. */
export function dhashBits(gray: GrayImage): bigint {
  let bits = 0n;
  for (let row = 0; row < gray.height; row += 1) {
    for (let col = 0; col + 1 < gray.width; col += 1) {
      const a = gray.data[row * gray.width + col] ?? 0;
      const b = gray.data[row * gray.width + col + 1] ?? 0;
      bits = (bits << 1n) | (a > b ? 1n : 0n);
    }
  }
  return bits;
}

export function imageDhash(
  frame: { width: number; height: number; data: ArrayLike<number> },
  side: number = DHASH_SIDE,
): bigint {
  return dhashBits(grayscaleBox(frame, side + 1, side));
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * Union-find over dHash distance, exactly as adaption-label.py's export does.
 * Returns the representative index of each item's group.
 */
export function groupNearDuplicates(
  hashes: readonly bigint[],
  maxDistance: number = DHASH_MAX_DISTANCE,
): number[] {
  const parent = hashes.map((_, index) => index);
  const find = (i: number): number => {
    let node = i;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node] as number] as number;
      node = parent[node] as number;
    }
    return node;
  };
  for (let a = 0; a < hashes.length; a += 1) {
    for (let b = a + 1; b < hashes.length; b += 1) {
      if (hamming(hashes[a] as bigint, hashes[b] as bigint) <= maxDistance) {
        parent[find(a)] = find(b);
      }
    }
  }
  return hashes.map((_, index) => find(index));
}

/* ── groups, and the split they land on ─────────────────────────────── */

export interface ProxyGroup {
  key: string;
  bucket: string;
  /** Pack-relative paths, sorted. */
  paths: string[];
  /**
   * Set when some member is a near-duplicate of an image ALREADY in the CSV:
   * the new photo then inherits that image's side of the split, so a proxy can
   * never end up training on a copy of an existing eval image (or vice versa).
   */
  lockedSplit: "train" | "eval" | null;
}

/**
 * The group id carries the bucket, so a group is self-describing in the CSV
 * and two groups found by different queries can never share an id. The suffix
 * is a hash of the member paths, so it is stable across runs and independent
 * of the order the manifest happens to list.
 */
export function proxyGroupKey(bucket: string, paths: readonly string[]): string {
  const digest = createHash("sha256").update([...paths].sort().join("\n")).digest("hex");
  return `apx_${bucket}_${digest.slice(0, 12)}`;
}

/**
 * Two of every five groups go to eval, dealt bucket by bucket in sorted key
 * order so every bucket lands on both sides and the whole assignment is a
 * pure function of the manifest.
 *
 * WHY SO MUCH. These 225 photos are a NEW distribution; a token eval share
 * would let the head fit them and report a number that mostly measured the
 * old images. 2-in-5 is close to the release's own shape and leaves the
 * existing eval rows untouched, so the pre-existing splits stay comparable.
 */
export const PROXY_EVAL_EVERY = 5;
export const PROXY_EVAL_WITHIN = 2;

export function assignProxySplits(
  groups: readonly ProxyGroup[],
  evalEvery: number = PROXY_EVAL_EVERY,
  evalWithin: number = PROXY_EVAL_WITHIN,
): Map<string, "train" | "eval"> {
  const byBucket = new Map<string, ProxyGroup[]>();
  for (const group of groups) {
    const list = byBucket.get(group.bucket) ?? [];
    list.push(group);
    byBucket.set(group.bucket, list);
  }
  const splits = new Map<string, "train" | "eval">();
  for (const bucket of [...byBucket.keys()].sort()) {
    const sorted = [...(byBucket.get(bucket) as ProxyGroup[])].sort((a, b) => a.key.localeCompare(b.key));
    let free = 0;
    for (const group of sorted) {
      if (group.lockedSplit !== null) {
        // A near-duplicate of an existing image follows that image; it is not
        // free to be dealt, and it does not consume a slot in the rotation.
        splits.set(group.key, group.lockedSplit);
        continue;
      }
      splits.set(group.key, free % evalEvery < evalWithin ? "eval" : "train");
      free += 1;
    }
  }
  return splits;
}

/* ── the CSV row, in the exact existing schema ──────────────────────── */

export interface ProxyManifestEntry {
  path: string;
  bucket: string;
  license: string;
  credit: string;
  source: string;
  /** The release's own label, in the PRESENCE vocabulary. */
  suggestedLabel: string;
  sha256: string;
  query: string;
}

export const PROXY_NOTE_PREFIX = "stock proxy";

/**
 * The note is where the provenance lives: the schema has ten columns and none
 * of them is a licence field, and these photos may not be used without their
 * credit. Every row therefore carries its own licence, photographer and source
 * URL, and says that the label came from the bucket rather than from anyone
 * looking at the image.
 */
export function proxyNote(entry: ProxyManifestEntry): string {
  return (
    `${PROXY_NOTE_PREFIX} (${entry.bucket}), not first-person webcam; ` +
    `label derived from the bucket, not annotated; ` +
    `${entry.license}; ${entry.credit}; ${entry.source}`
  );
}

/**
 * `person` / `workspace` / `phone` / `gaze` are DERIVED from the bucket, like
 * the capture tool derives them from a declared clip label. They are not
 * observations, which is why the note says so; the eval only reads
 * `workspace`, and the trainer only reads `attention`.
 */
export function buildProxyRow(
  entry: ProxyManifestEntry,
  group: string,
  split: "train" | "eval",
): AttentionLabelRow {
  const attention = proxyAttention(entry.bucket);
  return {
    path: entry.path,
    split,
    group,
    attention,
    person: "face_or_body",
    workspace: "True",
    phone: attention === "phone" ? "in_use" : "none",
    gaze: attention === "phone" ? "phone" : attention === "" ? "unclear" : "work",
    note: proxyNote(entry),
    // The release's own label is a pack-vocabulary label, so it belongs in the
    // column that holds pack labels — which is also what keeps the eval's
    // "pack label `distracted` as a phone detector" baseline meaningful here.
    packLabel: entry.suggestedLabel,
  };
}

export interface ProxyCensus {
  images: number;
  groups: number;
  byBucket: Record<string, { images: number; groups: number; train: number; eval: number }>;
  byAttention: Record<string, { train: number; eval: number }>;
}

export function proxyCensus(
  rows: ReadonlyArray<{ path: string; group: string; split: string; attention: string }>,
): ProxyCensus {
  const byBucket: ProxyCensus["byBucket"] = {};
  const byAttention: ProxyCensus["byAttention"] = {};
  const groups = new Set<string>();
  const groupsPerBucket = new Map<string, Set<string>>();
  for (const row of rows) {
    const bucket = proxyBucketFromPath(row.path) ?? "unknown";
    const bucketStats = (byBucket[bucket] ??= { images: 0, groups: 0, train: 0, eval: 0 });
    bucketStats.images += 1;
    if (row.split === "eval") {
      bucketStats.eval += 1;
    } else {
      bucketStats.train += 1;
    }
    const attention = row.attention === "" ? "(no label)" : row.attention;
    const attentionStats = (byAttention[attention] ??= { train: 0, eval: 0 });
    if (row.split === "eval") {
      attentionStats.eval += 1;
    } else {
      attentionStats.train += 1;
    }
    groups.add(row.group);
    const seen = groupsPerBucket.get(bucket) ?? new Set<string>();
    seen.add(row.group);
    groupsPerBucket.set(bucket, seen);
  }
  for (const [bucket, seen] of groupsPerBucket) {
    const stats = byBucket[bucket];
    if (stats) {
      stats.groups = seen.size;
    }
  }
  return { images: rows.length, groups: groups.size, byBucket, byAttention };
}
