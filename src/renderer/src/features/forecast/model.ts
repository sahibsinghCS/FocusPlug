import type {
  ForecastBand,
  ForecastEvent,
  ForecastSnapshot,
} from "@shared/ipc";
import {
  FORECAST_INPUT_DIM,
  FORECAST_HIDDEN_DIM,
  FORECAST_PARAM_COUNT,
  FORECAST_WARMUP_SEC,
  parseForecastWeights,
  type ForecastFeatureKey,
  type ForecastFeatureView,
} from "@shared/forecast";
import weightsJson from "@shared/forecast/weights.json";
import evalReportJson from "@shared/forecast/eval-report.json";
import type { Tone } from "../../lib/format";
import type { SensorCardView } from "../session/model";
import { FEATURE_SHORT_LABELS, featurePhrase, type FeatureCopyCtx } from "./copy";

/**
 * Pure view-model for the Focus Forecast surfaces — band tones, the sensor
 * card, meter geometry, attribution ranking, the calibration readout, the
 * receipt line, and the model-card footer. No DOM, no clocks: everything is
 * `(snapshot, events, settings) → view`, so the panel renders identically
 * from live IPC, the mock, and the scripted replay.
 */

const WEIGHTS = parseForecastWeights(weightsJson);

/** Committed eval artifact, read defensively — it regenerates with the model. */
const EVAL_REPORT: Record<string, unknown> =
  typeof evalReportJson === "object" && evalReportJson !== null
    ? (evalReportJson as unknown as Record<string, unknown>)
    : {};

