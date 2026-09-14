import type { AppSettings, SessionState } from "../../shared/ipc.ts";
import type { PolicyEvent } from "../../shared/types.ts";
import type { DriftType, ForecastEvent, ForecastSnapshot } from "../../shared/forecast/types.ts";
import {
  cappedDrifts,
  classifyRound,
  driftTypeOf,
  exclusionReason,
  firstOnsetStartedDrifted,
  stepOnset,
} from "../../shared/plan/drift.ts";
import type {
  FocusPlanLedger,
  FocusPlanState,
  OnsetState,
  PlanPush,
  PlanRound,
  PlanTap,
  SessionPlanContext,
} from "../../shared/plan/types.ts";
import { accumulateServed } from "../../shared/plan/ledger.ts";
import { seedNotice } from "../../shared/plan/copy.ts";
import { retractionLogLine } from "../../shared/plan/retract.ts";
import type { PlanRetraction } from "../../shared/correction/types.ts";
import type { Decision } from "../../shared/types.ts";
import { applyPlanRetraction } from "./retract.ts";
import {
  appendPlanRound,
  clonePlanRound,
  emptyPlanLedger,
  localDayStamp,
  planStateWindow,
  revivePlanLedger,
} from "./ledger.ts";

/**
 * PlanRecorder — the main-process observer behind the push-wrapper tap.
 *
 * It is a pure observer and a JSON file. It never starts a countdown, never
 * retargets or suppresses a kill, never touches the fuse, and has no seam into
 * `SessionControllerOptions` at all: everything it knows arrives through
 * `withPlan` / `withPlanForecast`, and everything it produces leaves through
 * `PlanPush` and `<userData>/focus-plan.json`. That is the whole reason this
 * feature is safe to ship next to a process killer, and `integration.test.ts`
 * asserts it rather than promising it.
 *
 * Failure containment copies `ForecastMonitor` exactly: every entry point is
 * guarded, the first thrown error latches Focus Plan off FOR THE SESSION with
 * one `plan · off · <message>` line, and the session proceeds untouched.
 *
 * The drift definition is imported, never re-derived — `stepOnset` over
 * `src/shared/plan/drift.ts`, which `drift.test.ts` pins to the forecast's own
 * `findDriftOnsets`. There is one definition of a drift in this product.
 */

/** The two optional ledger methods, mirroring `AdaptiveFuseStore` exactly. */
export interface PlanLedgerStore {
  loadPlanLedger?(): unknown;
  savePlanLedger?(value: unknown): void;
}

export interface PlanRecorderOptions {
  loadSettings(): AppSettings;
  /** Writes a `SessionEvent{kind:"plan"}` — the runtime wires store + push. */
  appendLog(detail: string): void;
  push: PlanPush;
  /** Absent ⇒ nothing is persisted; the session and the pushes are unaffected. */
  store?: PlanLedgerStore | null;
  now?: () => number;
}

/**
 * The filming pin, mirroring `FOCUSPLUG_NO_ADAPT=1`.
 *
 * `FOCUSPLUG_NO_ADAPT=1` does not remove the fuse; it pins the fuse to the
 * un-personalised Settings value. This is the same move one layer up: Focus
 * Plan stays SWITCHED ON and the plan card stays on screen, pinned to the
 * cold-start rung, while the ledger on disk is neither read, written, nor
 * added to. A scripted demo is then not at the mercy of yesterday's rounds.
 *
 * It is therefore NOT the master switch: `focusPlanEnabled: false` removes
 * the cards, and `recorder.test.ts` pins the difference between the two.
 */
export const PLAN_PIN_ENV = "FOCUSPLUG_NO_PLAN";

interface OpenRound {
  key: string;
  /** Epoch ms of the FIRST arm — carried across a pause/resume. */
  startedAt: number;
  lastTickMs: number;
  /** Total served seconds across every segment of this round. */
  servedSec: number;
  plannedFocusSec: number;
  round: number;
  roundsTotal: number;
  recommendedFocusSec: number | null;
  acceptedRecommendation: boolean;
  onsets: OnsetState;
  /** Onsets a correction removed. Carried across a pause/resume like every
   *  other measurement, so a resumed segment cannot quietly relaunder an
   *  edited history back into an unmarked one. */
  retractedDriftsSec: number[];
  firstDriftType: DriftType | null;
  sawStatus: boolean;
  startedDrifted: boolean;
  countdowns: number;
  kills: number;
  wobbles: number;
  standDowns: number;
  firstWobbleSec: number | null;
  peakRisk: number | null;
  peakRiskSec: number | null;
  firstDriftLeadSec: number | null;
  forecastOn: boolean;
}

