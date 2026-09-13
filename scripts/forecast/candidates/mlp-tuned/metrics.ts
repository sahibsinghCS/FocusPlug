import { DEFAULT_SETTINGS } from "../../../../src/shared/defaults";
import {
  INITIAL_ESCALATION_STATE,
  smoothRisk,
  stepEscalation,
  type EscalationSettings,
  type EscalationState,
} from "../../../../src/shared/forecast/escalate";
import { FORECAST_WARMUP_SEC, type ForecastEvent } from "../../../../src/shared/forecast/types";
import { FORECAST_INPUT_DIM } from "../../../../src/shared/forecast/model";
import type { DecisionFrame } from "../../../../src/shared/forecast/labels";
import { percentile, rocAuc, round4 } from "../../lib";
import type { ReplayedSession } from "./data";

/**
 * Scoring helpers held to the SHARED definitions:
 *
 * - AUC is `rocAuc` from `scripts/forecast/lib.ts` (real Mann–Whitney with
 *   average ranks) — never re-implemented here;
 * - lead-censored eligibility is copied verbatim from `eval.ts`
 *   (`secsToDrift === null || secsToDrift >= leadSec`), so positives are the
 *   frames 20–30 s before an onset and negatives are calm frames whose
 *   nearest onset is > 30 s away or absent;
 * - the alarm simulation drives the SHIPPED `stepEscalation` reducer with the
 *   SHIPPED EMA smoothing at the SHIPPED default thresholds. `eval.ts`'s own
 *   `simulateAlarms` hard-codes `forward(weights, …)`, which cannot score an
 *   ensemble, so the loop is reproduced here around a pluggable scorer and
 *   nothing else changed.
 */

export function leadEligible(secsToDrift: number, leadSec: number): boolean {
  return Number.isNaN(secsToDrift) || secsToDrift >= leadSec;
}

export function leadAuc(
  scores: ArrayLike<number>,
  labels: ArrayLike<number>,
  secs: ArrayLike<number>,
  leadSec: number,
): number {
  const s: number[] = [];
  const l: number[] = [];
  for (let i = 0; i < scores.length; i += 1) {
    if (leadEligible(secs[i] as number, leadSec)) {
      s.push(scores[i] as number);
      l.push(labels[i] as number);
    }
  }
  return rocAuc(s, l);
}

export interface OperatingPoint {
  threshold: number;
  precision: number | null;
  recall: number;
  fpr: number;
}

