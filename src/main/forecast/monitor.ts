import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  FORECAST_PARAM_COUNT,
  FORECAST_WARMUP_SEC,
  FRAME_CAPACITY,
  INITIAL_ESCALATION_STATE,
  PREARM_FUSE_FLOOR_SEC,
  TelemetryRing,
  attributions,
  effectiveFuseSec,
  extractFeatures,
  forward,
  isDriftedDecision,
  parseForecastWeights,
  processHash,
  smoothRisk,
  stepEscalation,
  topPositiveKeys,
} from "../../shared/forecast/index.ts";
import type {
  EscalationInput,
  EscalationSettings,
  EscalationState,
  FeatureExtraction,
  ForecastEvent,
  ForecastFeatureKey,
  ForecastFeatureView,
  ForecastForward,
  ForecastHook,
  ForecastPush,
  ForecastSnapshot,
  ForecastWeightsFile,
  TelemetryFrame,
} from "../../shared/forecast/index.ts";
import { focusKind } from "../../shared/policy/index.ts";
import type { AppSettings, SessionState } from "../../shared/ipc.ts";
import type {
  Decision,
  DeskSnapshot,
  FocusSnapshot,
  PolicyEvent,
} from "../../shared/types.ts";
import type { ForecastFrameSink } from "./recorder.ts";
import bundledWeights from "../../shared/forecast/weights.json";

/**
 * ForecastMonitor — the main-process observer behind the push-wrapper tap.
 * Pure observer + advisory override: it never starts a countdown, never
 * retargets or suppresses a kill, and its entire authority over enforcement
 * is the one number `beforeStep` returns into `input.countdownSec`.
 *
 * No timers of its own: the controller's evaluate loop calls
 * `hook.beforeStep(now, baseCountdownSec)` once per `evaluateOnce` with the
 * injected clock, and the monitor closes one telemetry frame per elapsed wall
 * second there (inference + escalation run on frame close, 1 Hz). A focusKind
 * change forces an immediate display-only recompute, rate-capped to 4 Hz —
 * every focus snapshot already enqueues an evaluate, so no timer is needed.
 *
 * Failure containment: every entry point is guarded; the first thrown error
 * turns the forecast off for the session (one `forecast` log line, base
 * countdown restored) and the session proceeds exactly as today. Everything
 * here is synchronous and sub-millisecond — nothing can delay a kill.
 */

/** Minimum gap between forced (focus-change) recomputes — 4 Hz cap. */
export const FORCED_INFER_MIN_GAP_MS = 250;

export interface ForecastMonitorOptions {
  loadSettings(): AppSettings;
  /** Writes a SessionEvent{kind:"forecast"} — wired by the runtime. */
  appendLog(detail: string): void;
  push: ForecastPush;
  /** Untrusted weights payload; defaults to the committed weights.json. */
  weights?: unknown;
  /** Env-gated JSONL recorder; null/omitted disables recording. */
  recorder?: ForecastFrameSink | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : String(error);
}

function pct(risk: number): string {
  return `${Math.round(risk * 100)}%`;
}

export class ForecastMonitor {
  private readonly loadSettings: () => AppSettings;
  private readonly appendLog: (detail: string) => void;
  private readonly push: ForecastPush;
  private readonly weights: ForecastWeightsFile | null;
  private readonly recorder: ForecastFrameSink | null;
  private readonly ring = new TelemetryRing();

  private active = false;
  /** Error latch — set by the first thrown error, cleared at session start. */
  private off = false;
  private enabled = false;
  private weightsWarned = false;
  /** True between session start and the first beforeStep (no clock yet). */
  private pendingReset = true;

  private sessionStartTs = 0;
  private sessionId = "";
  /** Last closed 1 Hz frame boundary (injected-clock ms). */
  private frameCursor = 0;
  /** Latest beforeStep clock — timestamps out-of-band escalation steps. */
  private lastNow = 0;
  private lastForcedTs: number | null = null;