/** What a pause leaves behind so the resume can continue the same round. */
interface CarriedRound {
  key: string;
  round: PlanRound;
  /** `OnsetState.sawClean` at the moment the segment closed. */
  sawClean: boolean;
  /**
   * `OnsetState.last` at the moment the segment closed — the decision the
   * stream was sitting on when the pause stopped the clock.
   *
   * This one field is the whole of "was the episode still open?", which is
   * condition (a) of the retraction rule. Without it a false `away` pause and
   * a drift that had already ended would be indistinguishable.
   */
  lastDecision: Decision | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : String(error);
}

function minutes(seconds: number): string {
  return (seconds / 60).toFixed(1);
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.round(value)
    : fallback;
}

function nonNegativeSec(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * The `SESSION_START` argument is renderer input and therefore untrusted.
 * Anything malformed costs the CONTEXT, never the round and never the session:
 * a round with no usable context is still measured, just without a planned
 * length to compare against (§12, cut line 6).
 */
export function normalizePlanContext(value: unknown): SessionPlanContext | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.roundKey !== "string") {
    return null;
  }
  const roundKey = raw.roundKey.trim().slice(0, 120);
  if (roundKey.length === 0) {
    return null;
  }
  const recommended =
    typeof raw.recommendedFocusSec === "number" &&
    Number.isFinite(raw.recommendedFocusSec) &&
    raw.recommendedFocusSec >= 0
      ? raw.recommendedFocusSec
      : null;
  return {
    roundKey,
    round: positiveInt(raw.round, 1),
    roundsTotal: positiveInt(raw.roundsTotal, 1),
    plannedFocusSec: nonNegativeSec(raw.plannedFocusSec),
    plannedBreakSec: nonNegativeSec(raw.plannedBreakSec),
    recommendedFocusSec: recommended,
    acceptedRecommendation: raw.acceptedRecommendation === true,
  };
}

export class PlanRecorder implements PlanTap {
  private readonly loadSettings: () => AppSettings;
  private readonly appendLog: (detail: string) => void;
  private readonly push: PlanPush;
  private readonly store: PlanLedgerStore | null;
  private readonly now: () => number;
  /** `FOCUSPLUG_NO_PLAN=1`: the ledger is not read, not written, not added
   *  to — and the plan card renders the cold-start rung. See `PLAN_PIN_ENV`. */
  private readonly pinned: boolean;

  private ledger: FocusPlanLedger | null = null;
  /** The round key the seeded-history notice was last printed for; "startup"
   *  for the read that happens before any round. See `noticeSeed`. */
  private seedNoticedFor: string | null = null;
  private active = false;
  /** Error latch — set by the first thrown error, cleared at session start. */
  private off = false;
  private pending: SessionPlanContext | null = null;
  private open: OpenRound | null = null;
  private carried: CarriedRound | null = null;

  constructor(options: PlanRecorderOptions) {
    this.loadSettings = options.loadSettings;
    this.appendLog = options.appendLog;
    this.push = options.push;
    this.store = options.store ?? null;
    this.now = options.now ?? Date.now;
    this.pinned = process.env[PLAN_PIN_ENV] === "1";
  }

  // ------------------------------------------------------------ commands ----

  /**
   * Consume the optional `SESSION_START` argument. Called SYNCHRONOUSLY
   * immediately before `controller.start()` in `src/main/index.ts`, which is
   * why there is no accept/start race and no pending-block adoption machinery:
   * the context is always in hand before the first `sessionState` arrives.
   */
  declareRound(context: unknown): void {
    if (this.off) {
      // The latch is per session, exactly like the forecast's. If it tripped
      // mid-round then that round's close never ran, so drop it here rather
      // than let a dangling `active` swallow the round about to start.
      this.off = false;
      this.open = null;
      this.active = false;
    }
    try {
      this.pending = normalizePlanContext(context);
    } catch {
      this.pending = null;
    }
  }

