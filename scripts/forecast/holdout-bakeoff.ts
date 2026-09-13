import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";
import type { EscalationSettings } from "../../src/shared/forecast/escalate";
import {
  CHURN_FPR_CEILING,
  CONTRACT_PREARM_FUSE_SEC,
  ece10,
  forecastDataRoot,
  prAuc,
  percentile,
  repoRoot,
  rocAuc,
  round4,
  round6,
  stringArg,
  thresholdDefaults,
} from "./lib";
import { pairedClusterBootstrap, type BootstrapModel } from "./bootstrap";
import { bootstrapAll, pairsAgainst, perModelCi, type PerModel } from "./holdout-bakeoff/boot";
import {
  OLD_DIM,
  SHIPPED_DIM,
  WIDTH,
  loadHoldoutCorpus,
  loadTrainRows,
  runAlarms,
  type Corpus,
  type SessionMeta,
  type TrainRows,
} from "./holdout-bakeoff/corpus";
import { fitFamilies, type FittedModel } from "./holdout-bakeoff/families";

/**
 * THE HOLD-OUT BAKE-OFF — every contender, refit on train-split rows only,
 * scored on the 900-session / 1 230-onset power corpus.
 *
 * Round 8 ran five model families on 48 held-out sessions and could not
 * separate them: the paired session-clustered SE was ≈ 0.009 and every
 * non-linear margin was 0.4–0.7 of one SE. "The neural net did not win" was an
 * underpowered shrug. This script is the re-run with the power to decide it,
 * and it answers a second question round 9 raised: how much of any margin is
 * the ARCHITECTURE and how much is the six trend FEATURES. So every family is
 * fitted TWICE — once on the 18-feature basis the bake-off ran on, once on the
 * 24-feature basis that ships today — and the two columns sit side by side.
 *
 *   npm run forecast:holdout:bakeoff
 *
 * Protocol, and the three things a hostile reader checks first:
 *
 *  1. NO TEST-SET CONTAMINATION. Every fit, every early stop, every λ, every
 *     Platt calibration and every fold split reads `split:"train"` rows of
 *     `dataset.jsonl` and nothing else. Not one hold-out frame enters any of
 *     them. The operating point is the SHIPPED 0.45/0.80, derived by train.ts
 *     on cross-fitted TRAIN sessions and copied here unchanged — it is not
 *     re-searched on this corpus. The hold-out ids are re-checked
 *     (`isHoldoutSessionId`) on both sides before a single row is read.
 *  2. IDENTICAL FRAMES. One replay through the shared core produces the
 *     features, decisions, censoring and onsets; every model is scored on that
 *     one array (`holdout-bakeoff/corpus.ts`), and the row/onset counts are
 *     asserted equal to the published `holdout-manifest.json`.
 *  3. ONE COMMON HIT RULE. Recall@30 s is "the shipped `stepEscalation`
 *     reducer actually EMITTED a forecast_nudge or forecast_prearm event inside
 *     (onset − 30 s, onset]". The adjudicator caught the round-8 table mixing
 *     this with a looser "band was elevated at some tick" rule (temporal
 *     submitted 0.8718 loose against four contenders' 0.8333 strict), so both
 *     are computed here for every model and the gap is published.
 *
 * Uncertainty is a paired session-clustered bootstrap (2 000 draws over the 900
 * hold-out sessions, IDENTICAL resamples across models) — `bootstrap.ts`, the
 * same estimator the adjudicator used, which asserts itself equal to
 * `lib.rocAuc` at unit weights before any draw is taken.
 */

interface Config {
  out: string;
  draws: number;
  only: string;
  timingIters: number;
  /** Ignore the score cache and refit every family from scratch. */
  refit: boolean;
}

/** Accepts both `--flag value` and `--flag=value` (lib.stringArg only does the first). */
function arg(flag: string, fallback: string): string {
  const inline = process.argv.find((entry) => entry.startsWith(`${flag}=`));
  if (inline !== undefined) {
    return inline.slice(flag.length + 1);
  }
  return stringArg(flag, fallback);
}