  private decision: Decision = "IDLE";
  private countdownActive = false;
  private smoothed: number | null = null;
  private esc: EscalationState = { ...INITIAL_ESCALATION_STATE };
  private lastForward: ForecastForward | null = null;
  private lastFeatures: ForecastFeatureView[] | null = null;
  private lastSnapshot: ForecastSnapshot | null = null;

  readonly hook: ForecastHook = {
    beforeStep: (now, baseCountdownSec) => this.beforeStep(now, baseCountdownSec),
  };

  constructor(options: ForecastMonitorOptions) {
    this.loadSettings = options.loadSettings;
    this.appendLog = options.appendLog;
    this.push = options.push;
    // Fail closed: any weights violation ⇒ null ⇒ ready:false forever and the
    // session runs exactly as today.
    this.weights = parseForecastWeights(options.weights ?? bundledWeights);
    this.recorder = options.recorder ?? null;
  }

  /** Latest snapshot for FORECAST_GET_STATE; null between sessions. */
  getSnapshot(): ForecastSnapshot | null {
    const snap = this.lastSnapshot;
    if (snap === null) {
      return null;
    }
    return {
      ...snap,
      features: snap.features.map((feature) => ({ ...feature })),
      hidden: [...snap.hidden],
    };
  }

  // ---------------------------------------------------------------- tap ----

  onSessionState(state: SessionState): void {
    try {
      if (state.sessionActive && !this.active) {
        this.active = true;
        this.off = false; // the error latch is per session
        this.pendingReset = true;
        this.lastSnapshot = null;
        this.enabled = this.loadSettings().forecastEnabled;
        if (this.enabled && this.weights === null && !this.weightsWarned) {
          this.weightsWarned = true;
          this.safeLog("off · model weights invalid — forecast silent, base fuse in force");
        }
      } else if (!state.sessionActive && this.active) {
        this.active = false;
        this.pendingReset = true;
        this.lastSnapshot = null;
      }
    } catch (error) {
      this.trip(error);
    }
  }

  onPolicyEvent(event: PolicyEvent): void {
    this.guard<void>(() => {
      if (!this.running()) {
        return;
      }
      switch (event.type) {
        case "status": {
          // `status` gives the authoritative Decision — the forecast never
          // re-derives policy's verdicts. Stepping the reducer on drifted-ness
          // flips keeps the receipt (hit/miss) exact even for sub-second flaps.
          const wasDrifted = isDriftedDecision(this.decision);
          this.decision = event.decision;
          this.ring.noteStatus(event.decision);
          if (isDriftedDecision(event.decision) !== wasDrifted) {
            this.stepNow(null);
          }
          return;
        }
        case "start_countdown":
          this.countdownActive = true;
          this.stepNow("start_countdown"); // latches the fuse value in force
          return;
        case "cancel_countdown":
          this.countdownActive = false;
          this.stepNow("cancel_countdown");
          return;
        case "kill":
          this.countdownActive = false;
          this.stepNow("kill");
          return;
        case "unlock":
          this.stepNow("unlock");
          return;
        default:
          return;
      }
    }, undefined);
  }

  onFocus(snap: FocusSnapshot): void {
    this.guard<void>(() => {
      if (!this.running() || this.pendingReset) {
        return;
      }
      const before = this.ring.currentFocusKind;
      this.ring.noteFocus(snap);
      if (focusKind(snap) !== before) {
        this.forcedInference(snap.ts);
      }
    }, undefined);
  }

  onDesk(snap: DeskSnapshot): void {
    this.guard<void>(() => {
      if (!this.running() || this.pendingReset) {
        return;
      }
      this.ring.noteDesk(snap, this.loadSettings().deskThreshold);
    }, undefined);
  }

  // --------------------------------------------------------------- hook ----

