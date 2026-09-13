import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ATTENTION_HEAD_LABELS } from "../../src/main/desk/model/your-model";
import {
  ATTENTION_PROXY_BUCKET,
  ATTENTION_PROXY_PREFIX,
  assignProxySplits,
  buildProxyRow,
  DHASH_MAX_DISTANCE,
  groupNearDuplicates,
  HARD_NEGATIVE_BUCKET,
  hamming,
  imageDhash,
  isAttentionProxyRow,
  PROXY_BUCKET_ATTENTION,
  PROXY_EVAL_EVERY,
  PROXY_EVAL_WITHIN,
  proxyAttention,
  proxyBucketFromPath,
  proxyCensus,
  proxyGroupKey,
  proxyNote,
  type ProxyGroup,
  type ProxyManifestEntry,
} from "./attention-proxies";
import { ATTENTION_CSV_COLUMNS, attentionRowCells, isFirstPersonRow } from "./first-person";
import { ATTENTION_ONLY_BUCKETS, parseCsv, readAttentionLabels } from "./lib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");

const entry = (over: Partial<ProxyManifestEntry> = {}): ProxyManifestEntry => ({
  path: `${ATTENTION_PROXY_PREFIX}hard_negative_down/hard_negative_down_p1.jpg`,
  bucket: HARD_NEGATIVE_BUCKET,
  license: "Pexels",
  credit: "A Photographer / Pexels",
  source: "https://www.pexels.com/photo/1/",
  suggestedLabel: "at_desk",
  sha256: "abc",
  query: "student writing notebook desk looking down",
  ...over,
});

/** A flat frame with one bright square, so two frames can differ a little. */
function frame(width: number, height: number, paint: (x: number, y: number) => number) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = paint(x, y);
      const i = (y * width + x) * 3;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
  }
  return { width, height, data };
}

describe("bucket → attention label", () => {
  it("maps the release's six buckets, and hard negatives are never phone", () => {
    expect(PROXY_BUCKET_ATTENTION).toEqual({
      hard_negative_down: "focused",
      webcam_angle: "focused",
      lighting: "focused",
      posture_focus: "focused",
      phone_low: "phone",
      uncertain: "",
    });
    // The whole point of the 49 hard negatives: head down over a notebook is
    // a person WORKING, and calling it `phone` fires a nudge at them.
    expect(proxyAttention(HARD_NEGATIVE_BUCKET)).toBe("focused");
    expect(proxyAttention("phone_low")).toBe("phone");
  });

  it("every non-empty mapping is a real attention class", () => {
    for (const label of Object.values(PROXY_BUCKET_ATTENTION)) {
      if (label !== "") {
        expect(ATTENTION_HEAD_LABELS).toContain(label);
      }
    }
  });

  it("`uncertain` is the empty label the CSV already uses, not a fourth class", () => {
    // The head has three classes; the CSV spells "not a usable example" as an
    // empty `attention` cell, and both the trainer and the eval filter on that.
    expect(proxyAttention("uncertain")).toBe("");
    expect(ATTENTION_HEAD_LABELS).not.toContain("uncertain" as never);
  });

  it("refuses to guess a label for a bucket nobody mapped", () => {
    expect(() => proxyAttention("phone_in_hand")).toThrow(/unknown attention-proxy bucket/);
  });

  it("reads the bucket back out of the path", () => {
    expect(proxyBucketFromPath(`${ATTENTION_PROXY_PREFIX}phone_low/a.jpg`)).toBe("phone_low");
    expect(proxyBucketFromPath("train/at_desk/a.jpg")).toBeNull();
    expect(isAttentionProxyRow({ path: `${ATTENTION_PROXY_PREFIX}lighting/a.jpg` })).toBe(true);
  });

  it("a proxy row is stock, not first-person — the eval must score it in the stock slice", () => {
    const row = { path: `${ATTENTION_PROXY_PREFIX}webcam_angle/a.jpg` };
    expect(isFirstPersonRow(row)).toBe(false);
    expect(isAttentionProxyRow(row)).toBe(true);
  });

  it("the presence head skips both attention-only buckets", () => {
    expect([...ATTENTION_ONLY_BUCKETS].sort()).toEqual([ATTENTION_PROXY_BUCKET, "first_person"]);
  });
});

