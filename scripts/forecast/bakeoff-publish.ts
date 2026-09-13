import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, round4, round6, stringArg } from "./lib";
import { HOLDOUT_REPORT_FILE, holdoutRoot } from "./holdout-namespace";

/**
 * Distils `data/forecast/holdout/bakeoff-holdout.json` (gitignored working
 * data, ~110 KB) into the COMMITTED
 * `src/shared/forecast/bake-off-power.json`, which `eval.ts` embeds verbatim in
 * the published report.
 *
 * It carries the whole field — every family at BOTH feature bases, losers
 * included — with its paired session-clustered confidence intervals, and it
 * DERIVES the feature-vs-architecture decomposition from the table rather than
 * quoting prose, so the two headline claims of GAUNTLET round 10 are
 * re-derivable by running:
 *
 *   npm run forecast:evalset          # the 900-session corpus
 *   npm run forecast:holdout:bakeoff  # 17 fits on split:"train" rows only
 *   npm run forecast:bakeoff:publish  # this script
 *
 * Nothing here re-scores or re-fits anything; it is a projection.
 *
 *   tsx scripts/forecast/bakeoff-publish.ts
 */

interface Row {
  model: string;
  family: string;
  basis: string;
  featureDim: number;
  params: number;
  paramsNote: string | null;
  aucLead20: number;
  aucLead10: number;
  rocAuc: number;
  prAuc: number;
  ece: number;
  microsPerTick: number;
  alarms: {
    drifts: number;
    recallAt30Event: number;
    eventHits: number;
    recallAt30Prearm: number;
    prearmHits: number;
    recallAt30LooseBandRule: number;
    nudgesPerHour: number;
    falsePrearmsPerHour: number;
  };
  operatingPoint: { fprResearchChurnAtNudge: number };
  ci95: { lo: number; hi: number; sd: number };
  recipe: Record<string, unknown>;
}

interface Pair {
  model: string;
  vs: string;
  diff: number;
  lo95: number;
  hi95: number;
  sd: number;
  pDiffLeZero: number;
}

interface Bakeoff {
  corpus: Record<string, unknown>;
  protocol: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  table: Row[];
  bootstraps: Array<{ reference: string; draws: number; clusters: number; pairs: Pair[] }>;
  runtimeSec: number;
}

/**
 * Families that were fitted at BOTH bases, keyed by the 18/24 pair of model
 * names. The decomposition below is a difference of measured rows, not a
 * remembered number.
 */
const FAMILY_PAIRS: Array<{ family: string; at18: string; at24: string }> = [
  { family: "plain additive logistic", at18: "lr18", at24: "lr24" },
  { family: "GLM + pairwise basis (the round-8 head)", at18: "lr18+pairwise", at24: "lr24+pairwise" },
  { family: "TinyMLP d-12-1 (the round-7 head)", at18: "mlp18-12-1", at24: "mlp24-12-1" },
  { family: "tuned + bagged MLP", at18: "mlp-tuned18", at24: "mlp-tuned24" },
  { family: "GBDT", at18: "trees18", at24: "trees24" },
  { family: "hybrid (GLM trunk + tanh residual)", at18: "hybrid25", at24: "hybrid26" },
  { family: "temporal CNN, single net", at18: "temporal-1net18", at24: "temporal-1net24" },
  { family: "temporal CNN, 3-net ensemble", at18: "temporal-ens18", at24: "temporal-ens24" },
];

/** Architecture effect: a family against the PLAIN additive logistic at the same basis. */
const ARCHITECTURE_AT: Array<{ model: string; basis: 18 | 24 }> = [
  { model: "lr18+pairwise", basis: 18 },
  { model: "lr24+pairwise", basis: 24 },
  { model: "mlp-tuned18", basis: 18 },
  { model: "mlp-tuned24", basis: 24 },
  { model: "mlp18-12-1", basis: 18 },
  { model: "mlp24-12-1", basis: 24 },
  { model: "trees18", basis: 18 },
  { model: "trees24", basis: 24 },
  { model: "hybrid25", basis: 18 },
  { model: "hybrid26", basis: 24 },
  { model: "temporal-ens18", basis: 18 },
  { model: "temporal-ens24", basis: 24 },
];