  /** `PLAN_GET_STATE`. Closed rounds only — the live round is renderer-side. */
  getState(): FocusPlanState {
    return this.attempt<FocusPlanState>(() => {
      // Pinned reports a fresh install and never touches the disk, so the card
      // renders the cold-start rung; switched off reports no window at all, so
      // the cards render nothing. Those are different answers on purpose.
      const ledger = this.pinned ? emptyPlanLedger() : this.readLedger();
      const enabled = this.enabledNow();
      return {
        v: 1,
        enabled,
        // Off means off: the cards render nothing rather than yesterday's
        // history. `lifetimeRounds` still reports what is on disk so Settings
        // can offer to forget it — except when pinned, where the pin's whole
        // job is to make the app look like it has never seen this student.
        rounds: enabled ? planStateWindow(ledger.rounds, this.now()) : [],
        lifetimeRounds: ledger.lifetimeRounds,
      };
    }, { v: 1, enabled: false, rounds: [], lifetimeRounds: 0 });
  }

  /** `PLAN_RESET`. Touches neither the adaptive model, the log, nor settings. */
  reset(): FocusPlanState {
    return this.attempt<FocusPlanState>(() => {
      if (this.pinned) {
        // No writes means no writes. The pin makes the app LOOK like a fresh
        // install; erasing the real history to match would be the one way a
        // filming switch could cost a student something.
        return { v: 1, enabled: this.enabledNow(), rounds: [], lifetimeRounds: 0 };
      }
      const before = this.readLedger().lifetimeRounds;
      const empty = emptyPlanLedger();
      this.ledger = empty;
      this.carried = null;
      this.writeLedger(empty);
      this.safeLog(`history cleared (${before} ${before === 1 ? "round" : "rounds"})`);
      return { v: 1, enabled: this.enabledNow(), rounds: [], lifetimeRounds: 0 };
    }, { v: 1, enabled: false, rounds: [], lifetimeRounds: 0 });
  }

  /**
   * `retractLastAwayDrift` — a COMMAND, like `PLAN_RESET`, and never a tap.
   *
   * Focus Plan gains no seam into the desk stack: `runtime.ts` injects this as
   * a callback into the corrections service, so the uncoupling assertion in
   * `integration.test.ts` still holds. It runs under the existing `attempt()`
   * guard and therefore never throws — a retraction that fails costs the
   * retraction and never the session, and the behavioural half of the
   * correction (resume, cooldown) has already happened regardless.
   */
  retractLastAwayDrift(): PlanRetraction {
    return this.attempt<PlanRetraction>(() => {
      const carried = this.carried;
      const outcome = applyPlanRetraction({
        enabled: this.enabledNow(),
        pinned: this.pinned,
        round: carried?.round ?? null,
        lastDecision: carried?.lastDecision ?? null,
        ledger: this.pinned ? emptyPlanLedger() : this.readLedger(),
      });
      if (outcome.round === null || carried === null) {
        // Named, never silent: a refusal the student cannot see would be the
        // one failure mode this disclosure exists to prevent.
        if (carried !== null) {
          this.safeLog(retractionLogLine(carried.round.round, outcome.retraction));
        }
        return outcome.retraction;
      }
      // `carried` first: a resume under the same key seeds its onsets from
      // this round, so the rewrite has to be in hand before anything else can
      // read it.
      this.carried = { ...carried, round: outcome.round };
      if (!this.pinned) {
        this.ledger = outcome.ledger;
        this.writeLedger(outcome.ledger);
      }
      // Push the rewritten round so every open surface reconciles: the
      // renderer's ledger replaces by `roundKey`, exactly as a round close does.
      this.push.round(clonePlanRound(outcome.round));
      this.safeLog(retractionLogLine(outcome.round.round, outcome.retraction));
      return outcome.retraction;
    }, {
      retracted: false,
      roundKey: null,
      retractedAtSec: null,
      firstDriftSecBefore: null,
      firstDriftSecAfter: null,
      refusal: "no-round",
    });
  }

  // ----------------------------------------------------------------- tap ----

