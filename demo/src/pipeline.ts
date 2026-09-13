import { DEFAULT_SETTINGS } from "@shared/defaults";
import type {
  Decision,
  DeskSnapshot,
  FocusSnapshot,
  PolicyEvent,
} from "@shared/ipc";
import { INITIAL_POLICY_STATE, stepPolicy, type PolicyState } from "@shared/policy";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  FORECAST_PARAM_COUNT,
  FORECAST_WARMUP_SEC,
  INITIAL_ESCALATION_STATE,
  TelemetryRing,
  attributions,
  effectiveFuseSec,
  extractFeatures,
  forward,
  parseForecastWeights,
  smoothRisk,
  stepEscalation,
  type EscalationSettings,
  type EscalationState,
  type ForecastEvent,
  type ForecastFeatureKey,
  type ForecastSnapshot,
  type ForecastWeightsFile,
} from "@shared/forecast";
import weightsJson from "@shared/forecast/weights.json";

/**
 * The demo's one inference loop — and the only place the demo owns logic.
 *
 * Everything load-bearing inside `step()` is imported, not reimplemented:
 * `TelemetryRing` → `extractFeatures` → the trained 24→36→1 MLP head
 * (`mlp24-36-1`, 937 params — `forward` + `attributions` over the committed
 * `weights.json`) → `smoothRisk` → `stepEscalation`, with the deterministic
 * `stepPolicy` reducer from `@shared/policy` producing the Decision, the
 * countdown and the kill. The fuse the policy engine sees each tick is
 * `effectiveFuseSec(...)` — the same single knob `ForecastHook.beforeStep`
 * turns in the Electron main process, so a pre-arm really does shorten the
 * fuse here, latch rule included.
 *
 * Only the INPUTS differ between the two demo modes: Mode 1 feeds a scripted
 * behavior stream, Mode 2 feeds live webcam desk snapshots. The pipeline
 * cannot tell them apart, which is the point.
 */

export const DEMO_SETTINGS = DEFAULT_SETTINGS;

export const ESCALATION_SETTINGS: EscalationSettings = {
  nudgeRisk: DEMO_SETTINGS.forecastNudgeRisk,
  prearmRisk: DEMO_SETTINGS.forecastPrearmRisk,
  prearmEnabled: DEMO_SETTINGS.forecastPrearmEnabled,
  prearmFuseSec: DEMO_SETTINGS.forecastPrearmFuseSec,
  baseFuseSec: DEMO_SETTINGS.countdownSec,
};

/** A single simulated (or live) second of sensor input. */
export interface PipelineTick {
  /** End-of-second wall timestamp (epoch ms). */
  ts: number;
  /**
   * Focus snapshots observed during this second, oldest first. Multiple pokes
   * model the real 4 Hz window monitor: fast alt-tabs land inside one second.
   */
  focus: readonly FocusSnapshot[];
  desk: DeskSnapshot;
}

export interface DemoFrame {
  /** Seconds since session start, 1-based. */
  t: number;
  ts: number;
  snapshot: ForecastSnapshot;
  forecastEvents: ForecastEvent[];
  policyEvents: PolicyEvent[];
  focus: FocusSnapshot;
  desk: DeskSnapshot;
  decision: Decision;
  detail: string;
  /** Seconds left on a burning fuse, 0 when none is burning. */
  countdownSec: number;
  /** The fuse length the burning countdown started with. */
  fuseTotalSec: number;
  /** A kill has already landed in this session. */
  killed: boolean;
  /** Foreground process name when it is a grey (unlisted) app. */
  greyApp?: string;
}

function parseWeights(): ForecastWeightsFile {
  const weights = parseForecastWeights(weightsJson);
  if (weights === null) {
    throw new Error("focusplug demo: committed weights.json failed validation");
  }
  return weights;
}

function policySignalOf(
  events: readonly PolicyEvent[],
): "start_countdown" | "cancel_countdown" | "kill" | "unlock" | null {
  for (const event of events) {
    if (
      event.type === "start_countdown" ||
      event.type === "cancel_countdown" ||
      event.type === "kill" ||
      event.type === "unlock"
    ) {
      return event.type;
    }
  }
  return null;
}