  /**
   * Called once per evaluateOnce, before buildPolicyInput, active path only.
   * Returns the countdownSec policy should see this step, or null for "no
   * override" — bytes identical to today.
   */
  beforeStep(now: number, baseCountdownSec: number): number | null {
    return this.guard<number | null>(() => {
      this.lastNow = now;
      if (!this.active || this.weights === null) {
        return null;
      }
      const settings = this.loadSettings();
      this.enabled = settings.forecastEnabled;
      if (!this.enabled) {
        // Kill switch: base fuse back immediately; a mid-session re-enable
        // starts from a fresh ring and a full warm-up.
        this.pendingReset = true;
        this.lastSnapshot = null;
        return null;
      }
      if (this.pendingReset) {
        this.resetForSession(now);
      }
      this.closeFrames(now, settings, this.weights);
      const fuse = effectiveFuseSec(this.esc, this.escSettings(settings));
      if (fuse === null) {
        return null; // not pre-armed, no burn — controller uses its own base
      }
      if (this.esc.latchedFuseSec !== null) {
        return fuse; // burning — the latched value is frozen, whatever settings do
      }
      // Pre-armed but not burning: bounded [3, base], never lengthened.
      return Math.max(PREARM_FUSE_FLOOR_SEC, Math.min(baseCountdownSec, fuse));
    }, null);
  }

  // ---------------------------------------------------------- internals ----

  private running(): boolean {
    return this.active && this.enabled && this.weights !== null;
  }

  private isReady(ts: number): boolean {
    return (
      this.weights !== null &&
      !this.pendingReset &&
      ts - this.sessionStartTs >= FORECAST_WARMUP_SEC * 1000
    );
  }

  private resetForSession(now: number): void {
    this.ring.reset(now);
    this.sessionStartTs = now;
    this.sessionId = `rec-${now}`;
    this.frameCursor = now;
    this.lastForcedTs = null;
    this.decision = "IDLE";
    this.countdownActive = false;
    this.smoothed = null;
    this.esc = { ...INITIAL_ESCALATION_STATE };
    this.lastForward = null;
    this.lastFeatures = null;
    this.lastSnapshot = null;
    this.pendingReset = false;
  }

  private escSettings(settings: AppSettings): EscalationSettings {
    return {
      nudgeRisk: settings.forecastNudgeRisk,
      prearmRisk: settings.forecastPrearmRisk,
      prearmEnabled: settings.forecastPrearmEnabled,
      prearmFuseSec: settings.forecastPrearmFuseSec,
      baseFuseSec: settings.countdownSec,
    };
  }

  /** Closes every whole elapsed second — inference and escalation at 1 Hz. */
  private closeFrames(now: number, settings: AppSettings, weights: ForecastWeightsFile): void {
    if (now - this.frameCursor > FRAME_CAPACITY * 1000) {
      // Clock jumped past the ring's whole horizon (suspend/resume) — drop
      // the gap instead of grinding through hundreds of empty frames.
      this.frameCursor = now - FRAME_CAPACITY * 1000;
    }
    let lastClosedTs: number | null = null;
    while (this.frameCursor + 1000 <= now) {
      this.frameCursor += 1000;
      const frame = this.ring.commit(this.frameCursor);
      if (frame !== null) {
        this.onFrameClosed(frame, settings, weights);
        lastClosedTs = frame.ts;
      }
    }
    // ONE snapshot per beforeStep, not one per closed frame. Steady state
    // closes a single frame, so this is unchanged there; a lid-open closes up
    // to FRAME_CAPACITY of them, and firing 600 synchronous webContents.send
    // calls inside the kill path would buy the UI nothing — it renders only
    // the newest. The reducer still steps per frame above, so the sustain
    // counters and every escalation event are unaffected.
    if (lastClosedTs !== null && this.lastForward !== null && this.lastFeatures !== null) {
      this.publishSnapshot(lastClosedTs, settings, this.lastForward, this.lastFeatures);
    }
  }