export function operatingPoint(
  scores: ArrayLike<number>,
  labels: ArrayLike<number>,
  threshold: number,
): OperatingPoint {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < scores.length; i += 1) {
    const fired = (scores[i] as number) >= threshold;
    if ((labels[i] as number) === 1) {
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

export type FrameScorer = (values: Float64Array, offset: number) => number;

export interface AlarmTotals {
  sessions: number;
  hours: number;
  drifts: number;
  /** Pre-arm active at onset, or pre-armed within the prior 30 s (eval.ts rule). */
  prearmHits: number;
  prearmLeads: number[];
  /** A nudge OR pre-arm event was raised in the 30 s before onset. */
  nudgeHits: number;
  nudgeLeads: number[];
  /** Escalation band was elevated/prearm at the frame before onset. */
  escalatedAtOnset: number;
  falsePrearms: number;
  nudges: number;
  prearms: number;
}

export function newAlarmTotals(): AlarmTotals {
  return {
    sessions: 0,
    hours: 0,
    drifts: 0,
    prearmHits: 0,
    prearmLeads: [],
    nudgeHits: 0,
    nudgeLeads: [],
    escalatedAtOnset: 0,
    falsePrearms: 0,
    nudges: 0,
    prearms: 0,
  };
}

export function addTotals(target: AlarmTotals, source: AlarmTotals): void {
  target.sessions += source.sessions;
  target.hours += source.hours;
  target.drifts += source.drifts;
  target.prearmHits += source.prearmHits;
  target.prearmLeads.push(...source.prearmLeads);
  target.nudgeHits += source.nudgeHits;
  target.nudgeLeads.push(...source.nudgeLeads);
  target.escalatedAtOnset += source.escalatedAtOnset;
  target.falsePrearms += source.falsePrearms;
  target.nudges += source.nudges;
  target.prearms += source.prearms;
}

export function escalationSettings(nudgeRisk: number, prearmRisk: number): EscalationSettings {
  return {
    nudgeRisk,
    prearmRisk,
    prearmEnabled: true,
    prearmFuseSec: 5,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  };
}

export function simulateAlarms(
  session: ReplayedSession,
  scorer: FrameScorer,
  settings: EscalationSettings,
): AlarmTotals {
  let state: EscalationState = { ...INITIAL_ESCALATION_STATE };
  let smoothed: number | null = null;
  const events: ForecastEvent[] = [];
  const bandAt = new Map<number, string>();
  for (let i = 0; i < session.frameCount; i += 1) {
    const frame = session.decisions[i] as DecisionFrame;
    const rawRisk = scorer(session.values, i * FORECAST_INPUT_DIM);
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
    bandAt.set(frame.t, state.band);
  }

  const totals = newAlarmTotals();
  totals.sessions = 1;
  totals.hours = session.durationSec / 3600;
  totals.drifts = session.onsets.length;
  const prearms = events.filter((e) => e.type === "forecast_prearm");
  const hitEvents = events.filter((e) => e.type === "forecast_hit");
  const nudgeOrPrearm = events.filter(
    (e) => e.type === "forecast_nudge" || e.type === "forecast_prearm",
  );
  totals.nudges = events.filter((e) => e.type === "forecast_nudge").length;
  totals.prearms = prearms.length;

  for (const onset of session.onsets) {
    // --- pre-arm recall (eval.ts's rule, reproduced exactly) ---------------
    const receipt = hitEvents.find(
      (e) => e.type === "forecast_hit" && Math.abs(e.ts / 1000 - onset.t) <= 1.5,
    );
    if (receipt !== undefined && receipt.type === "forecast_hit") {
      totals.prearmHits += 1;
      totals.prearmLeads.push(receipt.leadSec);
    } else {
      const candidates = prearms.filter(
        (e) => e.ts / 1000 <= onset.t && onset.t - e.ts / 1000 <= 30,
      );
      const last = candidates[candidates.length - 1];
      if (last !== undefined) {
        totals.prearmHits += 1;
        totals.prearmLeads.push(onset.t - last.ts / 1000);
      }
    }
    // --- "at least a nudge in the 30 s before onset" ------------------------
    const inWindow = nudgeOrPrearm.filter(
      (e) => e.ts / 1000 <= onset.t && onset.t - e.ts / 1000 <= 30,
    );
    const first = inWindow[0];
    if (first !== undefined) {
      totals.nudgeHits += 1;
      totals.nudgeLeads.push(onset.t - first.ts / 1000);
    }
    // --- weaker cross-check: was the reducer escalated when the drift hit? --
    const band = bandAt.get(onset.t - 1);
    if (band !== undefined && band !== "calm") {
      totals.escalatedAtOnset += 1;
    }
  }
  totals.falsePrearms = events.filter(
    (e) =>
      e.type === "forecast_clear" &&
      e.wasPrearmed &&
      !session.onsets.some((o) => o.t >= e.ts / 1000 && o.t - e.ts / 1000 <= 30),
  ).length;
  return totals;
}

export function summarizeAlarms(totals: AlarmTotals): Record<string, number | null> {
  const prearmLeads = [...totals.prearmLeads].sort((a, b) => a - b);
  const nudgeLeads = [...totals.nudgeLeads].sort((a, b) => a - b);
  const medianPrearm = percentile(prearmLeads, 0.5);
  const p25Prearm = percentile(prearmLeads, 0.25);
  const medianNudge = percentile(nudgeLeads, 0.5);
  return {
    drifts: totals.drifts,
    recallAt30Prearm: totals.drifts > 0 ? round4(totals.prearmHits / totals.drifts) : null,
    recallAt30Nudge: totals.drifts > 0 ? round4(totals.nudgeHits / totals.drifts) : null,
    escalatedAtOnsetRate: totals.drifts > 0 ? round4(totals.escalatedAtOnset / totals.drifts) : null,
    medianPrearmLeadSec: medianPrearm === null ? null : round4(medianPrearm),
    p25PrearmLeadSec: p25Prearm === null ? null : round4(p25Prearm),
    medianNudgeLeadSec: medianNudge === null ? null : round4(medianNudge),
    falsePrearmsPerHour: totals.hours > 0 ? round4(totals.falsePrearms / totals.hours) : null,
    nudgesPerHour: totals.hours > 0 ? round4(totals.nudges / totals.hours) : null,
    evalHours: round4(totals.hours),
    sessions: totals.sessions,
  };
}