  onSessionState(state: SessionState): void {
    this.guard<void>(() => {
      if (state.sessionActive && !this.active) {
        this.active = true;
        this.openRound();
        return;
      }
      if (!state.sessionActive && this.active) {
        this.active = false;
        this.closeRound();
        return;
      }
      // The controller republishes state at the tick rate, which is the
      // recorder's clock: every one of these is a served-seconds sample.
      this.advance();
    }, undefined);
  }

  onPolicyEvent(event: PolicyEvent): void {
    this.guard<void>(() => {
      const open = this.open;
      if (open === null) {
        return;
      }
      this.advance();
      switch (event.type) {
        case "status": {
          open.sawStatus = true;
          const before = open.onsets;
          const after = stepOnset(before, event.decision, open.servedSec);
          // The FIRST kept onset is the one the metric reports, so its flavour
          // and the started-drifted verdict are both read off this step.
          if (before.onsetsSec.length === 0 && after.onsetsSec.length === 1) {
            open.firstDriftType = driftTypeOf(event.decision);
            open.startedDrifted =
              open.startedDrifted || firstOnsetStartedDrifted(before, after);
          }
          open.onsets = after;
          return;
        }
        case "start_countdown":
          open.countdowns += 1;
          return;
        case "kill":
          open.kills += 1;
          return;
        default:
          return;
      }
    }, undefined);
  }

  onForecastSnapshot(snap: ForecastSnapshot): void {
    this.guard<void>(() => {
      const open = this.open;
      if (open === null) {
        return;
      }
      this.advance();
      open.forecastOn = true;
      if (!snap.ready || !Number.isFinite(snap.risk)) {
        return;
      }
      if (open.peakRisk === null || snap.risk > open.peakRisk) {
        open.peakRisk = snap.risk;
        open.peakRiskSec = open.servedSec;
      }
    }, undefined);
  }

  onForecastEvent(event: ForecastEvent): void {
    this.guard<void>(() => {
      const open = this.open;
      if (open === null) {
        return;
      }
      this.advance();
      open.forecastOn = true;
      switch (event.type) {
        case "forecast_nudge":
          // A WOBBLE, never a drift (H7). It is counted, named and reported
          // with a different word, and it can never enter the estimator.
          open.wobbles += 1;
          if (open.firstWobbleSec === null) {
            open.firstWobbleSec = open.servedSec;
          }
          return;
        case "forecast_clear":
          if (event.wasPrearmed) {
            open.standDowns += 1;
          }
          return;
        case "forecast_hit":
          if (open.firstDriftLeadSec === null && Number.isFinite(event.leadSec)) {
            open.firstDriftLeadSec = Math.max(0, event.leadSec);
          }
          return;
        default:
          return;
      }
    }, undefined);
  }

  // ----------------------------------------------------------- internals ----

  /**
   * The master switch alone. The pin is deliberately NOT folded in here:
   * pinned still SHOWS Focus Plan, exactly as `FOCUSPLUG_NO_ADAPT=1` still
   * shows a fuse. What it shows is the cold-start rung.
   */
  private enabledNow(): boolean {
    try {
      return this.loadSettings().focusPlanEnabled === true;
    } catch {
      return false;
    }
  }

  /** On, and not pinned. Anything that measures or persists asks THIS. */
  private recordingNow(): boolean {
    return !this.pinned && this.enabledNow();
  }

