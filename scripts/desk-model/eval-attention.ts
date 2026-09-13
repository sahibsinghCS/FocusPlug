import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTENTION_HEAD_LABELS,
  attentionHeadPredict,
  loadDeskHeadWeights,
} from "../../src/main/desk/model/your-model";
import { deskRoot } from "../../src/main/desk/assets";
import { buildAttentionEval, type Pair } from "./attention-report";
import { dedupeByPath, duplicatePathWarning, resolveMinGroups } from "./first-person";
import { attentionLabelsFile, cacheDir, readAttentionLabels, readFeatureRows } from "./lib";

/**
 * Held-out eval for the attention head. Scores ONLY `split: "eval"` rows of
 * datasets/desk-attention-labels.csv, whose near-duplicate groups never
 * straddle the split.
 *
 * Truth for the stock photos is Adaption Labs' annotation, not a human label —
 * the report says so, and says how often the pack's own `distracted` label
 * agrees.
 *
 * This file is the IO shell only: weights, features, labels, stdout, the JSON
 * file. Every decision about what is scored, what is refused and how it is
 * printed lives in `attention-report.ts`, so that the two-population split,
 * the group-count gate and the clip count riding on every first-person number
 * are pinned by `attention-report.test.ts` instead of only observable by
 * running this script against a data pack.
 *
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/eval-attention.ts
 *   ... eval-attention.ts --stock-only        # the pre-capture numbers, exactly
 *   ... eval-attention.ts --min-fp-groups 6   # raise the gate (it can only rise)
 */

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}

async function main(): Promise<void> {
  // --weights / --labels let an old head be scored on a new split, and vice versa.
  const file = stringArg("--weights", join(deskRoot(), "model", "weights", "attention-head.json"));
  const labelsFile = stringArg("--labels", attentionLabelsFile());
  const stockOnly = process.argv.includes("--stock-only");
  const minGroups = resolveMinGroups(Number(stringArg("--min-fp-groups", "")) || undefined);
  const weights = loadDeskHeadWeights(file, ATTENTION_HEAD_LABELS);
  if (!weights) {
    throw new Error("attention-head.json not found — run train-attention.ts first");
  }
  const labels = [...ATTENTION_HEAD_LABELS] as string[];
  const features = new Map(
    readFeatureRows(undefined, { includeFirstPerson: true }).map((row) => [row.path, row]),
  );
  // One path is one image: a repeated path would score the same image twice
  // and print frame counts for images that do not exist. extract-features.ts
  // has always deduped its work list; this is the same rule on the way in.
  const labelled = dedupeByPath(readAttentionLabels(labelsFile));
  const duplicates = duplicatePathWarning(labelled, labelsFile);
  if (duplicates) {
    console.warn(duplicates);
  }
  const rows = labelled.rows
    .filter((row) => row.split === "eval" && labels.includes(row.attention))
    .flatMap((label) => {
      const feature = features.get(label.path);
      return feature ? [{ label, feature }] : [];
    });
  if (rows.length === 0) {
    throw new Error("No labelled eval rows with cached features");
  }

  const pairs: Pair[] = rows.map(({ label, feature }) => {
    const prediction = attentionHeadPredict(weights, feature.vector);
    return {
      path: label.path,
      truth: label.attention,
      predicted: prediction.label as string,
      confidence: prediction.confidence,
      workspace: label.workspace === "True" || label.workspace === "true",
      packLabel: label.packLabel,
      group: label.group,
      attention: label.attention,
    };
  });

  const { lines, report } = buildAttentionEval({
    labels,
    pairs,
    minGroups,
    stockOnly,
    evaluatedAt: new Date().toISOString(),
  });
  for (const line of lines) {
    console.log(line);
  }
  const reportFile = join(cacheDir(), "attention-eval-report.json");
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`report -> ${reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