export class DemoPipeline {
  private readonly weights = parseWeights();
  private readonly ring = new TelemetryRing(0);
  private escalation: EscalationState = { ...INITIAL_ESCALATION_STATE };
  private policy: PolicyState = { ...INITIAL_POLICY_STATE, countdownTargets: [] };
  private smoothed: number | null = null;
  private startTs = 0;
  private tickCount = 0;
  private fuseTotalSec = ESCALATION_SETTINGS.baseFuseSec;
  private killed = false;
  private lastFocus: FocusSnapshot | null = null;

  constructor(private readonly settings: EscalationSettings = ESCALATION_SETTINGS) {}

  /** Session start: the ring is empty between sessions, so the meter warms up. */
  reset(startTs: number): void {
    this.ring.reset(startTs);
    this.escalation = { ...INITIAL_ESCALATION_STATE };
    this.policy = { ...INITIAL_POLICY_STATE, countdownTargets: [] };
    this.smoothed = null;
    this.startTs = startTs;
    this.tickCount = 0;
    this.fuseTotalSec = this.settings.baseFuseSec;
    this.killed = false;
    this.lastFocus = null;
  }

  /**
   * One closed 1 Hz frame. Ordering mirrors `ForecastMonitor` in main: the
   * fuse hook reads the PRE-step escalation state, policy steps next (so the
   * tap sees `start_countdown` before it is applied), then the frame closes,
   * the model runs, and the reducer escalates.
   *
   * One simplification, stated rather than hidden: main runs the controller's
   * evaluate loop at 250 ms and closes a telemetry frame per wall second, so
   * policy can step several times between two model reads. The demo collapses
   * both to a single 1 Hz step. Sub-second focus pokes still arrive in the
   * ring with their real timestamps, which is what the switch/churn features
   * count, so the features are unaffected; only the Decision refresh rate is.
   */
  step(input: PipelineTick): DemoFrame {
    this.tickCount += 1;

    // 1. Telemetry for this second — the ring is the forecast's only memory.
    for (const snap of input.focus) {
      this.ring.noteFocus(snap);
      this.lastFocus = snap;
    }
    this.ring.noteDesk(input.desk, DEMO_SETTINGS.deskThreshold);
    const focus = this.lastFocus ?? input.focus[input.focus.length - 1] ?? null;

    // 2. The one knob the forecast owns: the countdown length policy sees.
    const fuse = effectiveFuseSec(this.escalation, this.settings);
    const countdownSec = fuse ?? DEMO_SETTINGS.countdownSec;

    // 3. The real, unmodified policy reducer decides. It alone starts fuses
    //    and kills; the forecast can only have shortened `countdownSec`.
    const stepped = stepPolicy(this.policy, {
      sessionActive: true,
      focus,
      desk: input.desk,
      countdownSec,
      deskThreshold: DEMO_SETTINGS.deskThreshold,
      strictMode: DEMO_SETTINGS.strictMode,
    });
    this.policy = stepped.state;
    const policyEvents = stepped.events;
    const status = policyEvents.find((event) => event.type === "status");
    const decision: Decision = status?.type === "status" ? status.decision : "IDLE";
    const detail = status?.type === "status" ? status.detail : "";

    for (const event of policyEvents) {
      if (event.type === "start_countdown") {
        this.fuseTotalSec = event.seconds;
      }
      if (event.type === "kill") {
        this.killed = true;
      }
    }

    // 4. Close the 1 Hz frame and run the shipped model on it.
    this.ring.noteStatus(decision);
    this.ring.commit(input.ts);
    const extraction = extractFeatures(this.ring, input.ts);
    const forwardPass = forward(this.weights, extraction.values);
    const attribution = attributions(this.weights, extraction.values);
    this.smoothed = smoothRisk(this.smoothed, forwardPass.rawRisk);
    const ready = this.tickCount >= FORECAST_WARMUP_SEC;

    // 5. Escalate exactly the way the monitor does (latch, receipt, bands).
    const countdownActive = this.policy.countdownStartedAt !== null;
    const escalated = stepEscalation(this.escalation, {
      ts: input.ts,
      risk: this.smoothed,
      ready,
      decision,
      countdownActive,
      policySignal: policySignalOf(policyEvents),
      settings: this.settings,
    });
    this.escalation = escalated.state;

    // The reducer sees no feature data by contract, so the monitor overlays
    // the live top-3 attribution keys onto a nudge before fan-out. Same here.
    const forecastEvents: ForecastEvent[] = ready
      ? escalated.events.map((event) =>
          event.type === "forecast_nudge"
            ? { ...event, topFeatures: this.topDrivers(attribution) }
            : event,
        )
      : [];

    const activeFuse = effectiveFuseSec(this.escalation, this.settings);
    const snapshot: ForecastSnapshot = {
      ts: input.ts,
      ready,
      warmupRemainingSec: ready ? 0 : FORECAST_WARMUP_SEC - this.tickCount,
      risk: this.smoothed,
      rawRisk: forwardPass.rawRisk,
      logit: forwardPass.logit,
      band: this.escalation.band,
      horizonSec: FORECAST_HORIZON_SEC,
      features: FORECAST_FEATURE_KEYS.map((key, index) => ({
        key,
        raw: extraction.raw[key],
        value: extraction.values[index] ?? 0,
        attribution: attribution[index] ?? 0,
      })),
      hidden: [...forwardPass.hidden],
      prearmedAt: this.escalation.prearmedAt,
      effectiveFuseSec: activeFuse ?? this.settings.baseFuseSec,
      baseFuseSec: this.settings.baseFuseSec,
      modelVersion: FORECAST_MODEL_VERSION,
      paramCount: FORECAST_PARAM_COUNT,
    };

    const grey =
      focus !== null && !focus.matchedAllow && !focus.matchedBlock
        ? focus.processName
        : undefined;

    return {
      t: Math.round((input.ts - this.startTs) / 1000),
      ts: input.ts,
      snapshot,
      forecastEvents,
      policyEvents,
      focus: focus ?? {
        ts: input.ts,
        processName: "",
        windowTitle: "",
        matchedAllow: false,
        matchedBlock: false,
      },
      desk: input.desk,
      decision,
      detail,
      countdownSec: this.remainingSec(input.ts),
      fuseTotalSec: this.fuseTotalSec,
      killed: this.killed,
      greyApp: grey,
    };
  }