describe("near-duplicate grouping", () => {
  it("hashes the same picture to the same bits at any size", () => {
    const paint = (x: number, y: number): number => (x * 7 + y * 13) % 251;
    expect(imageDhash(frame(64, 48, paint))).toBe(imageDhash(frame(64, 48, paint)));
    expect(hamming(imageDhash(frame(64, 48, paint)), imageDhash(frame(64, 48, paint)))).toBe(0);
  });

  it("a slightly brightened copy stays inside the 6-bit rule, a different scene does not", () => {
    const base = frame(64, 48, (x, y) => (x * 7 + y * 13) % 251);
    const brighter = frame(64, 48, (x, y) => Math.min(255, ((x * 7 + y * 13) % 251) + 4));
    const other = frame(64, 48, (x, y) => (x * 31 + y * 3) % 197);
    expect(hamming(imageDhash(base), imageDhash(brighter))).toBeLessThanOrEqual(DHASH_MAX_DISTANCE);
    expect(hamming(imageDhash(base), imageDhash(other))).toBeGreaterThan(DHASH_MAX_DISTANCE);
  });

  it("unions transitively, like adaption-label.py's export", () => {
    const reps = groupNearDuplicates([0b0000n, 0b0001n, 0b0011n, 0xffffffffffffffffn], 1);
    expect(reps[0]).toBe(reps[1]);
    expect(reps[1]).toBe(reps[2]);
    expect(reps[3]).not.toBe(reps[0]);
  });

  it("the group key carries the bucket and is a pure function of its members", () => {
    const key = proxyGroupKey(HARD_NEGATIVE_BUCKET, ["b.jpg", "a.jpg"]);
    expect(key).toBe(proxyGroupKey(HARD_NEGATIVE_BUCKET, ["a.jpg", "b.jpg"]));
    expect(key.startsWith(`apx_${HARD_NEGATIVE_BUCKET}_`)).toBe(true);
    // Same photos, different bucket → a different id. Two buckets can never
    // collide on one group, so a split can never be decided for the wrong one.
    expect(proxyGroupKey("phone_low", ["a.jpg"])).not.toBe(proxyGroupKey("lighting", ["a.jpg"]));
  });
});

describe("the split", () => {
  const groups = (bucket: string, count: number, locked: Array<"train" | "eval" | null> = []): ProxyGroup[] =>
    Array.from({ length: count }, (_, index) => ({
      key: `apx_${bucket}_${String(index).padStart(4, "0")}`,
      bucket,
      paths: [`${ATTENTION_PROXY_PREFIX}${bucket}/${index}.jpg`],
      lockedSplit: locked[index] ?? null,
    }));

  it("deals a real share of a new distribution to eval, bucket by bucket", () => {
    const splits = assignProxySplits([...groups("hard_negative_down", 10), ...groups("phone_low", 10)]);
    const evals = [...splits.values()].filter((split) => split === "eval").length;
    expect(evals).toBe(2 * Math.round((10 * PROXY_EVAL_WITHIN) / PROXY_EVAL_EVERY));
    for (const bucket of ["hard_negative_down", "phone_low"]) {
      const mine = [...splits.entries()].filter(([key]) => key.includes(bucket));
      expect(mine.filter(([, split]) => split === "eval").length).toBeGreaterThan(0);
      expect(mine.filter(([, split]) => split === "train").length).toBeGreaterThan(0);
    }
  });

  it("is deterministic — the same manifest deals the same split every run", () => {
    const input = groups("lighting", 7);
    expect([...assignProxySplits(input)]).toEqual([...assignProxySplits([...input].reverse())]);
  });

  it("a near-duplicate of an image already in the file follows that image", () => {
    const locked: Array<"train" | "eval" | null> = ["eval", null, null, "train", null];
    const splits = assignProxySplits(groups("phone_low", 5, locked));
    expect(splits.get("apx_phone_low_0000")).toBe("eval");
    expect(splits.get("apx_phone_low_0003")).toBe("train");
  });
});

describe("the CSV row", () => {
  it("is the exact existing schema — no new columns", () => {
    const row = buildProxyRow(entry(), "apx_hard_negative_down_deadbeef", "train");
    expect(attentionRowCells(row)).toHaveLength(ATTENTION_CSV_COLUMNS.length);
  });

  it("carries licence, credit and source, because the images are only free WITH them", () => {
    const note = proxyNote(entry());
    expect(note).toContain("Pexels");
    expect(note).toContain("A Photographer / Pexels");
    expect(note).toContain("https://www.pexels.com/photo/1/");
  });

  it("says the label came from the bucket and that this is not first-person", () => {
    const note = proxyNote(entry());
    expect(note).toContain("label derived from the bucket, not annotated");
    expect(note).toContain("not first-person webcam");
  });

  it("pack_label keeps the release's own presence-vocabulary label", () => {
    // `distracted` here is what the eval's pack-label baseline reads, and it
    // is the release's word, not ours.
    const row = buildProxyRow(entry({ bucket: "phone_low", suggestedLabel: "distracted" }), "g", "eval");
    expect(row.packLabel).toBe("distracted");
    expect(row.attention).toBe("phone");
    expect(row.phone).toBe("in_use");
    expect(row.gaze).toBe("phone");
  });

  it("an uncertain proxy is recorded but unlabelled, so nothing trains or scores on it", () => {
    const row = buildProxyRow(entry({ bucket: "uncertain", suggestedLabel: "uncertain" }), "g", "eval");
    expect(row.attention).toBe("");
    expect(row.gaze).toBe("unclear");
  });

  it("counts images, groups and splits per bucket", () => {
    const census = proxyCensus([
      { path: `${ATTENTION_PROXY_PREFIX}phone_low/a.jpg`, group: "g1", split: "train", attention: "phone" },
      { path: `${ATTENTION_PROXY_PREFIX}phone_low/b.jpg`, group: "g1", split: "train", attention: "phone" },
      { path: `${ATTENTION_PROXY_PREFIX}lighting/c.jpg`, group: "g2", split: "eval", attention: "focused" },
    ]);
    expect(census.images).toBe(3);
    expect(census.groups).toBe(2);
    expect(census.byBucket.phone_low).toEqual({ images: 2, groups: 1, train: 2, eval: 0 });
    expect(census.byAttention.focused).toEqual({ train: 0, eval: 1 });
  });
});