  /**
   * Resolved ONCE, here: a settings flip mid-round cannot half-record one, and
   * `this.open === null` is the whole of "not recording".
   */
  private openRound(): void {
    const context = this.pending;
    this.pending = null;
    if (!this.recordingNow()) {
      this.open = null;
      return;
    }
    const now = this.now();
    const key = context?.roundKey ?? `session-${now}`;
    const carry = this.carried !== null && this.carried.key === key ? this.carried : null;
    const prior = carry?.round ?? null;
    this.open = {
      key,
      startedAt: prior?.startedAt ?? now,
      lastTickMs: now,
      servedSec: prior?.servedSec ?? 0,
      plannedFocusSec: context?.plannedFocusSec ?? prior?.plannedFocusSec ?? 0,
      round: context?.round ?? prior?.round ?? 1,
      roundsTotal: context?.roundsTotal ?? prior?.roundsTotal ?? 1,
      recommendedFocusSec: context?.recommendedFocusSec ?? prior?.recommendedFocusSec ?? null,
      acceptedRecommendation:
        context?.acceptedRecommendation ?? prior?.acceptedRecommendation ?? false,
      // A round always opens on IDLE, so locking with Discord already in front
      // produces an onset at roughly t = 0 — which is what makes
      // `startedDrifted` reachable without touching the drift definition.
      onsets: {
        last: "IDLE",
        onsetsSec: prior === null ? [] : [...prior.driftsSec],
        sawClean: carry?.sawClean ?? false,
      },
      retractedDriftsSec: [...(prior?.retractedDriftsSec ?? [])],
      firstDriftType: prior?.firstDriftType ?? null,
      sawStatus: false,
      startedDrifted: prior?.startedDrifted ?? false,
      countdowns: prior?.countdowns ?? 0,
      kills: prior?.kills ?? 0,
      wobbles: prior?.wobbles ?? 0,
      standDowns: prior?.standDowns ?? 0,
      firstWobbleSec: prior?.firstWobbleSec ?? null,
      peakRisk: prior?.peakRisk ?? null,
      peakRiskSec: prior?.peakRiskSec ?? null,
      firstDriftLeadSec: prior?.firstDriftLeadSec ?? null,
      forecastOn: prior?.forecastOn ?? this.forecastEnabledNow(),
    };
    // A round arming on top of fabricated history gets the disclosure next to
    // it in the log, rather than thirty lines above it at app start.
    this.noticeSeed(this.readLedger(), key);
  }

  private forecastEnabledNow(): boolean {
    try {
      return this.loadSettings().forecastEnabled === true;
    } catch {
      return false;
    }
  }

  /**
   * One served-seconds sample, through the pure core's own `accumulateServed`
   * so the clamp has exactly one implementation: a suspend, a lid close or a
   * coffee break cannot inflate the number — the metric means "how long you
   * can work", and wall time is not that.
   */
  private advance(): void {
    const open = this.open;
    if (open === null) {
      return;
    }
    const now = this.now();
    const deltaSec = (now - open.lastTickMs) / 1000;
    open.lastTickMs = now;
    open.servedSec = accumulateServed(open.servedSec, deltaSec);
  }

  private closeRound(): void {
    const open = this.open;
    if (open === null) {
      return;
    }
    // One last served-seconds sample before the round is sealed.
    this.advance();
    this.open = null;
    this.finishRound(open);
  }

  /** Build, push, log and persist. Split out so `closeRound` stays readable. */
  private finishRound(open: OpenRound): void {
    const endedAt = this.now();
    const stamp = localDayStamp(open.startedAt);
    const drifts = cappedDrifts(open.onsets.onsetsSec);
    const firstDriftSec = drifts[0] ?? null;
    // With no declared plan there is no "planned end" to have reached, so the
    // round can never be `completed`: an unbounded planned length makes
    // `classifyRound` say `aborted`, and its short-clean-round rule then
    // applies exactly as it does to a round the student ended early. The
    // STORED `plannedFocusSec` stays 0 — we did not know it, and it says so.
    const plannedForStatus =
      open.plannedFocusSec > 0 ? open.plannedFocusSec : Number.POSITIVE_INFINITY;
    const round: PlanRound = {
      v: 1,
      roundKey: open.key,
      startedAt: open.startedAt,
      endedAt,
      day: stamp.day,
      hour: stamp.hour,
      status: classifyRound({
        servedSec: open.servedSec,
        plannedFocusSec: plannedForStatus,
        firstDriftSec,
        sawStatus: open.sawStatus,
      }),
      servedSec: open.servedSec,
      plannedFocusSec: open.plannedFocusSec,
      round: open.round,
      roundsTotal: open.roundsTotal,
      recommendedFocusSec: open.recommendedFocusSec,
      acceptedRecommendation: open.acceptedRecommendation,
      firstDriftSec,
      firstDriftType: firstDriftSec === null ? null : open.firstDriftType,
      driftsSec: drifts,
      firstWobbleSec: open.firstWobbleSec,
      wobbles: open.wobbles,
      standDowns: open.standDowns,
      peakRisk: open.peakRisk,
      peakRiskSec: open.peakRisk === null ? null : open.peakRiskSec,
      firstDriftLeadSec: open.firstDriftLeadSec,
      countdowns: open.countdowns,
      kills: open.kills,
      startedDrifted: open.startedDrifted,
      forecastOn: open.forecastOn,
      // Absent by default: a round nothing was retracted from must not claim,
      // on screen, that something was.
      ...(open.retractedDriftsSec.length > 0
        ? { retractedDriftsSec: [...open.retractedDriftsSec] }
        : {}),
    };

    // A start/stop that saw nothing at all is not a round; recording it would
    // only put an empty grey row in the student's own evidence table.
    if (!open.sawStatus && round.servedSec < 1) {
      return;
    }

    this.carried = {
      key: round.roundKey,
      round,
      sawClean: open.onsets.sawClean,
      lastDecision: open.onsets.last,
    };

    // Push BEFORE persisting: a failed write costs the history, never the
    // debrief the student is about to read.
    this.push.round(clonePlanRound(round));
    this.safeLog(describeRound(round));

    const ledger = this.readLedger();
    const next = appendPlanRound(ledger, round);
    this.ledger = next.ledger;
    this.writeLedger(next.ledger);
  }