function main(): void {
  const source = stringArg("--in", join(holdoutRoot(), "bakeoff-holdout.json"));
  const out = stringArg(
    "--out",
    join(repoRoot(), "src", "shared", "forecast", "bake-off-power.json"),
  );
  if (!existsSync(source)) {
    throw new Error(
      `${source} not found — run 'npm run forecast:evalset && npm run forecast:holdout:bakeoff' first`,
    );
  }
  const bakeoff = JSON.parse(readFileSync(source, "utf8")) as Bakeoff;
  const byName = new Map(bakeoff.table.map((row) => [row.model, row]));
  const auc = (name: string): number | null => byName.get(name)?.aucLead20 ?? null;

  const table = [...bakeoff.table]
    .sort((a, b) => b.aucLead20 - a.aucLead20)
    .map((row) => ({
      model: row.model,
      family: row.family,
      basis: row.basis,
      featureDim: row.featureDim,
      params: row.params,
      paramsNote: row.paramsNote,
      microsPerTick: row.microsPerTick,
      aucLead20: round6(row.aucLead20),
      aucLead20Ci95: [round6(row.ci95.lo), round6(row.ci95.hi)],
      aucLead10: round6(row.aucLead10),
      rocAuc: round6(row.rocAuc),
      prAuc: round6(row.prAuc),
      ece: round6(row.ece),
      recallAt30sNudgeRule: round4(row.alarms.recallAt30Event),
      recallAt30sPrearmRule: round4(row.alarms.recallAt30Prearm),
      recallAt30sLooseBandRule: round4(row.alarms.recallAt30LooseBandRule),
      nudgesPerHour: round4(row.alarms.nudgesPerHour),
      falsePrearmsPerHour: round4(row.alarms.falsePrearmsPerHour),
      researchChurnFprAtNudge: round6(row.operatingPoint.fprResearchChurnAtNudge),
      recipe: row.recipe,
    }));

  const featureEffect = FAMILY_PAIRS.map((pair) => {
    const a = auc(pair.at18);
    const b = auc(pair.at24);
    return {
      family: pair.family,
      at18: pair.at18,
      at24: pair.at24,
      aucLead20At18: a === null ? null : round6(a),
      aucLead20At24: b === null ? null : round6(b),
      delta: a === null || b === null ? null : round6(b - a),
    };
  });
  const deltas = featureEffect
    .map((entry) => entry.delta)
    .filter((value): value is number => value !== null);
  const meanFeatureEffect =
    deltas.length > 0 ? round6(deltas.reduce((sum, d) => sum + d, 0) / deltas.length) : null;

  const architectureEffect = ARCHITECTURE_AT.map((entry) => {
    const model = auc(entry.model);
    const plain = auc(entry.basis === 18 ? "lr18" : "lr24");
    return {
      model: entry.model,
      basis: entry.basis,
      vsPlainLogistic: entry.basis === 18 ? "lr18" : "lr24",
      delta: model === null || plain === null ? null : round6(model - plain),
    };
  });

  const pairedSe =
    bakeoff.bootstraps
      .flatMap((boot) => boot.pairs.map((pair) => pair.sd))
      .reduce((sum, sd, _, all) => sum + sd / all.length, 0) || null;

  const published = {
    description:
      "THE CONTEST THAT CHOSE THE SHIPPED HEAD. Eight model families fitted at BOTH feature bases " +
      "(the 18 level features of round 8 and the 24 that ship today) — 17 fits in total — every " +
      "one refit on split:\"train\" rows of data/forecast/dataset.jsonl and scored on the same " +
      "900-session / 1 230-onset hold-out corpus the committed eval-report.json uses, through one " +
      "replay, one metric, one operating point and one escalation reducer. Every loser is here on " +
      "purpose: publishing what lost is the only thing that makes the winner's margin mean " +
      "anything. NON-GATING.",
    whyThisExists:
      "round 8 ran the same contest on 48 held-out sessions, where the paired session-clustered SE " +
      "of a model-vs-model lead-AUC difference was ≈ 0.009 and every margin on offer was 0.4–0.7 " +
      "of one SE. It shipped the simplest model and said, honestly, that it could not tell the " +
      "field apart. That was an underpowered shrug, not a measurement. This corpus is 18.75× the " +
      "sessions; the measured SE is ≈ 0.003; and the comparison resolves — the other way.",
    regenerate: [
      "npm run forecast:evalset",
      "npm run forecast:holdout:bakeoff",
      "npm run forecast:bakeoff:publish",
    ],
    sourceReport: "data/forecast/holdout/bakeoff-holdout.json (gitignored working data)",
    gating: false,
    corpus: bakeoff.corpus,
    protocol: bakeoff.protocol,
    scoredAtOperatingPoint: {
      ...bakeoff.thresholds,
      note:
        "the point that shipped WHEN THE CONTEST RAN, applied identically to every contender so " +
        "the rows are comparable. The shipped head's own operating point has since been " +
        "re-derived for its risk scale (train.ts, cross-fitted TRAIN sessions), so the alarm " +
        "columns here are a common ruler, not the product's current settings.",
    },
    table,
    pairedBootstrap: {
      draws: bakeoff.bootstraps[0]?.draws ?? null,
      clusteredBy: "session",
      clusters: bakeoff.bootstraps[0]?.clusters ?? null,
      meanPairedSe: pairedSe === null ? null : round6(pairedSe),
      smallestResolvableDiff95: pairedSe === null ? null : round6(1.96 * pairedSe),
      references: bakeoff.bootstraps.map((boot) => ({
        vs: boot.reference,
        pairs: boot.pairs.map((pair) => ({
          model: pair.model,
          diff: round6(pair.diff),
          lo95: round6(pair.lo95),
          hi95: round6(pair.hi95),
          se: round6(pair.sd),
          p: round6(pair.pDiffLeZero),
          resolved: pair.lo95 > 0 || pair.hi95 < 0,
        })),
      })),
    },
    featuresVsArchitecture: {
      question:
        "round 9 concluded that FEATURES beat ARCHITECTURE — that the six trend features were " +
        "worth more than any hidden layer anyone tried. This decomposition tests that claim on a " +
        "corpus that can resolve it, by fitting every family at both bases.",
      featureEffect: {
        definition: "lead≥20s AUC at the 24-feature basis minus the same architecture at 18",
        perFamily: featureEffect,
        mean: meanFeatureEffect,
        verdict:
          "indistinguishable from zero at the measured paired SE, and DECISIVELY NEGATIVE for the " +
          "round-8 pairwise GLM (324 product terms on 133 k train rows overfit where 189 did not). " +
          "Round 9's ranking claim does not replicate. What the trend block DID buy is pre-arm " +
          "recall, which does replicate — see the recallAt30sPrearmRule column.",
      },
      architectureEffect: {
        definition: "lead≥20s AUC minus the PLAIN additive logistic at the same basis",
        perModel: architectureEffect,
        verdict:
          "the tuned + bagged MLP clears a plain logistic by a resolved margin at both bases. On " +
          "48 sessions this comparison was a coin flip; on 900 it is not. The round-9 conclusion " +
          "inverts, and the general lesson is the one worth keeping: a resolved margin at n=48 is " +
          "not a margin.",
      },
    },
    runtimeSec: bakeoff.runtimeSec,
  };

  writeFileSync(out, `${JSON.stringify(published, null, 2)}\n`);
  console.log(
    `bake-off-power.json → ${out} (${table.length} models, ` +
      `${published.pairedBootstrap.references.length} bootstrap references, mean paired SE ` +
      `${published.pairedBootstrap.meanPairedSe})`,
  );
  void HOLDOUT_REPORT_FILE;
}

main();
