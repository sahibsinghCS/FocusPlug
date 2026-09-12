import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";
import {
  INITIAL_ESCALATION_STATE,
  smoothRisk,
  stepEscalation,
  type EscalationSettings,
  type EscalationState,
} from "../../src/shared/forecast/escalate";
import { findDriftOnsets, type DecisionFrame } from "../../src/shared/forecast/labels";
import { forward, parseForecastWeights } from "../../src/shared/forecast/model";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_MODEL_VERSION,
  FORECAST_WARMUP_SEC,
  type ForecastEvent,
  type ForecastWeightsFile,
} from "../../src/shared/forecast/types";
import {
  CONTRACT_PREARM_FUSE_SEC,
  DATASET_FILE,
  PROVENANCE_FILE,
  RAW_SESSIONS_FILE,
  canonicalJson,
  ece10,
  forecastDataRoot,
  logisticScore,
  numberArg,
  prAuc,
  percentile,
  readJsonl,
  repoRoot,
  replaySession,
  rocAuc,
  round4,
  sha256Hex,
  splitForSession,
  stringArg,
  thresholdDefaults,
  trainLogistic,
  type DatasetRow,
  type RawSession,
} from "./lib";

/**
 * Held-out evaluation + CI gate — the judge-facing numbers, produced only
 * from `split: "eval"` sessions train.ts never touched. The anti-fraud
 * protocol from the design:
 *
 * - LEAD-CENSORED ROC-AUC (the headline): scored only on frames whose nearest
 *   drift onset is ≥ 20 s away vs calm frames — positives are 20–30 s before
 *   onset, so a high number structurally proves prediction, not last-second
 *   detection. Also reported at ≥ 10 s.
 * - Alarm simulation through the SHIPPED escalation reducer at the SHIPPED
 *   default thresholds: recall@30 s, median/p25 lead, false pre-arms/hour.
 * - Baseline table incl. a single-feature logistic chosen adversarially (best
 *   single feature BY the lead-censored eval AUC) — the gate exits NONZERO
 *   unless the MLP beats it by ≥ 0.03 lead-censored AUC. `--gate=off` bypasses
 *   but stamps `"gate":{"enforced":false}` into the committed report: the
 *   claim can be skipped, never faked.
 * - Per-archetype slices with research_churn (allowlist-internal churn, zero
 *   drifts) false-positive rates called out.
 * - Operating-point parity: weights.thresholds must equal the DEFAULT_SETTINGS
 *   forecast keys, and the embedded provenance sha must match the weights.
 *
 *   tsx scripts/forecast/eval.ts [--gate=off]
 */

interface EvalConfig {
  data: string;
  raw: string;
  weights: string;
  out: string;
  seed: number;
  gateOff: boolean;
}

function readConfig(): EvalConfig {
  const gateOff =
    process.argv.includes("--gate=off") || stringArg("--gate", "on").toLowerCase() === "off";
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    weights: stringArg(
      "--weights",
      join(repoRoot(), "src", "shared", "forecast", "weights.json"),
    ),
    out: stringArg("--out", join(repoRoot(), "src", "shared", "forecast", "eval-report.json")),
    seed: numberArg("--seed", 42),
    gateOff,
  };
}

const GATE_MARGIN = 0.03;

interface EvalRow {
  features: number[];
  label: 0 | 1;
  secsToDrift: number | null;
  archetype: string;
  sessionId: string;
}

/** Lead-censored eligibility: onset ≥ `leadSec` away, or calm. */
function leadEligible(row: EvalRow, leadSec: number): boolean {
  return row.secsToDrift === null || row.secsToDrift >= leadSec;
}

function aucOn(rowsScores: Array<{ score: number; label: number }>): number {
  return rocAuc(
    rowsScores.map((r) => r.score),
    rowsScores.map((r) => r.label),
  );
}