/**
 * The committed file itself. These are the invariants that make the new rows
 * safe to train on: one path one row, one group one split, and a credit for
 * every image that needs one.
 */
describe("datasets/desk-attention-labels.csv, as committed", () => {
  const rows = readAttentionLabels();
  const proxies = rows.filter(isAttentionProxyRow);

  it("holds the proxy release, and every proxy row is a stock row", () => {
    expect(proxies.length).toBeGreaterThan(0);
    for (const row of proxies) {
      expect(isFirstPersonRow(row)).toBe(false);
    }
  });

  it("labels every proxy row from its own bucket", () => {
    for (const row of proxies) {
      const bucket = proxyBucketFromPath(row.path);
      expect(bucket).not.toBeNull();
      expect(row.attention).toBe(proxyAttention(bucket as string));
    }
  });

  it("puts the bucket in the group id and keeps every group on one split", () => {
    const splits = new Map<string, string>();
    for (const row of proxies) {
      expect(row.group).toContain(proxyBucketFromPath(row.path) as string);
      const seen = splits.get(row.group);
      expect(seen === undefined || seen === row.split).toBe(true);
      splits.set(row.group, row.split);
    }
  });

  it("keeps a real share of the new distribution held out", () => {
    const scored = proxies.filter((row) => row.attention !== "");
    const held = scored.filter((row) => row.split === "eval");
    expect(held.length / scored.length).toBeGreaterThan(0.25);
    // Both classes the buckets produce are held out, or the eval would only
    // measure one of them.
    expect(held.some((row) => row.attention === "phone")).toBe(true);
    expect(held.some((row) => row.attention === "focused")).toBe(true);
  });

  it("never moves an existing image: the 1,919 Adaption rows keep their split", () => {
    // The proxies were APPENDED. Anything else would silently rewrite the eval
    // set the old numbers were measured on.
    const stock = rows.filter((row) => !isAttentionProxyRow(row) && !isFirstPersonRow(row));
    expect(stock).toHaveLength(1919);
    expect(stock.filter((row) => row.split === "eval" && row.attention !== "")).toHaveLength(200);
  });

  it("credits every proxy image, in the row and in the committed manifest", () => {
    const manifest = parseCsv(readFileSync(join(repoRoot, "datasets", "desk-attention-proxies.csv"), "utf8"));
    const header = manifest[0] as string[];
    const credited = new Map(
      manifest
        .slice(1)
        .filter((cells) => cells.length > 1)
        .map((cells) => [cells[header.indexOf("path")] as string, cells[header.indexOf("credit")] as string]),
    );
    for (const row of proxies) {
      const credit = credited.get(row.path);
      expect(credit, `no credit for ${row.path}`).toBeTruthy();
      expect(row.note).toContain(credit as string);
      expect(row.note).toContain("not first-person webcam");
    }
  });
});

describe("the docs keep calling them proxies", () => {
  const doc = readFileSync(join(repoRoot, "docs", "CUSTOM-MODEL.md"), "utf8").replace(/\s+/g, " ");

  it("never sells stock photos as first-person webcam frames", () => {
    expect(doc).toContain("stock proxies");
    expect(doc).toContain("not first-person");
  });

  it("still says what the head may be claimed for", () => {
    expect(doc).toContain("Claim the pipeline, not phone detection");
  });

  it("keeps the losing result and the baseline that beats the head", () => {
    // The proxies cost 8 points on the Adaption eval and did not reduce false
    // phone calls on the hard negatives. Deleting that row would leave a
    // dataset in the repo with no record of why nothing trains on it.
    expect(doc).toContain("they did not help");
    expect(doc).toContain("always `focused` is **83.7%**");
  });
});

/**
 * The shipped head is the one the docs describe: trained WITHOUT the proxies.
 * The metrics file is written by the trainer, so this ties the claim to the
 * artifact instead of to a sentence somebody has to remember to update.
 */
describe("the shipped attention head", () => {
  const metrics = JSON.parse(
    readFileSync(
      join(repoRoot, "src", "main", "desk", "model", "weights", "attention-head.metrics.json"),
      "utf8",
    ),
  ) as { config: { excludeProxies?: boolean }; dataset: { proxies?: { train: number } } };

  it("was trained with --exclude-proxies, on zero bucket-labelled rows", () => {
    expect(metrics.config.excludeProxies).toBe(true);
    expect(metrics.dataset.proxies?.train).toBe(0);
  });
});