function dig(root: Record<string, unknown>, ...path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function digNumber(root: Record<string, unknown>, ...path: string[]): number | null {
  const value = dig(root, ...path);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function digString(root: Record<string, unknown>, ...path: string[]): string | null {
  const value = dig(root, ...path);
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function bandTone(band: ForecastBand): Tone {
  if (band === "prearm") return "red";
  if (band === "elevated") return "amber";
  return "lime";
}

export function bandLabel(band: ForecastBand): string {
  if (band === "prearm") return "Pre-armed";
  if (band === "elevated") return "Elevated";
  return "Calm";
}

export function riskPercent(risk: number): string {
  const clamped = Math.min(1, Math.max(0, risk));
  return `${Math.round(clamped * 100)}%`;
}

function signed(value: number, digits: number): string {
  const fixed = Math.abs(value).toFixed(digits);
  return `${value < 0 ? "−" : "+"}${fixed}`;
}

/** Features ranked by |attribution|, strongest first. */
export function rankAttributions(
  features: readonly ForecastFeatureView[],
  limit = 5,
): ForecastFeatureView[] {
  return [...features]
    .sort((a, b) => Math.abs(b.attribution) - Math.abs(a.attribution))
    .slice(0, limit);
}

/** Strongest upward driver phrased in plain language, null when none pushes up. */
function topDriverPhrase(
  features: readonly ForecastFeatureView[],
  ctx: FeatureCopyCtx = {},
): string | null {
  const top = [...features]
    .filter((feature) => feature.attribution > 0)
    .sort((a, b) => b.attribution - a.attribution)[0];
  if (!top) {
    return null;
  }
  return featurePhrase(top.key, top.raw, ctx);
}

export interface ForecastCardCtx {
  enabled: boolean;
  sessionActive: boolean;
  /** Foreground process name when it is a grey (unlisted) app. */
  greyApp?: string;
}

/** Fourth sensor card: Foreground · Desk AI · Forecast · Plugs. */
export function forecastSensorCard(
  snap: ForecastSnapshot | null,
  ctx: ForecastCardCtx,
): SensorCardView {
  const meta = `${FORECAST_PARAM_COUNT}-param net · on-device`;
  if (!ctx.enabled) {
    return {
      id: "forecast",
      label: "Forecast",
      title: "Off",
      body: "Forecast disabled — base fuse, no nudges. Sessions behave exactly as before.",
      meta,
      tone: "mute",
      live: false,
      empty: true,
      href: "#/settings",
    };
  }
  if (!ctx.sessionActive || !snap) {
    return {
      id: "forecast",
      label: "Forecast",
      title: "Standby",
      body: "Drift-risk model runs while a session is live.",
      meta,
      tone: "mute",
      live: false,
      empty: true,
      href: "#/settings",
    };
  }
  if (!snap.ready) {
    const seen = Math.max(0, FORECAST_WARMUP_SEC - snap.warmupRemainingSec);
    return {
      id: "forecast",
      label: "Forecast",
      title: "Warming up",
      body: `${seen}/${FORECAST_WARMUP_SEC} s of telemetry — needle unlocks at ${FORECAST_WARMUP_SEC} s.`,
      meta,
      tone: "mute",
      live: true,
      empty: false,
    };
  }
  const driver = topDriverPhrase(snap.features, { greyApp: ctx.greyApp });
  return {
    id: "forecast",
    label: "Forecast",
    title: `risk ${riskPercent(snap.risk)}`,
    body: driver ?? "No single driver — pattern reads calm.",
    meta,
    tone: bandTone(snap.band),
    live: true,
    empty: false,
  };
}

/** Monospace calibration readout: logit → Platt → risk, real (a, b) shown. */
export function calibrationLine(snap: ForecastSnapshot): string {
  const a = WEIGHTS?.calibration.a ?? 1;
  const b = WEIGHTS?.calibration.b ?? 0;
  return `logit ${signed(snap.logit, 2)} → σ(a·z+b) a=${a.toFixed(2)} b=${signed(b, 2)} → risk ${snap.rawRisk.toFixed(2)}`;
}

export interface ReceiptView {
  icon: string;
  text: string;
  tone: Tone;
  ts: number;
}

/**
 * The scorecard line — hits, misses and stood-down false alarms are rendered
 * with equal volume. Order-agnostic: the newest hit/miss/stood-down wins.
 */
export function receiptLine(events: readonly ForecastEvent[]): ReceiptView | null {
  let latest: ReceiptView | null = null;
  for (const event of events) {
    let view: ReceiptView | null = null;
    if (event.type === "forecast_hit") {
      view = {
        icon: "✔",
        text: `called it ${formatLeadSec(event.leadSec)} s early`,
        tone: "lime",
        ts: event.ts,
      };
    } else if (event.type === "forecast_miss") {
      view = { icon: "✘", text: "missed — no warning", tone: "red", ts: event.ts };
    } else if (event.type === "forecast_clear" && event.wasPrearmed) {
      view = {
        icon: "◌",
        text: "pre-arm stood down · unconfirmed",
        tone: "amber",
        ts: event.ts,
      };
    }
    if (view && (latest === null || view.ts > latest.ts)) {
      latest = view;
    }
  }
  return latest;
}

export function formatLeadSec(leadSec: number): string {
  const rounded = Math.round(leadSec * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Lead seconds for the CountdownOverlay receipt line — the newest
 * `forecast_hit` recent enough to belong to the burning fuse.
 */
export function overlayLeadSec(
  events: readonly ForecastEvent[],
  nowTs: number,
  windowMs = 120_000,
): number | null {
  let best: { ts: number; leadSec: number } | null = null;
  for (const event of events) {
    if (event.type !== "forecast_hit") {
      continue;
    }
    if (nowTs - event.ts > windowMs || event.ts - nowTs > 5_000) {
      continue;
    }
    if (best === null || event.ts > best.ts) {
      best = { ts: event.ts, leadSec: event.leadSec };
    }
  }
  return best?.leadSec ?? null;
}

export interface PrearmPlateView {
  baseFuseSec: number;
  effectiveFuseSec: number;
  /** e.g. "10s → 5s" */
  chip: string;
  label: string;
}

/** SessionClock plate view — non-null exactly while pre-armed and shortened. */
export function prearmPlate(snap: ForecastSnapshot | null): PrearmPlateView | null {
  if (!snap || !snap.ready || snap.prearmedAt === null) {
    return null;
  }
  return {
    baseFuseSec: snap.baseFuseSec,
    effectiveFuseSec: snap.effectiveFuseSec,
    chip: `${snap.baseFuseSec}s → ${snap.effectiveFuseSec}s`,
    label: "pre-armed · forecast",
  };
}

export interface MeterTick {
  risk: number;
  label: string;
}

export interface MeterView {
  ready: boolean;
  /** "warming up · n/15 s" (or "standby") while the needle is ghosted. */
  warmupLabel: string | null;
  risk: number;
  percentLabel: string;
  band: ForecastBand;
  /** Needle angle in degrees: −90 (risk 0) … +90 (risk 1). */
  angleDeg: number;
  ticks: MeterTick[];
  caption: string;
}

export function meterView(
  snap: ForecastSnapshot | null,
  settings: { nudgeRisk: number; prearmRisk: number },
): MeterView {
  const ticks: MeterTick[] = [
    { risk: settings.nudgeRisk, label: "nudge" },
    { risk: settings.prearmRisk, label: "pre-arm" },
  ];
  const caption = `drift risk · next ${snap?.horizonSec ?? 30} s`;
  if (!snap) {
    return {
      ready: false,
      warmupLabel: "standby",
      risk: 0,
      percentLabel: "—",
      band: "calm",
      angleDeg: -90,
      ticks,
      caption,
    };
  }
  const risk = Math.min(1, Math.max(0, snap.risk));
  if (!snap.ready) {
    const seen = Math.max(0, FORECAST_WARMUP_SEC - snap.warmupRemainingSec);
    return {
      ready: false,
      warmupLabel: `warming up · ${seen}/${FORECAST_WARMUP_SEC} s`,
      risk,
      percentLabel: "—",
      band: "calm",
      angleDeg: riskAngle(risk),
      ticks,
      caption,
    };
  }
  return {
    ready: true,
    warmupLabel: null,
    risk,
    percentLabel: riskPercent(risk),
    band: snap.band,
    angleDeg: riskAngle(risk),
    ticks,
    caption,
  };
}

export function riskAngle(risk: number): number {
  return Math.min(1, Math.max(0, risk)) * 180 - 90;
}

export interface RiskPoint {
  ts: number;
  risk: number;
}

export interface SparkMarker {
  x: number;
  y: number;
  kind: "nudge" | "prearm" | "drift";
}

export interface SparklineView {
  path: string;
  markers: SparkMarker[];
  nudgeY: number;
  prearmY: number;
  empty: boolean;
}

/**
 * 60 s risk sparkline geometry — pure pixel math so it is testable and
 * renders the same everywhere. Markers: nudge ▲, pre-arm ◆, drift ✖.
 */
export function sparklineView(
  history: readonly RiskPoint[],
  events: readonly ForecastEvent[],
  opts: {
    nowTs: number;
    width: number;
    height: number;
    windowSec?: number;
    nudgeRisk: number;
    prearmRisk: number;
  },
): SparklineView {
  const windowMs = (opts.windowSec ?? 60) * 1000;
  const fromTs = opts.nowTs - windowMs;
  const points = history
    .filter((point) => point.ts >= fromTs && point.ts <= opts.nowTs)
    .sort((a, b) => a.ts - b.ts);
  const toX = (ts: number): number =>
    Math.min(opts.width, Math.max(0, ((ts - fromTs) / windowMs) * opts.width));
  const toY = (risk: number): number =>
    Math.min(opts.height, Math.max(0, (1 - Math.min(1, Math.max(0, risk))) * opts.height));

  let path = "";
  for (const [index, point] of points.entries()) {
    const x = toX(point.ts);
    const y = toY(point.risk);
    path += `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  const markers: SparkMarker[] = [];
  for (const event of events) {
    if (event.ts < fromTs || event.ts > opts.nowTs) {
      continue;
    }
    if (event.type === "forecast_nudge") {
      markers.push({ x: toX(event.ts), y: toY(event.risk), kind: "nudge" });
    } else if (event.type === "forecast_prearm") {
      markers.push({ x: toX(event.ts), y: toY(event.risk), kind: "prearm" });
    } else if (event.type === "forecast_hit" || event.type === "forecast_miss") {
      markers.push({ x: toX(event.ts), y: 4, kind: "drift" });
    }
  }

  return {
    path,
    markers,
    nudgeY: toY(opts.nudgeRisk),
    prearmY: toY(opts.prearmRisk),
    empty: points.length < 2,
  };
}

export interface FeatureBarView {
  key: ForecastFeatureKey;
  label: string;
  phrase: string;
  attribution: number;
  /** 0..1 share of the strongest |attribution| this tick. */
  magnitude: number;
  positive: boolean;
}

/** Every feature as a signed bar, in FORECAST_FEATURE_KEYS order. */
export function featureBars(
  features: readonly ForecastFeatureView[],
  ctx: FeatureCopyCtx = {},
): FeatureBarView[] {
  const max = Math.max(0.01, ...features.map((feature) => Math.abs(feature.attribution)));
  return features.map((feature) => ({
    key: feature.key,
    label: FEATURE_SHORT_LABELS[feature.key],
    phrase: featurePhrase(feature.key, feature.raw, ctx),
    attribution: feature.attribution,
    magnitude: Math.abs(feature.attribution) / max,
    positive: feature.attribution > 0,
  }));
}

/** "Why now" rows: top-N by |attribution| with plain-language phrases. */
export interface WhyNowRow {
  key: ForecastFeatureKey;
  arrow: "▲" | "▼" | "·";
  delta: string;
  phrase: string;
  magnitude: number;
  positive: boolean;
  /** |attribution| too small to mean anything — rendered muted. */
  negligible: boolean;
}

/** Honest small numbers: 2 dp normally, 3 dp when tiny, a plain 0 when noise. */
export function formatAttribution(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude < 0.0005) {
    return "0";
  }
  return signed(value, magnitude < 0.01 ? 3 : 2);
}

export function whyNowRows(
  features: readonly ForecastFeatureView[],
  ctx: FeatureCopyCtx = {},
  limit = 5,
): WhyNowRow[] {
  const ranked = rankAttributions(features, limit);
  const max = Math.max(0.01, ...ranked.map((feature) => Math.abs(feature.attribution)));
  return ranked.map((feature) => {
    const negligible = Math.abs(feature.attribution) < 0.0005;
    return {
      key: feature.key,
      arrow: negligible ? "·" : feature.attribution >= 0 ? "▲" : "▼",
      delta: formatAttribution(feature.attribution),
      phrase: featurePhrase(feature.key, feature.raw, ctx),
      magnitude: Math.abs(feature.attribution) / max,
      // `> 0`, matching featureBars and the InternalsPanel legend: a feature
      // whose occlusion delta is exactly 0 pushed nothing, and must not render
      // red in one panel and blue in the other three inches away.
      positive: feature.attribution > 0,
      negligible,
    };
  });
}

export interface ModelCardView {
  spec: string;
  evalLine: string;
  dataLine: string;
}

/**
 * Model-card footer, fed from the committed weights + eval artifacts so the
 * on-screen claims are the training scripts' output, not copy.
 */
export function modelCard(): ModelCardView {
  const version = WEIGHTS?.version ?? "ff-?";
  const params = WEIGHTS?.paramCount ?? FORECAST_PARAM_COUNT;
  const hidden = WEIGHTS?.layers.hidden.bias.length ?? FORECAST_HIDDEN_DIM;
  const sizeKb = Math.max(1, Math.round(JSON.stringify(weightsJson).length / 1024));
  const spec =
    `MLP ${FORECAST_INPUT_DIM}→${hidden}→1 tanh · ${params} params · ${sizeKb} KB · ` +
    `on-device · 1 Hz · v ${version}`;

  const auc = digNumber(EVAL_REPORT, "metrics", "rocAuc");
  const lead20 = digNumber(EVAL_REPORT, "metrics", "aucLead20");
  const ece = digNumber(EVAL_REPORT, "metrics", "ece");
  const evalLine =
    auc !== null && lead20 !== null
      ? `held-out AUC ${auc.toFixed(2)} · lead≥20 s ${lead20.toFixed(2)}${
          ece !== null ? ` · ECE ${ece.toFixed(3)}` : ""
        }`
      : "held-out eval pending";

  const mode = digString(EVAL_REPORT, "provenance", "manifest", "mode") ?? "unknown";
  const httpStatus = digNumber(EVAL_REPORT, "provenance", "manifest", "adaption", "httpStatus");
  const dataLine = `data: synthetic + local-aug · Adaption: ${mode}${
    httpStatus !== null ? ` (HTTP ${httpStatus})` : ""
  }`;

  return { spec, evalLine, dataLine };
}

/** Timeline/log copy for a forecast event — mirrors the monitor's log lines. */
export function describeForecastEvent(event: ForecastEvent): string {
  switch (event.type) {
    case "forecast_nudge":
      return `nudge · risk ${riskPercent(event.risk)} · ${
        event.topFeatures.length > 0 ? event.topFeatures.join(", ") : "no single driver"
      }`;
    case "forecast_prearm":
      return `pre-arm · risk ${riskPercent(event.risk)} · fuse ${event.fuseSec}s`;
    case "forecast_clear":
      return event.wasPrearmed
        ? `pre-arm stood down · unconfirmed · risk ${riskPercent(event.risk)}`
        : `clear · risk ${riskPercent(event.risk)}`;
    case "forecast_hit":
      return `hit · called ${formatLeadSec(event.leadSec)}s early`;
    case "forecast_miss":
      return "miss — no warning";
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return "forecast event";
    }
  }
}

export interface HiddenCellView {
  key: ForecastFeatureKey | null;
  label: string;
  value: number;
  /** 0..1 |tanh| intensity for tinting. */
  intensity: number;
  positive: boolean;
}

/**
 * The hidden-layer activation strip: one cell per unit of the shipped
 * `FORECAST_INPUT_DIM → FORECAST_HIDDEN_DIM → 1` net, tinted by its `tanh`.
 *
 * These units are ANONYMOUS — a learned basis, not one cell per feature — and
 * the UI says so rather than pretending otherwise. The named, signed numbers
 * live in the attribution bars beside it, which are real occlusion deltas
 * (`risk(x) − risk(x with this feature at its training mean)`); a hidden layer
 * moves every unit at once, so there is no exact per-term decomposition to
 * offer and the panel does not claim one.
 *
 * Labels are positional (`h01`…): the units carry no meaning individually, and
 * the point of the strip is the pattern across them.
 */
export function hiddenCells(hidden: readonly number[]): HiddenCellView[] {
  return hidden.map((value, index) => ({
    key: null,
    label: `h${String(index + 1).padStart(2, "0")}`,
    value,
    intensity: Math.min(1, Math.abs(value)),
    positive: value >= 0,
  }));
}