function leadAuc(rows: readonly EvalRow[], scores: readonly number[], leadSec: number): number {
  const pairs: Array<{ score: number; label: number }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as EvalRow;
    if (leadEligible(row, leadSec)) {
      pairs.push({ score: scores[i] as number, label: row.label });
    }
  }
  return aucOn(pairs);
}

function operatingPoint(
  rows: readonly EvalRow[],
  scores: readonly number[],
  threshold: number,
): { threshold: number; precision: number | null; recall: number; fpr: number } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const fired = (scores[i] as number) >= threshold;
    if ((rows[i] as EvalRow).label === 1) {
      fired ? (tp += 1) : (fn += 1);
    } else {
      fired ? (fp += 1) : (tn += 1);
    }
  }
  return {
    threshold,
    precision: tp + fp > 0 ? round4(tp / (tp + fp)) : null,
    recall: round4(tp + fn > 0 ? tp / (tp + fn) : 0),
    fpr: round4(fp + tn > 0 ? fp / (fp + tn) : 0),
  };
}

// ---------------------------------------------------------------------------
// Alarm simulation — the shipped reducer at the shipped operating point
// ---------------------------------------------------------------------------

interface AlarmTotals {
  drifts: number;
  hits: number;
  leads: number[];
  falsePrearms: number;
  nudges: number;
  hours: number;
  sessions: number;
}

function newAlarmTotals(): AlarmTotals {
  return { drifts: 0, hits: 0, leads: [], falsePrearms: 0, nudges: 0, hours: 0, sessions: 0 };
}

