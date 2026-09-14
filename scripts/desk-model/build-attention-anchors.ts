import { writeFileSync } from "node:fs";
import {
  ATTENTION_HEAD_LABELS,
  attentionHeadPredict,
  loadDeskHeadWeights,
} from "../../src/main/desk/model/your-model";
import { dedupeByPath, duplicatePathWarning, isFirstPersonRow } from "./first-person";
import { attentionLabelsFile, readAttentionLabels, readFeatureRows } from "./lib";
import {
  ATTENTION_LABELS,
  attentionHidden,
  predictFromHidden,
  scoreAnchorSlice,
  shippedOutputLayer,
  type AttentionAnchorRow,
  type AttentionAnchors,
  type SliceScore,
} from "./personal-refit";
import {
  anchorSlice,
  attentionAnchorsFile,
  attentionAnchorsMetricsFile,
  attentionHeadFile,
  attentionHeadHash,
  isNonCommercialPath,
  sha16,
  writeJsonAtomic,
} from "./refit-io";
import type { AttentionLabel } from "@shared/types";

/**
 * Build `src/main/desk/model/weights/attention-anchors.json` — the held-out
 * eval, as 16 numbers per image instead of 286 photographs.
 *
 *   FOCUSPLUG_DESK_DATA=... npm run anchors:attention
 *   ... npm run anchors:attention -- --dry-run
 *
 * WHY THIS FILE EXISTS. The gate on a personal attention head (§7 of
 * docs/CORRECTION-LOOP.md) compares it with the shipped head on the SAME
 * held-out eval `eval-attention.ts` scores — 286 stock images. That eval has
 * to be on the student's machine, and shipping 286 photographs is out of the
 * question: the desk-data pack is third-party stock and one bucket is
 * CC BY-NC-SA. docs/CUSTOM-MODEL.md says it in as many words — only learned
 * weights ship, never the images.
 *
 * It does not have to. Because a refit fits the OUTPUT LAYER only, both heads
 * share the frozen 1280→16 bottleneck, so the only thing either head needs
 * from an eval image is its 16 hidden activations. Sixteen numbers out of a
 * frozen bottleneck is categorically the same artifact as the learned weights
 * this repo already ships, and categorically unlike a photograph: no image is
 * recoverable from it, and the `path` strings are already public in
 * datasets/desk-attention-labels.csv.
 *
 * THE THREE RULES THIS BUILDER ENFORCES, in the order it enforces them:
 *
 * 1. NO `nc/` IMAGE MAY ENTER THE PACK. The Edinburgh office-webcam bucket is
 *    CC BY-NC-SA and this repo is MIT. The rule is vacuous today — no `nc`
 *    image was ever attention-labelled — and it is enforced anyway so that it
 *    stays vacuous.
 * 2. NO FIRST-PERSON FRAME MAY ENTER THE PACK. Webcam clips and in-app
 *    corrections are somebody's room. Their activations are exactly the kind
 *    of derived data this feature promises never leaves the machine, so they
 *    are excluded from a committed file by construction, not by remembering.
 * 3. THE SHORTCUT IS PINNED TO THE LONG WAY ROUND. For every image the pack
 *    keeps, the prediction from (16 activations → output layer) must equal the
 *    prediction the real `attentionHeadPredict` makes from the full 2025-d
 *    feature vector, after rounding. One disagreement and nothing is written.
 *    That is the same move `eval.ts --e2e` makes for the presence head.
 *
 * `baseHeadHash` is sha256 of `attention-head.json`'s bytes. If an app update
 * ships a different head and nobody rebuilds this pack, the hashes disagree,
 * the refit fails with `stale-anchors`, and no personal head installs — the
 * gate cannot silently score the wrong thing.
 */

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] !== undefined
    ? (process.argv[index + 1] as string)
    : fallback;
}