function argNumber(flag: string, fallback: number): number {
  const parsed = Number(arg(flag, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readConfig(): Config {
  return {
    out: arg("--out", join(forecastDataRoot(), "holdout", "bakeoff-holdout.json")),
    draws: Math.max(0, Math.round(argNumber("--draws", 2000))),
    only: arg("--only", ""),
    timingIters: Math.max(100, Math.round(argNumber("--timing-iters", 20_000))),
    refit: process.argv.includes("--refit"),
  };
}

// ---------------------------------------------------------------------------
// Score cache — fitting the whole field costs ~40 min, so a crash in one family
// must not throw away the others. Each model's per-FRAME calibrated risk and
// its recipe block are written under data/forecast/holdout/bakeoff-cache/ as
// soon as it is scored, and reused on the next run unless --refit is passed.
// The cache is keyed by model name and invalidated by frame count, so it can
// never be read against a different corpus.
// ---------------------------------------------------------------------------

interface CacheMeta {
  name: string;
  family: string;
  basis: string;
  featureDim: number;
  params: number;
  paramsNote: string | null;
  recipe: Record<string, unknown>;
  microsPerTick: number;
  frames: number;
}

function cacheDir(): string {
  const dir = join(forecastDataRoot(), "holdout", "bakeoff-cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheKey(name: string): string {
  return name.replace(/[^A-Za-z0-9_.+-]/g, "_");
}

function readCache(name: string, frames: number): { meta: CacheMeta; risk: Float64Array } | null {
  const base = join(cacheDir(), cacheKey(name));
  if (!existsSync(`${base}.json`) || !existsSync(`${base}.bin`)) {
    return null;
  }
  const meta = JSON.parse(readFileSync(`${base}.json`, "utf8")) as CacheMeta;
  if (meta.frames !== frames || meta.name !== name) {
    return null;
  }
  const buffer = readFileSync(`${base}.bin`);
  if (buffer.byteLength !== frames * 8) {
    return null;
  }
  // Copy rather than view: a pooled Buffer can land on a non-8-byte offset.
  const risk = new Float64Array(frames);
  for (let i = 0; i < frames; i += 1) {
    risk[i] = buffer.readDoubleLE(i * 8);
  }
  return { meta, risk };
}

function writeCache(meta: CacheMeta, risk: Float64Array): void {
  const base = join(cacheDir(), cacheKey(meta.name));
  writeFileSync(`${base}.bin`, Buffer.from(risk.buffer, risk.byteOffset, risk.byteLength));
  writeFileSync(`${base}.json`, `${JSON.stringify(meta, null, 2)}\n`);
}

/** Re-applies the mechanical transform that produced `holdout-bakeoff/gbdt-nd.ts`. */
function verifyGbdtCopy(): string {
  const source = readFileSync(
    join(repoRoot(), "scripts", "forecast", "candidates", "trees", "gbdt.ts"),
    "utf8",
  );
  const copy = readFileSync(
    join(repoRoot(), "scripts", "forecast", "holdout-bakeoff", "gbdt-nd.ts"),
    "utf8",
  );
  // Both files are compared from their FIRST CODE LINE onwards, so the two
  // differing header comments are excluded and nothing else can be.
  const bodyFrom = (text: string, importLine: string): string => {
    const lines = text.split("\n");
    const at = lines.indexOf(importLine);
    if (at < 0) {
      throw new Error(`cannot find "${importLine}" — the GBDT copy check needs rewriting`);
    }
    return lines.slice(at).join("\n");
  };
  const expected = bodyFrom(source, 'import { mulberry32 } from "../../lib";')
    .replace(
      'import { mulberry32 } from "../../lib";',
      'import { mulberry32 } from "../lib";',
    )
    .replace(
      "export const N_FEATURES = 18;",
      "export let N_FEATURES = 18;\nexport function setGbdtFeatureWidth(n: number): void {\n  N_FEATURES = n;\n}",
    );
  const actual = bodyFrom(copy, 'import { mulberry32 } from "../lib";');
  if (actual !== expected) {
    throw new Error(
      "holdout-bakeoff/gbdt-nd.ts is no longer the mechanical transform of candidates/trees/gbdt.ts — " +
        "regenerate it (see the header of that file) before publishing any GBDT number",
    );
  }
  return `gbdt-nd.ts verified == candidates/trees/gbdt.ts + 2 mechanical edits (${expected.length} bytes)`;
}

// ---------------------------------------------------------------------------
// Metrics on the hold-out rows
// ---------------------------------------------------------------------------

interface RowView {
  /** Frame index per surviving row. */
  idx: Int32Array;
  label: Uint8Array;
  secs: Float64Array;
  archetypeOf: Int32Array;
  archetypes: string[];
  sessionOf: Int32Array;
  sessions: number;
}

function buildRowView(corpus: Corpus): RowView {
  const n = corpus.rowIdx.length;
  const label = new Uint8Array(n);
  const secs = new Float64Array(n);
  const archetypes: string[] = [];
  const archetypeIndex = new Map<string, number>();
  const archetypeOf = new Int32Array(n);
  for (let k = 0; k < n; k += 1) {
    const i = corpus.rowIdx[k] as number;
    label[k] = corpus.label[i] as number;
    secs[k] = corpus.secs[i] as number;
    const session = corpus.sessions[corpus.rowSession[k] as number] as SessionMeta;
    let a = archetypeIndex.get(session.archetype);
    if (a === undefined) {
      a = archetypes.length;
      archetypeIndex.set(session.archetype, a);
      archetypes.push(session.archetype);
    }
    archetypeOf[k] = a;
  }
  return {
    idx: corpus.rowIdx,
    label,
    secs,
    archetypeOf,
    archetypes,
    sessionOf: corpus.rowSession,
    sessions: corpus.sessions.length,
  };
}

function leadEligible(secs: number, leadSec: number): boolean {
  return Number.isNaN(secs) || secs >= leadSec;
}

function leadAuc(view: RowView, scores: Float64Array, leadSec: number): number {
  const s: number[] = [];
  const y: number[] = [];
  for (let k = 0; k < scores.length; k += 1) {
    if (leadEligible(view.secs[k] as number, leadSec)) {
      s.push(scores[k] as number);
      y.push(view.label[k] as number);
    }
  }
  return rocAuc(s, y);
}

/** research_churn FRAME false-positive rate at a nudge threshold (the ≤ 0.01 ceiling). */
function churnFpr(view: RowView, scores: Float64Array, threshold: number): number {
  const churn = view.archetypes.indexOf("research_churn");
  if (churn < 0) {
    throw new Error("hold-out corpus has no research_churn frames — the anti-if-else slice is empty");
  }
  let fp = 0;
  let negatives = 0;
  for (let k = 0; k < scores.length; k += 1) {
    if ((view.archetypeOf[k] as number) !== churn || (view.label[k] as number) === 1) {
      continue;
    }
    negatives += 1;
    if ((scores[k] as number) >= threshold) {
      fp += 1;
    }
  }
  return negatives > 0 ? fp / negatives : 0;
}

function framePoint(
  view: RowView,
  scores: Float64Array,
  threshold: number,
): { threshold: number; precision: number | null; recall: number; fpr: number } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let k = 0; k < scores.length; k += 1) {
    const fired = (scores[k] as number) >= threshold;
    if ((view.label[k] as number) === 1) {
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

/**
 * The operating point every model is scored at.
 *
 * Default: the SHIPPED point (nudge 0.45 / pre-arm 0.80), which train.ts
 * derived on 3-fold cross-fitted TRAIN sessions and which is NOT re-derived
 * here — re-searching a threshold on the corpus a recall number is then read
 * off is exactly the contamination this whole exercise refuses. Every model in
 * the field is Platt-calibrated to the same probability scale, so the same cut
 * is the comparable cut.
 *
 * The brief's only constraint on it is `research_churn` frame FPR ≤ 0.01. If a
 * model violates that at the shipped threshold its nudge line is raised along a
 * fixed grid until it complies, and the report says so for that model — a
 * penalty, never a search for more recall.
 */
const THRESHOLD_GRID = [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];

/** Resampling seed — fixed, and the same constant `eval.ts --holdout` uses. */
const BOOTSTRAP_SEED = 20260913;

function admissibleNudge(
  view: RowView,
  scores: Float64Array,
  shippedNudge: number,
): { nudge: number; churnFpr: number; raised: boolean } {
  const atShipped = churnFpr(view, scores, shippedNudge);
  if (atShipped <= CHURN_FPR_CEILING) {
    return { nudge: shippedNudge, churnFpr: atShipped, raised: false };
  }
  for (const candidate of THRESHOLD_GRID) {
    if (candidate <= shippedNudge) {
      continue;
    }
    const value = churnFpr(view, scores, candidate);
    if (value <= CHURN_FPR_CEILING) {
      return { nudge: candidate, churnFpr: value, raised: true };
    }
  }
  const last = THRESHOLD_GRID[THRESHOLD_GRID.length - 1] as number;
  return { nudge: last, churnFpr: churnFpr(view, scores, last), raised: true };
}

/** Wall-clock microseconds for one 1 Hz inference tick, measured here. */
function measureTick(model: FittedModel, corpus: Corpus, iterations: number): number {
  if (model.measureMicros !== undefined) {
    // Sequence models do not eat the frame vector; they time their own real
    // forward over a real 120 s window.
    return model.measureMicros(Math.min(iterations, 3000));
  }
  const probe = new Float64Array(WIDTH);
  const stride = Math.max(1, Math.floor(corpus.totalFrames / iterations));
  // Warm-up (JIT), then the timed loop, both over real frames.
  let sink = 0;
  for (let k = 0; k < Math.min(2000, iterations); k += 1) {
    const frame = (k * stride) % corpus.totalFrames;
    probe.set(corpus.feats.subarray(frame * WIDTH, frame * WIDTH + WIDTH));
    sink += model.scoreFrame(probe, 0, frame);
  }
  const started = process.hrtime.bigint();
  for (let k = 0; k < iterations; k += 1) {
    const frame = (k * stride) % corpus.totalFrames;
    probe.set(corpus.feats.subarray(frame * WIDTH, frame * WIDTH + WIDTH));
    sink += model.scoreFrame(probe, 0, frame);
  }
  const elapsed = Number(process.hrtime.bigint() - started);
  if (!Number.isFinite(sink)) {
    throw new Error(`${model.name} produced a non-finite risk while timing`);
  }
  return elapsed / iterations / 1000;
}

interface Scored {
  model: FittedModel;
  /** Calibrated risk for EVERY hold-out frame (the alarm sim needs all of them). */
  risk: Float64Array;
  /** Calibrated risk for the surviving rows only, in `corpus.rowIdx` order. */
  rowRisk: Float64Array;
}

function scoreModel(model: FittedModel, corpus: Corpus, log: (m: string) => void): Scored {
  const started = Date.now();
  const risk = new Float64Array(corpus.totalFrames);
  for (let frame = 0; frame < corpus.totalFrames; frame += 1) {
    risk[frame] = model.scoreFrame(corpus.feats, frame * WIDTH, frame);
  }
  const rowRisk = new Float64Array(corpus.rowIdx.length);
  for (let k = 0; k < corpus.rowIdx.length; k += 1) {
    rowRisk[k] = risk[corpus.rowIdx[k] as number] as number;
  }
  for (let k = 0; k < rowRisk.length; k += 1) {
    const value = rowRisk[k] as number;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${model.name} produced risk ${value} at row ${k} — refusing to publish it`);
    }
  }
  log(`  scored ${model.name.padEnd(28)} ${corpus.totalFrames} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return { model, risk, rowRisk };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  const log = (message: string): void => {
    console.log(message);
  };

  const gbdtCheck = verifyGbdtCopy();
  log(gbdtCheck);
  if (config.only === "verify-gbdt-copy") {
    return;
  }

  const thresholds = await thresholdDefaults();
  const escalation: EscalationSettings = {
    nudgeRisk: thresholds.nudge,
    prearmRisk: thresholds.prearm,
    prearmEnabled: true,
    prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  };

  log("loading TRAIN rows (dataset.jsonl split:\"train\" only) + replaying their raw sessions …");
  const train: TrainRows = await loadTrainRows(log);
  log("replaying the hold-out corpus …");
  const { corpus, manifest } = await loadHoldoutCorpus(log);
  const view = buildRowView(corpus);

  log(`fitting every family on TRAIN rows only (${OLD_DIM}-basis and ${SHIPPED_DIM}-basis) …`);
  const models = await fitFamilies(train, corpus, {
    only: config.only,
    log,
    cached: (name) => {
      if (config.refit) {
        return null;
      }
      const hit = readCache(name, corpus.totalFrames);
      if (hit === null) {
        return null;
      }
      const risk = hit.risk;
      return {
        name: hit.meta.name,
        family: hit.meta.family,
        basis: hit.meta.basis,
        featureDim: hit.meta.featureDim,
        params: hit.meta.params,
        ...(hit.meta.paramsNote === null ? {} : { paramsNote: hit.meta.paramsNote }),
        recipe: hit.meta.recipe,
        scoreFrame: (_feats, _offset, frame) => risk[frame] as number,
        measureMicros: () => hit.meta.microsPerTick,
      };
    },
  });

  // Score and measure one model at a time: the per-FRAME risk vector is 13 MB
  // and only the alarm simulation needs it, so it is dropped as soon as that
  // model's alarms are done and only the per-ROW vector is kept for the
  // bootstrap.
  const scored: Array<{ name: string; rowRisk: Float64Array }> = [];

  // --- per-model metrics -----------------------------------------------------
  const labels = Array.from(view.label);
  const table: Array<Record<string, unknown>> = [];
  for (const model of models) {
    const { risk, rowRisk } = scoreModel(model, corpus, log);
    scored.push({ name: model.name, rowRisk });
    const scores = Array.from(rowRisk);
    const point = admissibleNudge(view, rowRisk, thresholds.nudge);
    const settings: EscalationSettings = { ...escalation, nudgeRisk: point.nudge };
    const { totals, byArchetype } = runAlarms(corpus, risk, settings);
    const eventLeads = [...totals.eventLeads].sort((a, b) => a - b);
    const prearmLeads = [...totals.prearmLeads].sort((a, b) => a - b);
    const perArchetype: Record<string, unknown> = {};
    for (const [archetype, bucket] of [...byArchetype.entries()].sort()) {
      perArchetype[archetype] = {
        sessions: bucket.sessions,
        drifts: bucket.drifts,
        eventHits: bucket.eventHits,
        prearmHits: bucket.prearmHits,
        nudgesPerHour: bucket.hours > 0 ? round4(bucket.nudges / bucket.hours) : 0,
        falsePrearmsPerHour: bucket.hours > 0 ? round4(bucket.falsePrearms / bucket.hours) : 0,
      };
    }
    const row = {
      model: model.name,
      family: model.family,
      basis: model.basis,
      featureDim: model.featureDim,
      params: model.params,
      paramsNote: model.paramsNote ?? null,
      aucLead20: round6(leadAuc(view, rowRisk, 20)),
      aucLead10: round6(leadAuc(view, rowRisk, 10)),
      rocAuc: round6(rocAuc(scores, labels)),
      prAuc: round6(prAuc(scores, labels)),
      ece: round6(ece10(scores, labels).ece),
      operatingPoint: {
        nudge: point.nudge,
        prearm: thresholds.prearm,
        raisedForChurnCeiling: point.raised,
        fprResearchChurnAtNudge: round6(point.churnFpr),
        frameNudge: framePoint(view, rowRisk, point.nudge),
        framePrearm: framePoint(view, rowRisk, thresholds.prearm),
      },
      alarms: {
        drifts: totals.drifts,
        recallAt30Event: totals.drifts > 0 ? round6(totals.eventHits / totals.drifts) : null,
        eventHits: totals.eventHits,
        recallAt30Prearm: totals.drifts > 0 ? round6(totals.prearmHits / totals.drifts) : null,
        prearmHits: totals.prearmHits,
        recallAt30LooseBandRule: totals.drifts > 0 ? round6(totals.escalatedAtOnset / totals.drifts) : null,
        medianEventLeadSec: percentile(eventLeads, 0.5),
        medianPrearmLeadSec: percentile(prearmLeads, 0.5),
        p25PrearmLeadSec: percentile(prearmLeads, 0.25),
        nudgesPerHour: totals.hours > 0 ? round4(totals.nudges / totals.hours) : null,
        falsePrearmsPerHour: totals.hours > 0 ? round4(totals.falsePrearms / totals.hours) : null,
        hours: round4(totals.hours),
      },
      perArchetype,
      microsPerTick: round4(measureTick(model, corpus, config.timingIters)),
      recipe: model.recipe,
    };
    table.push(row);
    writeCache(
      {
        name: model.name,
        family: model.family,
        basis: model.basis,
        featureDim: model.featureDim,
        params: model.params,
        paramsNote: model.paramsNote ?? null,
        recipe: model.recipe,
        microsPerTick: row.microsPerTick as number,
        frames: corpus.totalFrames,
      },
      risk,
    );
    log(
      `  ${model.name.padEnd(28)} lead≥20 ${(row.aucLead20 as number).toFixed(4)} | ROC ${(row.rocAuc as number).toFixed(4)} | ` +
        `PR ${(row.prAuc as number).toFixed(4)} | ECE ${(row.ece as number).toFixed(4)} | ` +
        `recall@30s ${String(row.alarms.recallAt30Event)} (${totals.eventHits}/${totals.drifts}) | ` +
        `churnFPR ${round6(point.churnFpr)} | ${row.params}p | ${row.microsPerTick}µs`,
    );
  }

  // --- paired session-clustered bootstrap ------------------------------------
  const eligible: number[] = [];
  for (let k = 0; k < view.label.length; k += 1) {
    if (leadEligible(view.secs[k] as number, 20)) {
      eligible.push(k);
    }
  }
  const bootLabel = new Uint8Array(eligible.length);
  const bootCluster = new Int32Array(eligible.length);
  for (let j = 0; j < eligible.length; j += 1) {
    const k = eligible[j] as number;
    bootLabel[j] = view.label[k] as number;
    bootCluster[j] = view.sessionOf[k] as number;
  }
  const bootModels: BootstrapModel[] = scored.map((entry) => ({
    name: entry.name,
    scores: Float64Array.from(eligible, (k) => entry.rowRisk[k] as number),
  }));

  // The reference is the question the brief asks: "is the best non-linear model
  // decisively better than PLAIN LOGISTIC REGRESSION?" — so the reference is the
  // plain additive logistic on the basis that ships. A second pass re-references
  // the same draws (same fixed seed ⇒ identical resamples) to the 18-feature
  // plain logistic, which is what separates FEATURES from ARCHITECTURE.
  const referenceNames = arg(
    "--refs",
    [
      // The brief's question: "is the best non-linear model decisively better
      // than PLAIN LOGISTIC REGRESSION?" — so the primary reference is the
      // plain additive logistic on the basis that ships.
      `lr${SHIPPED_DIM}`,
      // The same question on the basis the round-8 bake-off ran on. The two
      // together separate FEATURES from ARCHITECTURE.
      `lr${OLD_DIM}`,
      // The strongest LINEAR model, and the head round 8 shipped.
      `lr${OLD_DIM}+pairwise`,
      // The head that ships TODAY.
      `lr${SHIPPED_DIM}+pairwise`,
      // The winners, so "does anything else tie the winner?" is answerable.
      `mlp-tuned${OLD_DIM}`,
      `mlp-tuned${SHIPPED_DIM}`,
    ].join(","),
  )
    .split(",")
    .map((name) => name.trim())
    .filter((name) => bootModels.some((model) => model.name === name));
  const bootstraps: Array<Record<string, unknown>> = [];
  let crossCheck: Record<string, unknown> | null = null;
  let perModel: PerModel[] = [];
  if (config.draws > 0) {
    log(
      `paired session-clustered bootstrap: ${config.draws} draws over ${corpus.sessions.length} sessions / ` +
        `${eligible.length} lead≥20s-eligible frames, ONE draw matrix shared by every reference …`,
    );
    const matrix = bootstrapAll(
      bootLabel,
      bootCluster,
      corpus.sessions.length,
      bootModels,
      config.draws,
      // Fixed, and deliberately not the corpus seed: the resampling stream must
      // not move when the corpus seed does. Same constant eval.ts --holdout uses.
      BOOTSTRAP_SEED,
      (done, total) => {
        if (done % 200 === 0) {
          log(`  bootstrap ${done}/${total} … ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
        }
      },
    );
    perModel = perModelCi(matrix);
    for (const reference of referenceNames) {
      const pairs = pairsAgainst(matrix, reference);
      bootstraps.push({
        reference,
        draws: matrix.draws,
        clusteredBy: "held-out session",
        clusters: matrix.clusters,
        eligibleRows: matrix.eligibleRows,
        eligiblePositives: matrix.eligiblePositives,
        estimatorCheck: matrix.estimatorCheck,
        perModel,
        pairs,
      });
      log(`  vs ${reference}:`);
      for (const pair of pairs) {
        log(
          `    ${pair.model.padEnd(28)} ${pair.diff >= 0 ? "+" : ""}${pair.diff.toFixed(4)} ` +
            `[${pair.lo95 >= 0 ? "+" : ""}${pair.lo95.toFixed(4)}, ${pair.hi95 >= 0 ? "+" : ""}${pair.hi95.toFixed(4)}] ` +
            `sd ${pair.sd.toFixed(4)} p(≤0) ${pair.pDiffLeZero.toFixed(3)}`,
        );
      }
    }

    // Independent cross-check: re-run the SHARED implementation
    // (scripts/forecast/bootstrap.ts, the one the adjudicator and
    // `eval.ts --holdout` use) for a small number of draws and require the two
    // to agree. Same PRNG, same seed, same procedure ⇒ the same resamples, so
    // the per-model CIs over those draws must match to floating-point noise.
    const checkDraws = Math.min(config.draws, 100);
    log(`cross-checking against scripts/forecast/bootstrap.ts on ${checkDraws} draws …`);
    const shared = pairedClusterBootstrap(
      bootLabel,
      bootCluster,
      corpus.sessions.length,
      bootModels,
      referenceNames[0] as string,
      checkDraws,
      BOOTSTRAP_SEED,
    );
    const mineShort = perModelCi({ ...matrix, draws: checkDraws, drawn: matrix.drawn.map((d) => d.slice(0, checkDraws)) });
    let worst = 0;
    for (const entry of shared.perModel) {
      const other = mineShort.find((row) => row.model === entry.model);
      if (other === undefined) {
        throw new Error(`cross-check missing model ${entry.model}`);
      }
      worst = Math.max(
        worst,
        Math.abs(entry.point - other.point),
        Math.abs(entry.lo95 - other.lo95),
        Math.abs(entry.hi95 - other.hi95),
        Math.abs(entry.sd - other.sd),
      );
    }
    if (worst > 1e-6) {
      throw new Error(
        `the fast bootstrap disagrees with scripts/forecast/bootstrap.ts by ${worst} over ${checkDraws} draws`,
      );
    }
    crossCheck = {
      against: "scripts/forecast/bootstrap.ts (pairedClusterBootstrap)",
      draws: checkDraws,
      worstAbsoluteDifference: worst,
      note:
        "same PRNG, same seed, same resampling order ⇒ identical draws; the fast path only pre-sorts " +
        "the cluster/label vectors alongside the scores",
    };
    log(`  cross-check OK — worst |Δ| ${worst.toExponential(2)} over ${checkDraws} draws`);
  }

  const ciOf = new Map(perModel.map((entry) => [entry.model, entry]));
  for (const row of table) {
    const ci = ciOf.get(row["model"] as string);
    row["ci95"] = ci === undefined ? null : { lo: ci.lo95, hi: ci.hi95, sd: ci.sd };
  }

  const report = {
    createdBy: "scripts/forecast/holdout-bakeoff.ts",
    command: "npm run forecast:holdout:bakeoff",
    question:
      "on a corpus large enough to decide it, is any non-linear family better than a plain logistic " +
      "regression on the same features — and how much of any margin is the ARCHITECTURE versus the " +
      "six trend FEATURES added in GAUNTLET round 9?",
    corpus: {
      kind: "holdout-power-corpus",
      regenerate: "npm run forecast:evalset",
      sessions: corpus.sessions.length,
      frames: corpus.totalFrames,
      rows: corpus.rowIdx.length,
      leadEligible20: eligible.length,
      leadEligible20Positives: Array.from(bootLabel).reduce<number>((sum, y) => sum + y, 0),
      manifest,
    },
    protocol: {
      fitting:
        "every model refit on split:\"train\" rows of data/forecast/dataset.jsonl ONLY, with its own " +
        "already-tuned recipe from scripts/forecast/candidates/**. No hyper-parameter, no early stop, " +
        "no calibration and no fold split consulted a hold-out frame.",
      operatingPoint:
        `nudge ${thresholds.nudge} / pre-arm ${thresholds.prearm} — the SHIPPED point train.ts derived on ` +
        "3-fold cross-fitted TRAIN sessions, copied here unchanged and never re-searched on this corpus. " +
        `A model whose research_churn frame FPR exceeds ${CHURN_FPR_CEILING} at that cut has its nudge line ` +
        "raised along a fixed grid until it complies (a penalty; flagged per model).",
      hitRule:
        "recallAt30Event — the shipped stepEscalation reducer EMITTED a forecast_nudge or forecast_prearm " +
        "event inside (onset − 30 s, onset]. ONE rule for every model. recallAt30LooseBandRule (band ≠ calm " +
        "at onset − 1 s, no event required) is printed beside it because the round-8 table mixed the two.",
      uncertainty:
        `paired session-clustered bootstrap, ${config.draws} draws over the ${corpus.sessions.length} hold-out ` +
        `sessions, ONE draw matrix shared by every model and every reference (fixed seed ${BOOTSTRAP_SEED}); the ` +
        "weighted estimator is asserted equal to lib.rocAuc at unit weights before any draw, and cross-checked " +
        "against scripts/forecast/bootstrap.ts itself.",
      bootstrapCrossCheck: crossCheck,
      calibration:
        "every model is Platt-calibrated with the SHIPPED robust calibrator (linear.ts fitPlatt, the " +
        "Lin-Weng-Keerthi variant train.ts uses) rather than each contender's own copy of the plain " +
        "Newton, which diverges on a near-separable train-internal calibration slice (the 24-feature " +
        "plain logistic pinned a at -3.9e12 the first time this ran). Platt is monotone increasing, so " +
        "it cannot move an AUC; it moves ECE and every threshold-crossing number, and using one " +
        "calibrator is what makes the shared 0.45/0.80 operating point mean the same thing for all of them.",
      gbdtCopy: gbdtCheck,
      caveatSameGenerator:
        "this corpus is FRESH SAMPLING from the same simulator, not new recorded data. It removes sampling " +
        "noise; it does not remove simulator misspecification, and the simulator and the feature set were " +
        "themselves shaped by held-out diagnostics in GAUNTLET rounds 1–6. It is fresh data for the models, " +
        "not a fresh universe.",
    },
    thresholds,
    table,
    bootstraps,
    runtimeSec: round4((Date.now() - startedAt) / 1000),
  };

  mkdirSync(join(forecastDataRoot(), "holdout"), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`);
  log(`report → ${config.out} (${report.runtimeSec}s)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