  private onFrameClosed(
    frame: TelemetryFrame,
    settings: AppSettings,
    weights: ForecastWeightsFile,
  ): void {
    const ts = frame.ts;
    const extraction = extractFeatures(this.ring, ts);
    const fwd = forward(weights, extraction.values);
    const attr = attributions(weights, extraction.values);
    this.smoothed = smoothRisk(this.smoothed, fwd.rawRisk);
    this.lastForward = fwd;
    this.lastFeatures = this.featureViews(extraction, attr);
    this.recordFrame(frame, extraction, ts);

    const input: EscalationInput = {
      ts,
      risk: this.smoothed,
      ready: this.isReady(ts),
      decision: this.decision,
      countdownActive: this.countdownActive,
      policySignal: null,
      settings: this.escSettings(settings),
    };
    const { state, events } = stepEscalation(this.esc, input);
    this.esc = state;
    this.emitEvents(events, input.ready);
    // The snapshot is published by closeFrames, once, after the last frame.
  }

  /**
   * Out-of-band reducer step on tapped policy signals and drift flips — the
   * latch and the receipt must be exact, not up to a second late. During a
   * countdown the reducer suppresses band moves, so these extra steps never
   * inflate the 1 Hz sustain counters where it matters.
   */
  private stepNow(signal: EscalationInput["policySignal"]): void {
    if (this.pendingReset) {
      return; // no clock yet this session
    }
    const settings = this.loadSettings();
    const input: EscalationInput = {
      ts: this.lastNow,
      risk: this.smoothed ?? 0,
      ready: this.isReady(this.lastNow),
      decision: this.decision,
      countdownActive: this.countdownActive,
      policySignal: signal,
      settings: this.escSettings(settings),
    };
    const before = this.esc;
    const { state, events } = stepEscalation(this.esc, input);
    this.esc = state;
    this.emitEvents(events, input.ready);
    const changed =
      events.length > 0 ||
      state.band !== before.band ||
      state.prearmedAt !== before.prearmedAt ||
      state.latchedFuseSec !== before.latchedFuseSec;
    if (changed && this.lastForward !== null && this.lastFeatures !== null) {
      this.publishSnapshot(this.lastNow, settings, this.lastForward, this.lastFeatures);
    }
  }

  /**
   * Display-only recompute on a focusKind change so the needle moves within
   * one evaluate of an alt-tab. Does NOT advance the EMA or the escalation —
   * those stay strictly 1 Hz for deterministic sustain counting.
   */
  private forcedInference(ts: number): void {
    if (this.weights === null || !Number.isFinite(ts)) {
      return;
    }
    if (this.lastForcedTs !== null && ts - this.lastForcedTs < FORCED_INFER_MIN_GAP_MS) {
      return;
    }
    this.lastForcedTs = ts;
    const extraction = extractFeatures(this.ring, ts);
    const fwd = forward(this.weights, extraction.values);
    const attr = attributions(this.weights, extraction.values);
    this.lastForward = fwd;
    this.lastFeatures = this.featureViews(extraction, attr);
    this.publishSnapshot(ts, this.loadSettings(), fwd, this.lastFeatures);
  }

  private featureViews(extraction: FeatureExtraction, attr: number[]): ForecastFeatureView[] {
    return FORECAST_FEATURE_KEYS.map((key, index) => ({
      key,
      raw: extraction.raw[key],
      value: extraction.values[index] ?? 0,
      attribution: attr[index] ?? 0,
    }));
  }

  /** Top-3 positive attribution keys — toast copy for the nudge event. */
  private topFeatureKeys(): ForecastFeatureKey[] {
    return this.lastFeatures === null ? [] : topPositiveKeys(this.lastFeatures);
  }

  /**
   * Fan out reducer events. Nothing leaves during warm-up — the model had no
   * chance yet, so even a receipt would be dishonest (and the reducer's own
   * state, not the fan-out, is what keeps the ledger consistent). This is
   * also what keeps an enabled-but-warming session byte-identical to today.
   */
  private emitEvents(events: ForecastEvent[], ready: boolean): void {
    if (!ready) {
      return;
    }
    for (const event of events) {
      const enriched: ForecastEvent =
        event.type === "forecast_nudge"
          ? { ...event, topFeatures: this.topFeatureKeys() }
          : event;
      this.push.event(enriched);
      this.safeLog(this.formatEvent(enriched));
    }
  }

