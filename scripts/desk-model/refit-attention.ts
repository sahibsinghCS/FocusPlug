import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeImageBuffer } from "../../src/main/desk/frame";
import {
  ATTENTION_HEAD_LABELS,
  extractDeskFeatures,
  loadDeskHeadWeights,
} from "../../src/main/desk/model/your-model";
import {
  ATTENTION_LABELS,
  CORRECTION_ANCHOR_EVIDENCE,
  CORRECTION_MAX_SLICE_DROP_PTS,
  attentionHidden,
  evaluateRefit,
  scoreHoldout,
  shippedOutputLayer,
  type CorrectionGroupInput,
  type PersonalAttentionHead,
  type RefitReport,
  type RefitScores,
  type SliceScore,
} from "./personal-refit";
import {
  attentionAnchorsFile,
  attentionHeadFile,
  attentionHeadHash,
  correctionPool,
  installPersonalHead,
  loadAttentionAnchors,
  personalHeadPath,
  readCorrections,
  refitReportPath,
  saveCachedActivations,
  writeRefitReport,
  type ActivationUpdate,
  type StoredCorrection,
} from "./refit-io";

/**
 * Refit the attention head's OUTPUT LAYER from a student's stored corrections,
 * score it against the shipped head on the committed held-out anchors, and
 * install it only if it passes the gate.
 *
 *   npm run refit:attention -- --from ~/.config/FocusPlug/desk-corrections
 *   ... --from <dir> --dry-run          # score and report, write nothing
 *   ... --from <dir> --gate off         # dev escape hatch: stamps itself
 *
 * This is the developer-side shell around the same pure fit and the same
 * ordered gates the app runs (`personal-refit.ts`, docs/CORRECTION-LOOP.md §6
 * and §7). It exists for three reasons: a refit that can only be run from a
 * button cannot be tested against a real directory; a failing gate is a
 * diagnosis and somebody has to be able to read it; and the numbers on both
 * sides of the comparison should be printable without a UI.
 *
 * WHAT IT WILL NOT DO.
 *
 * * It never writes `src/main/desk/model/weights/attention-head.json`. The
 *   shipped head is not writable by this path at all — a personal head is 51
 *   numbers in the student's own directory, and the 1280→16 representation it
 *   is anchored to is physically not in that file.
 * * It never installs a head that lost. A failing refit DELETES any personal
 *   head that was there and leaves `refit-report.json` saying which gate
 *   stopped it and by how much, so there is no inactive head file for a bug to
 *   load by accident.
 * * It never uploads anything. It reads one directory, writes two files back
 *   into it, and prints.
 *
 * THE OTHER PATH, and why this is not it: exported corrections
 * (`npm run corrections:export`) land in the labels CSV as ordinary
 * first-person rows, and `train-attention.ts --first-person-weight` folds them
 * into the SHIPPED head on a developer's machine with the whole 693-row pool
 * present. That path retrains 20,000 parameters from images; this one fits 51
 * from activations, on the student's machine, against a prior it cannot see
 * the training images of. They are different trades and both are wanted.
 */

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] !== undefined
    ? (process.argv[index + 1] as string)
    : fallback;
}