function numberArg(flag: string, fallback: number): number {
  const parsed = Number(stringArg(flag, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;

function census(rows: readonly AttentionAnchorRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of ATTENTION_LABELS) {
    const total = rows.filter((row) => row.truth === label).length;
    if (total > 0) {
      counts[label] = total;
    }
  }
  return counts;
}

function sliceLine(name: string, score: SliceScore): string {
  return (
    `${name.padEnd(9)} ${String(score.images).padStart(3)} image(s) · ` +
    `accuracy ${pct(score.accuracy)} · balanced ${pct(score.balanced)} over ${score.presentLabels.join("/")} · ` +
    `phone P ${pct(score.phone.precision)} R ${pct(score.phone.recall)} F1 ${pct(score.phone.f1)} (${score.phone.support} positives)`
  );
}

async function main(): Promise<void> {
  const headFile = stringArg("--weights", attentionHeadFile());
  const labelsFile = stringArg("--labels", attentionLabelsFile());
  const outFile = stringArg("--out", attentionAnchorsFile());
  const metricsFile = stringArg("--metrics", attentionAnchorsMetricsFile());
  // Significant digits per activation. 7 keeps the pack near 60 KB and is
  // verified below to change no prediction; the check, not the number, is the
  // guarantee.
  const precision = Math.max(3, Math.min(17, Math.trunc(numberArg("--precision", 7))));
  const dryRun = process.argv.includes("--dry-run");

  const weights = loadDeskHeadWeights(headFile, ATTENTION_HEAD_LABELS);
  if (!weights) {
    throw new Error(`${headFile} is not a loadable attention head — run train-attention.ts first`);
  }
  if (weights.layers.length !== 2) {
    throw new Error(
      `the attention head has ${weights.layers.length} layer(s); the anchor pack exists because the head is 1280 -> hidden -> 3 and only the last layer is ever refit`,
    );
  }
  const baseHeadHash = attentionHeadHash(headFile);
  const output = shippedOutputLayer(weights);
  const hiddenDim = weights.layers[0]?.b.length ?? 0;

  const labelled = dedupeByPath(readAttentionLabels(labelsFile));
  const duplicates = duplicatePathWarning(labelled, labelsFile);
  if (duplicates) {
    console.warn(duplicates);
  }
  const features = new Map(
    readFeatureRows(undefined, { includeAttentionOnly: true }).map((row) => [row.path, row]),
  );

  const excluded = { nonCommercial: 0, firstPerson: 0, noFeatures: 0 };
  const rows: AttentionAnchorRow[] = [];
  const parity = { images: 0, predictionsAgree: 0, maxProbDelta: 0, maxHiddenDelta: 0 };
  const disagreements: string[] = [];

  for (const label of labelled.rows) {
    if (label.split !== "eval" || !(ATTENTION_LABELS as readonly string[]).includes(label.attention)) {
      continue;
    }
    if (isNonCommercialPath(label.path)) {
      // Loud, and counted: a licence rule that fails silently is not a rule.
      excluded.nonCommercial += 1;
      console.warn(
        `LICENCE: ${label.path} is in the CC BY-NC-SA nc/ bucket and is NOT in the anchor pack. ` +
          "The pack is committed to an MIT repository; nothing derived from that bucket may ship in it.",
      );
      continue;
    }
    if (isFirstPersonRow(label)) {
      // Somebody's room. Their activations never enter a committed file.
      excluded.firstPerson += 1;
      continue;
    }
    const feature = features.get(label.path);
    if (!feature) {
      excluded.noFeatures += 1;
      continue;
    }
    const exact = attentionHidden(weights, feature.vector);
    const hidden = exact.map((value) => Number(value.toPrecision(precision)));
    const long = attentionHeadPredict(weights, feature.vector);
    const short = predictFromHidden(output, hidden);
    parity.images += 1;
    for (let i = 0; i < exact.length; i += 1) {
      parity.maxHiddenDelta = Math.max(
        parity.maxHiddenDelta,
        Math.abs((exact[i] ?? 0) - (hidden[i] ?? 0)),
      );
    }
    for (let i = 0; i < long.probs.length; i += 1) {
      parity.maxProbDelta = Math.max(
        parity.maxProbDelta,
        Math.abs((long.probs[i] ?? 0) - (short.probs[i] ?? 0)),
      );
    }
    if (long.label === short.label) {
      parity.predictionsAgree += 1;
    } else {
      disagreements.push(`${label.path}: full vector says ${long.label}, 16 activations say ${short.label}`);
    }
    rows.push({
      path: label.path,
      slice: anchorSlice(label),
      truth: label.attention as AttentionLabel,
      hidden,
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "No held-out attention rows with cached features — run extract-features.ts against the pack first",
    );
  }
  if (disagreements.length > 0) {
    throw new Error(
      `${disagreements.length} image(s) predict differently from their 16 activations than from the full feature vector — the pack would not be the eval it claims to be:\n  ${disagreements
        .slice(0, 5)
        .join("\n  ")}\nRaise --precision and rebuild.`,
    );
  }

  const anchors: AttentionAnchors = {
    v: 1,
    baseHeadHash,
    hiddenDim,
    labels: ATTENTION_LABELS,
    rows,
  };
  const adaption = rows.filter((row) => row.slice === "adaption");
  const proxy = rows.filter((row) => row.slice === "proxy");
  const shipped = {
    pooled: scoreAnchorSlice(output, rows),
    adaption: scoreAnchorSlice(output, adaption),
    proxy: scoreAnchorSlice(output, proxy),
  };

  console.log(`attention head: ${headFile}`);
  console.log(`  baseHeadHash ${baseHeadHash} · arch ${weights.featureDim} -> ${hiddenDim} -> ${weights.layers[1]?.b.length ?? 0} · slices ${JSON.stringify(weights.inputSlices)}`);
  console.log(
    `anchors: ${rows.length} held-out image(s) — ${adaption.length} Adaption-annotated, ${proxy.length} stock attention proxies`,
  );
  console.log(`  pooled by truth: ${JSON.stringify(census(rows))}`);
  console.log(`  adaption: ${JSON.stringify(census(adaption))} · proxy: ${JSON.stringify(census(proxy))}`);
  console.log(
    `  excluded: ${excluded.nonCommercial} nc/ (licence), ${excluded.firstPerson} first-person (privacy), ${excluded.noFeatures} with no cached features`,
  );
  console.log(
    `parity: ${parity.predictionsAgree}/${parity.images} images predict identically from 16 activations and from the full 2025-d vector · max |Δprob| ${parity.maxProbDelta.toExponential(2)} · rounding to ${precision} significant digits moved an activation by at most ${parity.maxHiddenDelta.toExponential(2)}`,
  );
  console.log("shipped head, scored on the anchors — these are the numbers the gate must not lose:");
  console.log(`  ${sliceLine("pooled", shipped.pooled)}`);
  console.log(`  ${sliceLine("adaption", shipped.adaption)}`);
  console.log(`  ${sliceLine("proxy", shipped.proxy)}`);
  console.log(
    "  the proxy slice has no `unfocused` image at all, so its balanced accuracy is macro-recall over the two classes present",
  );

  if (dryRun) {
    console.log("--dry-run: nothing written");
    return;
  }

  const text = `${JSON.stringify(anchors)}\n`;
  writeFileSync(outFile, text);
  writeJsonAtomic(metricsFile, {
    builtAt: new Date().toISOString(),
    builtBy: "scripts/desk-model/build-attention-anchors.ts (npm run anchors:attention)",
    anchors: {
      file: outFile.split("/").slice(-1)[0],
      bytes: Buffer.byteLength(text),
      hash: sha16(text),
      rows: rows.length,
      hiddenDim,
      precision,
    },
    baseHeadHash,
    head: {
      file: headFile.split("/").slice(-1)[0],
      arch: [weights.featureDim, hiddenDim, weights.layers[1]?.b.length ?? 0],
      inputSlices: weights.inputSlices ?? null,
    },
    source: {
      labels: "datasets/desk-attention-labels.csv",
      split: "eval",
      truth:
        "Adaption Labs annotation (adaption slice) / the search-query bucket that found the photo (proxy slice)",
    },
    census: {
      pooled: { images: rows.length, byTruth: census(rows) },
      adaption: { images: adaption.length, byTruth: census(adaption) },
      proxy: { images: proxy.length, byTruth: census(proxy) },
    },
    excluded,
    parity,
    shipped,
    note:
      "16 activations of a frozen 1280->16 bottleneck per held-out image, and the truth. No image is recoverable from a row, no nc/ (CC BY-NC-SA) image is in the pack, and no first-person frame is either. Rebuild whenever attention-head.json changes, or the refit gate fails with stale-anchors.",
  });
  console.log(`anchors  -> ${outFile} (${(Buffer.byteLength(text) / 1024).toFixed(1)} KB)`);
  console.log(`metrics  -> ${metricsFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