function simulateAlarms(
  session: RawSession,
  weights: ForecastWeightsFile,
  settings: EscalationSettings,
): { drifts: number; hits: number; leads: number[]; falsePrearms: number; nudges: number } {
  const frames = replaySession(session);
  const decisions: DecisionFrame[] = frames.map((frame) => ({
    t: frame.t,
    decision: frame.decision,
    countdownActive: frame.countdownActive,
  }));
  const onsets = findDriftOnsets(decisions);

  let state: EscalationState = { ...INITIAL_ESCALATION_STATE };
  let smoothed: number | null = null;
  const events: ForecastEvent[] = [];
  for (const frame of frames) {
    const rawRisk = forward(weights, frame.values).rawRisk;
    smoothed = smoothRisk(smoothed, rawRisk);
    const stepped = stepEscalation(state, {
      ts: frame.t * 1000,
      risk: smoothed,
      ready: frame.t >= FORECAST_WARMUP_SEC,
      decision: frame.decision,
      countdownActive: frame.countdownActive,
      policySignal: null,
      settings,
    });
    state = stepped.state;
    events.push(...stepped.events);
  }

  const prearms = events.filter((event) => event.type === "forecast_prearm");
  const hitEvents = events.filter((event) => event.type === "forecast_hit");
  const nudges = events.filter((event) => event.type === "forecast_nudge").length;
  let hits = 0;
  const leads: number[] = [];
  for (const onset of onsets) {
    // Hit = pre-arm ACTIVE at onset (the reducer's own forecast_hit receipt,
    // which carries the lead) OR fired within the prior 30 s (a stood-down
    // pre-arm that still called it).
    const receipt = hitEvents.find(
      (event) => event.type === "forecast_hit" && Math.abs(event.ts / 1000 - onset.t) <= 1.5,
    );
    if (receipt !== undefined && receipt.type === "forecast_hit") {
      hits += 1;
      leads.push(receipt.leadSec);
      continue;
    }
    const candidates = prearms.filter(
      (event) => event.ts / 1000 <= onset.t && onset.t - event.ts / 1000 <= 30,
    );
    const last = candidates[candidates.length - 1];
    if (last !== undefined) {
      hits += 1;
      leads.push(onset.t - last.ts / 1000);
    }
  }
  // False alarm = the reducer's own "pre-arm stood down · unconfirmed" event,
  // unless a drift still arrived within 30 s of the stand-down.
  const falsePrearms = events.filter(
    (event) =>
      event.type === "forecast_clear" &&
      event.wasPrearmed &&
      !onsets.some((onset) => onset.t >= event.ts / 1000 && onset.t - event.ts / 1000 <= 30),
  ).length;
  return { drifts: onsets.length, hits, leads, falsePrearms, nudges };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();

  // --- Weights + parity + provenance guards --------------------------------
  const weights = parseForecastWeights(JSON.parse(readFileSync(config.weights, "utf8")));
  if (weights === null) {
    throw new Error(`${config.weights} failed parseForecastWeights — retrain first`);
  }
  const thresholds = await thresholdDefaults();
  if (weights.thresholds.nudge !== thresholds.nudge || weights.thresholds.prearm !== thresholds.prearm) {
    throw new Error(
      `operating-point parity violated: weights.thresholds {nudge ${weights.thresholds.nudge}, ` +
        `prearm ${weights.thresholds.prearm}} != ${thresholds.source} {nudge ${thresholds.nudge}, prearm ${thresholds.prearm}}`,
    );
  }
  const provenance = JSON.parse(
    readFileSync(join(forecastDataRoot(), PROVENANCE_FILE), "utf8"),
  ) as Record<string, unknown>;
  const provenanceSha = sha256Hex(canonicalJson(provenance));
  if (provenanceSha !== weights.trainProvenanceSha) {
    throw new Error(
      `provenance sha mismatch: weights carry ${weights.trainProvenanceSha.slice(0, 12)}…, ` +
        `data/forecast/provenance.json hashes to ${provenanceSha.slice(0, 12)}… — rerun train.ts`,
    );
  }

  // --- Load rows ------------------------------------------------------------
  const evalRows: EvalRow[] = [];
  const trainFeatures: number[][] = [];
  const trainLabels: number[] = [];
  for await (const row of readJsonl<DatasetRow>(config.data)) {
    if (row.split === "eval") {
      if (row.source !== "synthetic" && row.source !== "recorded") {
        throw new Error(
          `eval split contains ${row.source} row (${row.session_id}) — augmented data must be train-only`,
        );
      }
      evalRows.push({
        features: row.features,
        label: row.label,
        secsToDrift: row.secs_to_drift,
        archetype: row.archetype,
        sessionId: row.session_id,
      });
    } else {
      trainFeatures.push(row.features);
      trainLabels.push(row.label);
    }
  }
  if (evalRows.length === 0) {
    throw new Error("no eval rows — run build-dataset.ts first");
  }
  const evalBaseRate = evalRows.reduce((sum, row) => sum + row.label, 0) / evalRows.length;

  // --- MLP scores -----------------------------------------------------------
  const mlpScores = evalRows.map((row) => forward(weights, row.features).rawRisk);
  const mlpLabels = evalRows.map((row) => row.label);
  const overallAuc = rocAuc(mlpScores, mlpLabels);
  const overallPr = prAuc(mlpScores, mlpLabels);
  const mlpLead20 = leadAuc(evalRows, mlpScores, 20);
  const mlpLead10 = leadAuc(evalRows, mlpScores, 10);
  const calibrationTable = ece10(mlpScores, mlpLabels);

  // --- Baselines (trained on the train split, scored held-out) --------------
  // Deterministic stride subsample keeps the logistic fits fast.
  const cap = 40_000;
  const stride = Math.max(1, Math.ceil(trainFeatures.length / cap));
  const subX: number[][] = [];
  const subY: number[] = [];
  for (let i = 0; i < trainFeatures.length; i += stride) {
    subX.push(trainFeatures[i] as number[]);
    subY.push(trainLabels[i] as number);
  }

  const singleFeature: Array<{ key: string; auc: number; leadAuc20: number }> = [];
  let bestSingle = { key: "none", auc: 0.5, leadAuc20: 0.5 };
  for (let f = 0; f < FORECAST_FEATURE_KEYS.length; f += 1) {
    const model = trainLogistic(subX, subY, [f]);
    const scores = evalRows.map((row) => logisticScore(model, row.features, [f]));
    const entry = {
      key: FORECAST_FEATURE_KEYS[f] as string,
      auc: round4(rocAuc(scores, mlpLabels)),
      leadAuc20: round4(leadAuc(evalRows, scores, 20)),
    };
    singleFeature.push(entry);
    // Adversarial selection: the strongest single feature BY the gate metric.
    if (entry.leadAuc20 > bestSingle.leadAuc20) {
      bestSingle = entry;
    }
  }

  const allColumns = FORECAST_FEATURE_KEYS.map((_, i) => i);
  const fullLogistic = trainLogistic(subX, subY, allColumns);
  const fullLogisticScores = evalRows.map((row) => logisticScore(fullLogistic, row.features, allColumns));

  // The if-else strawman: count of fired rules (encoded-space thresholds for
  // "≥4 switches/15s", "≥15s grey dwell/30s", "desk presence < 40%").
  const ifElseScores = evalRows.map((row) => {
    let fired = 0;
    if ((row.features[0] ?? 0) >= 0.5) fired += 1;
    if ((row.features[6] ?? 0) >= 0.5) fired += 1;
    if ((row.features[10] ?? 0) < 0.4) fired += 1;
    return fired;
  });
  const greyDwellScores = evalRows.map((row) => row.features[6] ?? 0);

  const baselines = {
    baseRate: { auc: 0.5, leadAuc20: 0.5, note: "predict the prevalence everywhere" },
    ifElseHeuristic: {
      auc: round4(rocAuc(ifElseScores, mlpLabels)),
      leadAuc20: round4(leadAuc(evalRows, ifElseScores, 20)),
      note: "3-rule strawman: fast switching OR grey dwell OR low desk presence",
    },
    greyDwellHeuristic: {
      auc: round4(rocAuc(greyDwellScores, mlpLabels)),
      leadAuc20: round4(leadAuc(evalRows, greyDwellScores, 20)),
    },
    bestSingleFeatureLogistic: {
      feature: bestSingle.key,
      auc: bestSingle.auc,
      leadAuc20: bestSingle.leadAuc20,
      note: "gate baseline — feature chosen adversarially by held-out lead-censored AUC",
    },
    fullLogistic18: {
      auc: round4(rocAuc(fullLogisticScores, mlpLabels)),
      leadAuc20: round4(leadAuc(evalRows, fullLogisticScores, 20)),
    },
    mlp: { auc: round4(overallAuc), leadAuc20: round4(mlpLead20) },
    singleFeature,
  };

  // --- Per-feature occlusion ablation (subsampled, deterministic) -----------
  const ablationStride = Math.max(1, Math.ceil(evalRows.length / 20_000));
  const ablationRows: EvalRow[] = [];
  for (let i = 0; i < evalRows.length; i += ablationStride) {
    ablationRows.push(evalRows[i] as EvalRow);
  }
  const ablationBaseScores = ablationRows.map((row) => forward(weights, row.features).rawRisk);
  const ablationBase = leadAuc(ablationRows, ablationBaseScores, 20);
  const ablation = FORECAST_FEATURE_KEYS.map((key, f) => {
    const scores = ablationRows.map((row) => {
      const probe = [...row.features];
      probe[f] = weights.norm.mean[f] ?? 0;
      return forward(weights, probe).rawRisk;
    });
    return { key, leadAuc20Drop: round4(ablationBase - leadAuc(ablationRows, scores, 20)) };
  }).sort((a, b) => b.leadAuc20Drop - a.leadAuc20Drop);

  // --- Alarm simulation over held-out RAW sessions ---------------------------
  const escalationSettings: EscalationSettings = {
    nudgeRisk: thresholds.nudge,
    prearmRisk: thresholds.prearm,
    prearmEnabled: true,
    prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  };
  const totals = newAlarmTotals();
  const byArchetype = new Map<string, AlarmTotals>();
  for await (const session of readJsonl<RawSession>(config.raw)) {
    if (session.source !== "synthetic" || splitForSession(session.id, config.seed) !== "eval") {
      continue;
    }
    const result = simulateAlarms(session, weights, escalationSettings);
    const bucket = byArchetype.get(session.archetype) ?? newAlarmTotals();
    for (const target of [totals, bucket]) {
      target.drifts += result.drifts;
      target.hits += result.hits;
      target.leads.push(...result.leads);
      target.falsePrearms += result.falsePrearms;
      target.nudges += result.nudges;
      target.hours += session.durationSec / 3600;
      target.sessions += 1;
    }
    byArchetype.set(session.archetype, bucket);
  }
  totals.leads.sort((a, b) => a - b);
  const medianLead = percentile(totals.leads, 0.5);
  const p25Lead = percentile(totals.leads, 0.25);

  // --- Per-archetype frame slices (research_churn is the load-bearing one) --
  const archetypes = [...new Set(evalRows.map((row) => row.archetype))].sort();
  const perArchetype: Record<string, unknown> = {};
  for (const archetype of archetypes) {
    const indices = evalRows
      .map((row, i) => ({ row, i }))
      .filter((entry) => entry.row.archetype === archetype);
    const negatives = indices.filter((entry) => entry.row.label === 0);
    const fpNudge =
      negatives.length > 0
        ? negatives.filter((entry) => (mlpScores[entry.i] as number) >= thresholds.nudge).length /
          negatives.length
        : 0;
    const fpPrearm =
      negatives.length > 0
        ? negatives.filter((entry) => (mlpScores[entry.i] as number) >= thresholds.prearm).length /
          negatives.length
        : 0;
    const alarms = byArchetype.get(archetype);
    perArchetype[archetype] = {
      sessions: alarms?.sessions ?? 0,
      frames: indices.length,
      baseRate: round4(
        indices.reduce((sum, entry) => sum + entry.row.label, 0) / Math.max(1, indices.length),
      ),
      falsePositiveRateAtNudge: round4(fpNudge),
      falsePositiveRateAtPrearm: round4(fpPrearm),
      falsePrearmsPerHour: alarms && alarms.hours > 0 ? round4(alarms.falsePrearms / alarms.hours) : 0,
      drifts: alarms?.drifts ?? 0,
      hits: alarms?.hits ?? 0,
    };
  }
  if (!archetypes.includes("research_churn")) {
    throw new Error("eval split has no research_churn frames — the anti-if-else slice is empty");
  }

  // --- Gate ------------------------------------------------------------------
  const margin = mlpLead20 - bestSingle.leadAuc20;
  const gatePassed = margin >= GATE_MARGIN;
  const gate = {
    enforced: !config.gateOff,
    metric: "lead-censored ROC-AUC (onset ≥ 20 s away vs calm)",
    marginRequired: GATE_MARGIN,
    mlpLeadAuc20: round4(mlpLead20),
    baselineLeadAuc20: bestSingle.leadAuc20,
    baselineFeature: bestSingle.key,
    margin: round4(margin),
    passed: gatePassed,
  };

  const manifest = (provenance as { manifest?: { createdAt?: string } }).manifest;
  const report = {
    version: FORECAST_MODEL_VERSION,
    createdAt: manifest?.createdAt ?? "unknown",
    status: "trained",
    gate,
    metrics: {
      rocAuc: round4(overallAuc),
      prAuc: round4(overallPr),
      baseRate: round4(evalBaseRate),
      aucLead20: round4(mlpLead20),
      aucLead10: round4(mlpLead10),
      ece: round4(calibrationTable.ece),
      evalFrames: evalRows.length,
      evalSessions: new Set(evalRows.map((row) => row.sessionId)).size,
    },
    reliability: calibrationTable.bins,
    operatingPoints: {
      nudge: operatingPoint(evalRows, mlpScores, thresholds.nudge),
      prearm: operatingPoint(evalRows, mlpScores, thresholds.prearm),
    },
    alarms: {
      recallAt30: totals.drifts > 0 ? round4(totals.hits / totals.drifts) : null,
      medianLeadSec: medianLead === null ? null : round4(medianLead),
      p25LeadSec: p25Lead === null ? null : round4(p25Lead),
      falsePrearmsPerHour: totals.hours > 0 ? round4(totals.falsePrearms / totals.hours) : null,
      nudgesPerHour: totals.hours > 0 ? round4(totals.nudges / totals.hours) : null,
      drifts: totals.drifts,
      hits: totals.hits,
      misses: totals.drifts - totals.hits,
      evalHours: round4(totals.hours),
      settings: {
        nudgeRisk: thresholds.nudge,
        prearmRisk: thresholds.prearm,
        prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
        baseFuseSec: DEFAULT_SETTINGS.countdownSec,
      },
    },
    baselines,
    perArchetype,
    ablation,
    thresholdParity: {
      nudge: thresholds.nudge,
      prearm: thresholds.prearm,
      source: thresholds.source,
    },
    provenanceSha,
    provenance,
  };
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`);

  // --- Console summary --------------------------------------------------------
  console.log(
    `eval frames ${evalRows.length} (${(evalBaseRate * 100).toFixed(1)}% positive) over ` +
      `${report.metrics.evalSessions} held-out sessions | ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  console.log(
    `MLP: ROC-AUC ${round4(overallAuc)} | PR-AUC ${round4(overallPr)} @ base ${round4(evalBaseRate)} | ` +
      `lead≥20s ${round4(mlpLead20)} | lead≥10s ${round4(mlpLead10)} | ECE ${round4(calibrationTable.ece)}`,
  );
  console.log(
    `baselines (lead≥20s): if-else ${baselines.ifElseHeuristic.leadAuc20} | grey-dwell ${baselines.greyDwellHeuristic.leadAuc20} | ` +
      `best single (${bestSingle.key}) ${bestSingle.leadAuc20} | full logistic ${baselines.fullLogistic18.leadAuc20}`,
  );
  console.log(
    `alarms @ nudge ${thresholds.nudge}/prearm ${thresholds.prearm}: recall@30s ${report.alarms.recallAt30} | ` +
      `median lead ${report.alarms.medianLeadSec}s (p25 ${report.alarms.p25LeadSec}s) | ` +
      `false pre-arms/h ${report.alarms.falsePrearmsPerHour} over ${report.alarms.evalHours}h`,
  );
  const churn = perArchetype["research_churn"] as { falsePositiveRateAtNudge: number; falsePositiveRateAtPrearm: number };
  console.log(
    `research_churn slice: FPR@nudge ${churn.falsePositiveRateAtNudge} | FPR@prearm ${churn.falsePositiveRateAtPrearm}`,
  );
  console.log(`report → ${config.out}`);

  if (!gatePassed && !config.gateOff) {
    console.error(
      `GATE FAILED: MLP lead≥20s AUC ${round4(mlpLead20)} must beat best single-feature logistic ` +
        `(${bestSingle.key}, ${bestSingle.leadAuc20}) by ≥ ${GATE_MARGIN} — margin ${round4(margin)}`,
    );
    process.exitCode = 1;
    return;
  }
  if (!gatePassed && config.gateOff) {
    console.warn(
      `gate bypassed (--gate=off) with margin ${round4(margin)} < ${GATE_MARGIN} — report stamped enforced:false`,
    );
  }
  console.log(
    gatePassed
      ? `gate PASSED: margin ${round4(margin)} ≥ ${GATE_MARGIN} over '${bestSingle.key}'`
      : "gate skipped",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