  private remainingSec(nowTs: number): number {
    const startedAt = this.policy.countdownStartedAt;
    if (startedAt === null) {
      return 0;
    }
    const elapsedSec = (nowTs - startedAt) / 1000;
    return Math.max(0, Math.ceil(this.fuseTotalSec - elapsedSec));
  }

  private topDrivers(attribution: readonly number[]): ForecastFeatureKey[] {
    return FORECAST_FEATURE_KEYS.map((key, index) => ({
      key,
      attribution: attribution[index] ?? 0,
    }))
      .filter((entry) => entry.attribution > 0)
      .sort((a, b) => b.attribution - a.attribution)
      .slice(0, 3)
      .map((entry) => entry.key);
  }
}

/** Risk history for the sparkline: every frame up to (and including) index. */
export function frameHistory(
  frames: readonly DemoFrame[],
  index: number,
): { ts: number; risk: number }[] {
  return frames
    .slice(0, Math.max(0, Math.min(index + 1, frames.length)))
    .map((frame) => ({ ts: frame.snapshot.ts, risk: frame.snapshot.risk }));
}

/** Every forecast event emitted up to (and including) index, oldest first. */
export function frameEvents(
  frames: readonly DemoFrame[],
  index: number,
): ForecastEvent[] {
  const out: ForecastEvent[] = [];
  for (const frame of frames.slice(0, Math.max(0, Math.min(index + 1, frames.length)))) {
    out.push(...frame.forecastEvents);
  }
  return out;
}