const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;
const pts = (value: number): string => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}`;

function sliceRow(name: string, shipped: SliceScore, personal: SliceScore): string {
  return (
    `  ${name.padEnd(18)} ${pct(shipped.balanced).padStart(7)}   ${pct(personal.balanced).padStart(7)}   ` +
    `${pts(personal.balanced - shipped.balanced).padStart(6)} pts   over ${String(shipped.images).padStart(3)} image(s), ${shipped.presentLabels.join("/")}`
  );
}

function phoneRow(name: string, shipped: SliceScore, personal: SliceScore): string {
  return (
    `  ${name.padEnd(18)} P ${pct(shipped.phone.precision)} R ${pct(shipped.phone.recall)} F1 ${pct(shipped.phone.f1)}` +
    `   ->   P ${pct(personal.phone.precision)} R ${pct(personal.phone.recall)} F1 ${pct(personal.phone.f1)}   (${shipped.phone.support} phone image(s))`
  );
}

function holdoutRow(shipped: RefitScores, personal: RefitScores): string {
  const groups = shipped.personalHoldout?.groups ?? 0;
  return (
    `  ${"your held-out".padEnd(18)} ${shipped.personalHoldoutGroupsCorrect} of ${groups}   ->   ` +
    `${personal.personalHoldoutGroupsCorrect} of ${groups} correction(s) it agrees with you on`
  );
}

/** Every printed ratio names the CORRECTIONS behind it, never the frames. */
function census(pool: readonly CorrectionGroupInput[]): string {
  const byLabel: Record<string, number> = {};
  for (const group of pool) {
    byLabel[group.label] = (byLabel[group.label] ?? 0) + 1;
  }
  const frames = pool.reduce((sum, group) => sum + group.frames.length, 0);
  const perLabel = ATTENTION_LABELS.filter((label) => (byLabel[label] ?? 0) > 0)
    .map((label) => `${label} ${byLabel[label] ?? 0}`)
    .join(", ");
  return `${pool.length} correction(s) [${perLabel || "none"}], ${frames} photo(s) — a correction is one vote however many photos it carries`;
}

async function fillActivations(
  directory: string,
  corrections: readonly StoredCorrection[],
  head: NonNullable<ReturnType<typeof loadDeskHeadWeights>>,
  baseHeadHash: string,
  persist: boolean,
): Promise<{ updates: ActivationUpdate[]; failures: string[] }> {
  const updates: ActivationUpdate[] = [];
  const failures: string[] = [];
  const pending = corrections.flatMap((record) =>
    record.head === "attention"
      ? record.frames
          .filter((frame) => frame.hidden === null || frame.hiddenFor !== baseHeadHash)
          .map((frame) => ({ record, frame }))
      : [],
  );
  if (pending.length === 0) {
    return { updates, failures };
  }
  console.log(
    `activations: ${pending.length} frame(s) have none for head ${baseHeadHash} — recomputing them from the photos (about a second each)`,
  );
  for (const { record, frame } of pending) {
    const file = join(directory, frame.file);
    if (!existsSync(file)) {
      failures.push(`${record.id}/${frame.file}: the photo is gone, so its activation cannot be recomputed`);
      continue;
    }
    try {
      const image = decodeImageBuffer(readFileSync(file));
      const { vector } = await extractDeskFeatures(image);
      updates.push({
        correctionId: record.id,
        file: frame.file,
        hidden: attentionHidden(head, vector),
        hiddenFor: baseHeadHash,
      });
    } catch (error) {
      failures.push(`${record.id}/${frame.file}: ${(error as Error).message}`);
    }
    if ((updates.length + failures.length) % 5 === 0) {
      console.log(`  ${updates.length + failures.length}/${pending.length}`);
    }
  }
  if (persist && updates.length > 0) {
    const patched = saveCachedActivations(directory, updates);
    console.log(`  cached ${patched} activation(s) back into corrections.json`);
  }
  return { updates, failures };
}

function printReport(report: RefitReport, directory: string, parameters: number): void {
  const { shipped, personal } = report;
  console.log("");
  console.log(`corrections: ${report.corrections.total} total — ${report.corrections.trainGroups} train, ${report.corrections.evalGroups} held out, ${report.corrections.frames} photo(s)`);
  console.log(
    `fit: the output layer only — ${parameters} numbers, λ ${report.lambda.toFixed(5)} (the anchor pulls toward the shipped layer with the weight of ${CORRECTION_ANCHOR_EVIDENCE} labelled rows against ${report.corrections.trainGroups} corrections), ${report.epochs} full-batch steps at lr ${report.learningRate}, no PRNG`,
  );
  console.log(`     it moved the layer ${(report.driftRatio * 100).toFixed(2)}% of its own size (trust region 50%)`);
  console.log("");
  console.log("BALANCED ACCURACY ON THE HELD-OUT EVAL — the same images eval-attention.ts scores");
  console.log(`  ${"".padEnd(18)} shipped   personal   change`);
  console.log(sliceRow("pooled (the gate)", shipped.pooled, personal.pooled));
  console.log(sliceRow("adaption slice", shipped.adaption, personal.adaption));
  console.log(sliceRow("proxy slice", shipped.proxy, personal.proxy));
  console.log("  phone detection, both heads:");
  console.log(phoneRow("  pooled", shipped.pooled, personal.pooled));
  console.log(phoneRow("  proxy", shipped.proxy, personal.proxy));
  if (shipped.personalHoldout) {
    console.log(holdoutRow(shipped, personal));
  }
  if (report.pooledMarginCi95) {
    const ci = report.pooledMarginCi95;
    console.log(
      `  paired bootstrap (${ci.draws} draws, reported BESIDE the gate and never as it): ${pts(ci.point / 100)} pts [${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}]`,
    );
    if (ci.lo <= 0 && ci.hi >= 0) {
      console.log("  that interval straddles zero: no measurable difference on stock photos, which is the correct outcome for a no-regression gate");
    }
  }
  console.log("");
  console.log("GATES, in order — the first failure is the one that stopped it");
  for (const gate of report.gates) {
    const mark = gate.passed ? "pass" : report.blockedBy === gate.id ? "STOP" : "fail";
    console.log(`  [${mark}] ${gate.id}`);
    console.log(`         ${gate.detail}`);
  }
  console.log("");
  if (!report.gateEnforced) {
    console.log("!! THE GATE WAS OFF (--gate off). This head was NOT shown to be no worse than the shipped one.");
    console.log("!! refit-report.json records gateEnforced: false, and the app renders that until the next real refit.");
  }
  const gain = personal.personalHoldoutGroupsCorrect - shipped.personalHoldoutGroupsCorrect;
  console.log(
    !report.installed
      ? `ACTIVE HEAD: shipped — the personal head did not install (${report.blockedBy}). The shipped head keeps running, exactly as before.`
      : report.gateEnforced
        ? `ACTIVE HEAD: personal — it was not beaten on the ${personal.pooled.images} held-out stock image(s), neither slice dropped more than ${CORRECTION_MAX_SLICE_DROP_PTS} points, and it agrees with you on ${gain} more of your ${report.corrections.evalGroups} held-out correction(s) than the shipped head did.`
        : `ACTIVE HEAD: personal, INSTALLED WITH THE GATE OFF — nothing here showed it is no worse than the shipped head, and ${report.blockedBy ?? "no gate"} would have stopped it.`,
  );
  console.log(`report -> ${refitReportPath(directory)}`);
}

async function main(): Promise<void> {
  const from = stringArg("--from", "");
  if (!from) {
    throw new Error(
      "--from <dir> is required: the desk-corrections directory to refit from " +
        "(<userData>/desk-corrections, or a copy of one). Nothing is read from anywhere else.",
    );
  }
  const directory = resolve(from);
  const outDirectory = resolve(stringArg("--out", directory));
  const headFile = stringArg("--head", attentionHeadFile());
  const anchorsFile = stringArg("--anchors", attentionAnchorsFile());
  const dryRun = process.argv.includes("--dry-run");
  const gateOff = stringArg("--gate", "on") === "off";
  // Present so every gate is reachable from a command line, not because a
  // developer machine has sessions.
  const sessionActive = process.argv.includes("--session-active");
  const deskModelId = stringArg("--desk-model", "custom");

  const head = loadDeskHeadWeights(headFile, ATTENTION_HEAD_LABELS);
  if (!head) {
    throw new Error(`${headFile} is not a loadable attention head`);
  }
  const baseHeadHash = attentionHeadHash(headFile);
  const anchors = loadAttentionAnchors(anchorsFile);
  if (!anchors) {
    throw new Error(
      `${anchorsFile} is missing or unreadable — build it with \`npm run anchors:attention\` (it needs the desk-data pack).`,
    );
  }

  const stored = readCorrections(directory);
  for (const dropped of stored.dropped) {
    console.warn(`corrections.json: dropped ${dropped}`);
  }
  const { failures } = await fillActivations(directory, stored.corrections, head, baseHeadHash, !dryRun);
  for (const failure of failures) {
    console.warn(`activations: ${failure}`);
  }
  // Re-read so the pool sees exactly what is on disk after the fill; on a dry
  // run the fill persisted nothing, so this is the honest "what would happen
  // if you ran it for real, with whatever is cached today" answer.
  const after = dryRun ? stored : readCorrections(directory);
  const pool = correctionPool(after.corrections, baseHeadHash);

  console.log(`corrections dir: ${directory}`);
  console.log(`head ${baseHeadHash} · anchors ${anchors.hash} (${anchors.anchors.rows.length} held-out image(s), built for head ${anchors.anchors.baseHeadHash})`);
  console.log(`pool: ${census(pool.groups)}`);
  if (pool.skipped.length > 0) {
    console.log(`  ${pool.skipped.length} record(s) are not attention evidence (an \`away\` correction trains the presence head, not this one) or kept no photos`);
  }
  if (pool.missing.length > 0) {
    console.log(`  ${pool.missing.length} correction(s) have no usable activations and were left out: ${pool.missing.join(", ")}`);
  }
  if (pool.stale.length > 0) {
    console.log(`  ${pool.stale.length} correction(s) carry activations for another head: ${pool.stale.join(", ")}`);
  }

  const outcome = evaluateRefit({
    at: Date.now(),
    deskModelId,
    sessionActive,
    baseHeadHash,
    anchors: anchors.anchors,
    anchorsHash: anchors.hash,
    base: shippedOutputLayer(head),
    groups: pool.groups,
    staleGroups: pool.stale.length,
    gateEnforced: !gateOff,
  });

  // The per-correction table: what the student said, and what each head says
  // now. Corrections, never frames, and never a percentage over three votes.
  const holdout = pool.groups.filter((group) => group.split === "eval");
  if (holdout.length > 0) {
    const shippedVotes = scoreHoldout(shippedOutputLayer(head), holdout).votes;
    const personalVotes = scoreHoldout(outcome.fit.output, holdout).votes;
    console.log("");
    console.log("YOUR HELD-OUT CORRECTIONS, one vote per correction");
    console.log(`  ${"correction".padEnd(10)} ${"you said".padEnd(10)} ${"shipped".padEnd(10)} personal`);
    for (let i = 0; i < holdout.length; i += 1) {
      const group = holdout[i] as CorrectionGroupInput;
      const shippedVote = shippedVotes[i]?.predicted ?? "?";
      const personalVote = personalVotes[i]?.predicted ?? "?";
      console.log(
        `  ${group.id.padEnd(10)} ${group.label.padEnd(10)} ${`${shippedVote}${shippedVote === group.label ? " ✓" : ""}`.padEnd(10)} ${personalVote}${personalVote === group.label ? " ✓" : ""}`,
      );
    }
  }

  const base = shippedOutputLayer(head);
  printReport(outcome.report, outDirectory, base.b.length * (base.w[0]?.length ?? 0) + base.b.length);

  if (dryRun) {
    console.log("--dry-run: no head installed, no report written, corrections.json untouched");
    return;
  }
  writeRefitReport(outDirectory, outcome.report);
  const head51: PersonalAttentionHead | null =
    outcome.personal === null
      ? null
      : {
          v: 1,
          baseHeadHash,
          labels: ATTENTION_LABELS,
          output: outcome.personal,
          fittedAt: outcome.report.at,
          report: outcome.report,
        };
  const install = installPersonalHead(outDirectory, head51);
  if (install.installed) {
    console.log(`personal head -> ${personalHeadPath(outDirectory)} (51 numbers)`);
  } else if (install.removed) {
    console.log(`removed the previous personal head at ${personalHeadPath(outDirectory)} — a refit that did not pass leaves no head behind`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