  private formatEvent(event: ForecastEvent): string {
    switch (event.type) {
      case "forecast_nudge":
        return `nudge · risk ${pct(event.risk)} · ${
          event.topFeatures.length > 0 ? event.topFeatures.join(", ") : "no single driver"
        }`;
      case "forecast_prearm":
        return `pre-arm · risk ${pct(event.risk)} · fuse ${event.fuseSec}s`;
      case "forecast_clear":
        return event.wasPrearmed
          ? `pre-arm stood down · unconfirmed · risk ${pct(event.risk)}`
          : `clear · risk ${pct(event.risk)}`;
      case "forecast_hit":
        return `hit · called ${Math.round(event.leadSec * 10) / 10}s early`;
      case "forecast_miss":
        return "miss — no warning";
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
        return "forecast event";
      }
    }
  }

  private recordFrame(frame: TelemetryFrame, extraction: FeatureExtraction, ts: number): void {
    if (this.recorder === null) {
      return;
    }
    this.recorder.record({
      v: 1,
      session_id: this.sessionId,
      source: "recorded",
      archetype: "unknown",
      t: Math.round((ts - this.sessionStartTs) / 1000),
      features: [...extraction.values],
      raw: { ...extraction.raw },
      label: null,
      secs_to_drift: null,
      drift_type: null,
      procHash: processHash(frame.processKey),
      titleHash: frame.titleHash,
      focusKind: frame.focusKind,
      deskPresence: frame.deskPresence,
      deskConfidence: frame.deskConfidence,
      webcamEnabled: frame.webcamEnabled,
      decision: this.decision,
      countdownActive: this.countdownActive,
    });
  }

  private publishSnapshot(
    ts: number,
    settings: AppSettings,
    fwd: ForecastForward,
    features: ForecastFeatureView[],
  ): void {
    const escSettings = this.escSettings(settings);
    const ready = this.isReady(ts);
    const fuse = effectiveFuseSec(this.esc, escSettings);
    const snap: ForecastSnapshot = {
      ts,
      ready,
      warmupRemainingSec: ready
        ? 0
        : Math.max(0, Math.ceil((this.sessionStartTs + FORECAST_WARMUP_SEC * 1000 - ts) / 1000)),
      risk: this.smoothed ?? fwd.rawRisk,
      rawRisk: fwd.rawRisk,
      logit: fwd.logit,
      band: this.esc.band,
      horizonSec: FORECAST_HORIZON_SEC,
      features: features.map((feature) => ({ ...feature })),
      hidden: [...fwd.hidden],
      prearmedAt: this.esc.prearmedAt,
      effectiveFuseSec: fuse ?? escSettings.baseFuseSec,
      baseFuseSec: escSettings.baseFuseSec,
      modelVersion: FORECAST_MODEL_VERSION,
      paramCount: FORECAST_PARAM_COUNT,
    };
    this.lastSnapshot = snap;
    this.push.snapshot(snap);
  }

  private guard<T>(fn: () => T, fallback: T): T {
    if (this.off) {
      return fallback;
    }
    try {
      return fn();
    } catch (error) {
      this.trip(error);
      return fallback;
    }
  }

  /** First error ⇒ off for the session: one log line, base fuse restored. */
  private trip(error: unknown): void {
    if (this.off) {
      return;
    }
    this.off = true;
    this.lastSnapshot = null;
    this.safeLog(`off · ${errorMessage(error)}`);
  }

  private safeLog(detail: string): void {
    try {
      this.appendLog(detail);
    } catch {
      // Logging must never take the forecast (or the session) down with it.
    }
  }
}
