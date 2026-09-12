/**
 * Alarm simulation through the SHIPPED escalation reducer, over the held-out
 * RAW sessions — identical machinery to `scripts/forecast/eval.ts`
 * (`replaySession` → `smoothRisk` → `stepEscalation`), with the risk needle
 * fed by this candidate's model instead of the shipped MLP.
 *
 * Two recall rules are reported:
 * - `recallAt30sNudge` (the contender-wide comparison number): the fraction of
 *   held-out drift onsets with a `forecast_nudge` OR `forecast_prearm` event
 *   inside (onset − 30 s, onset] — "would the user have been warned at all?".
 * - `recallAt30sPrearm`: eval.ts's own recall@30s rule (pre-arm active at the
 *   onset per the reducer's `forecast_hit` receipt, or a pre-arm fired in the
 *   30 s before), kept so the shipped 0.5641 stays apples-to-apples.
 */

import {
  INITIAL_ESCALATION_STATE,
  smoothRisk,
  stepEscalation,
  type EscalationSettings,
  type EscalationState,
} from "../../../../src/shared/forecast/escalate";
import { findDriftOnsets, type DecisionFrame } from "../../../../src/shared/forecast/labels";
import { FORECAST_WARMUP_SEC, type ForecastEvent } from "../../../../src/shared/forecast/types";
import { replaySession, type RawSession } from "../../lib";

export interface SessionTrace {
  id: string;
  archetype: string;
  durationSec: number;
  risks: Float64Array;
  frames: DecisionFrame[];
  onsets: ReturnType<typeof findDriftOnsets>;
}

export function traceSession(
  session: RawSession,
  score: (encoded: readonly number[]) => number,
): SessionTrace {
  const frames = replaySession(session);
  const decisions: DecisionFrame[] = frames.map((frame) => ({
    t: frame.t,
    decision: frame.decision,
    countdownActive: frame.countdownActive,
  }));
  const risks = new Float64Array(frames.length);
  for (let i = 0; i < frames.length; i += 1) {
    risks[i] = score((frames[i] as { values: number[] }).values);
  }
  return {
    id: session.id,
    archetype: session.archetype,
    durationSec: session.durationSec,
    risks,
    frames: decisions,
    onsets: findDriftOnsets(decisions),
  };
}

export interface AlarmResult {
  drifts: number;
  nudgeHits: number;
  prearmHits: number;
  nudgeLeads: number[];
  prearmLeads: number[];
  nudges: number;
  prearms: number;
  falsePrearms: number;
  hours: number;
}

export function emptyAlarms(): AlarmResult {
  return {
    drifts: 0,
    nudgeHits: 0,
    prearmHits: 0,
    nudgeLeads: [],
    prearmLeads: [],
    nudges: 0,
    prearms: 0,
    falsePrearms: 0,
    hours: 0,
  };
}

export function accumulate(target: AlarmResult, part: AlarmResult): void {
  target.drifts += part.drifts;
  target.nudgeHits += part.nudgeHits;
  target.prearmHits += part.prearmHits;
  target.nudgeLeads.push(...part.nudgeLeads);
  target.prearmLeads.push(...part.prearmLeads);
  target.nudges += part.nudges;
  target.prearms += part.prearms;
  target.falsePrearms += part.falsePrearms;
  target.hours += part.hours;
}

export function runEscalation(trace: SessionTrace, settings: EscalationSettings): AlarmResult {
  let state: EscalationState = { ...INITIAL_ESCALATION_STATE };
  let smoothed: number | null = null;
  const events: ForecastEvent[] = [];
  for (let i = 0; i < trace.frames.length; i += 1) {
    const frame = trace.frames[i] as DecisionFrame;
    smoothed = smoothRisk(smoothed, trace.risks[i] as number);
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

  const nudgeOrHigher = events
    .filter((event) => event.type === "forecast_nudge" || event.type === "forecast_prearm")
    .map((event) => event.ts / 1000);
  const prearms = events.filter((event) => event.type === "forecast_prearm");
  const hitEvents = events.filter((event) => event.type === "forecast_hit");
  const nudges = events.filter((event) => event.type === "forecast_nudge").length;

  let nudgeHits = 0;
  let prearmHits = 0;
  const nudgeLeads: number[] = [];
  const prearmLeads: number[] = [];
  for (const onset of trace.onsets) {
    const inWindow = nudgeOrHigher.filter((t) => t <= onset.t && onset.t - t <= 30);
    if (inWindow.length > 0) {
      nudgeHits += 1;
      nudgeLeads.push(onset.t - (inWindow[0] as number));
    }
    const receipt = hitEvents.find(
      (event) => event.type === "forecast_hit" && Math.abs(event.ts / 1000 - onset.t) <= 1.5,
    );
    if (receipt !== undefined && receipt.type === "forecast_hit") {
      prearmHits += 1;
      prearmLeads.push(receipt.leadSec);
      continue;
    }
    const candidates = prearms.filter(
      (event) => event.ts / 1000 <= onset.t && onset.t - event.ts / 1000 <= 30,
    );
    const last = candidates[candidates.length - 1];
    if (last !== undefined) {
      prearmHits += 1;
      prearmLeads.push(onset.t - last.ts / 1000);
    }
  }
  const falsePrearms = events.filter(
    (event) =>
      event.type === "forecast_clear" &&
      event.wasPrearmed &&
      !trace.onsets.some((onset) => onset.t >= event.ts / 1000 && onset.t - event.ts / 1000 <= 30),
  ).length;

  return {
    drifts: trace.onsets.length,
    nudgeHits,
    prearmHits,
    nudgeLeads,
    prearmLeads,
    nudges,
    prearms: prearms.length,
    falsePrearms,
    hours: trace.durationSec / 3600,
  };
}