  private readLedger(): FocusPlanLedger {
    if (this.ledger !== null) {
      return this.ledger;
    }
    let raw: unknown = null;
    try {
      raw = this.store?.loadPlanLedger?.() ?? null;
    } catch {
      // A corrupt or unreadable ledger must never stop a session starting.
      raw = null;
    }
    this.ledger = revivePlanLedger(raw);
    this.noticeSeed(this.ledger, null);
    return this.ledger;
  }

  /**
   * Say out loud, in the app's own Log, that this history was written rather
   * than served.
   *
   * A ledger `scripts/demo-seed.ts` wrote is indistinguishable on screen from
   * one the student earned — same card, same numbers, same evidence table —
   * so the disclosure cannot live only in the JSON. It is printed once when
   * the ledger is first read (app start) and once more for each round that
   * arms on top of it, keyed so a pause/resume of the same round does not
   * repeat it. The recorder never WRITES a stamp; it only ever repeats one.
   */
  private noticeSeed(ledger: FocusPlanLedger, roundKey: string | null): void {
    const seed = ledger.seed;
    if (seed === undefined) {
      return;
    }
    const tag = roundKey ?? "startup";
    if (this.seedNoticedFor === tag) {
      return;
    }
    this.seedNoticedFor = tag;
    this.safeLog(seedNotice(seed));
  }

  private writeLedger(ledger: FocusPlanLedger): void {
    const save = this.store?.savePlanLedger;
    if (save === undefined) {
      return;
    }
    try {
      save.call(this.store, ledger);
    } catch (error) {
      // Recording is best-effort; a failed write costs history, not a session.
      this.trip(error);
    }
  }

  /**
   * The tap's guard: once latched off, the handlers stop doing anything at all
   * for the rest of the session.
   */
  private guard<T>(fn: () => T, fallback: T): T {
    if (this.off) {
      return fallback;
    }
    return this.attempt(fn, fallback);
  }

  /**
   * The command guard. `PLAN_GET_STATE` and `PLAN_RESET` are not on the
   * session path, and a recorder that failed to WRITE can still read: a
   * latched session must not make Settings claim the student has no history.
   */
  private attempt<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (error) {
      this.trip(error);
      return fallback;
    }
  }

  /** First error ⇒ off for the session: one log line, nothing else changes. */
  private trip(error: unknown): void {
    if (this.off) {
      return;
    }
    this.off = true;
    this.open = null;
    this.safeLog(`off · ${errorMessage(error)}`);
  }

  private safeLog(detail: string): void {
    try {
      this.appendLog(detail);
    } catch {
      // Logging must never take Focus Plan (or the session) down with it.
    }
  }
}

/** The `plan · …` log line for one closed round. */
export function describeRound(round: PlanRound): string {
  const label = `round ${round.round}`;
  const reason = exclusionReason(round);
  if (reason !== null) {
    return `${label} — not counted, ${reason}`;
  }
  const planned = round.plannedFocusSec > 0
    ? ` (planned ${Math.round(round.plannedFocusSec / 60)})`
    : "";
  if (round.firstDriftSec !== null) {
    return `${label} — first drift at ${minutes(round.firstDriftSec)} min${planned}`;
  }
  return `${label} — no drift in ${minutes(round.servedSec)} min (censored, ${round.status})`;
}
