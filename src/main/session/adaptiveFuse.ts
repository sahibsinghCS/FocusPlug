/**
 * The adaptive fuse, wired to a live session.
 *
 * `src/shared/adapt` knows how to pick a countdown length and how to learn from
 * what happened; it does not know what a session is. This is the piece in
 * between: it watches the same snapshots the policy watches, builds the
 * `DriftMoment` at the instant a countdown arms, and folds the outcome back in
 * when that countdown is cancelled or runs to a kill.
 *
 * Nothing here talks to the network. The model is per-install, learned from
 * drifts the app was already producing, and lives in the user's own data dir.
 */

import { chooseFuse, type FuseChoice } from "../../shared/adapt/fuse.ts";
import type { DriftMoment } from "../../shared/adapt/features.ts";
import { createModel, reviveModel, type AdaptiveModel } from "../../shared/adapt/model.ts";
import { observeDrift } from "../../shared/adapt/train.ts";
import type { DeskSnapshot, FocusSnapshot } from "../../shared/types.ts";

/**
 * The planned session length is renderer state — the Pomodoro timer never
 * moved a main-process contract — so main cannot know it. `sessionLeft` is one
 * feature of seventeen, and a wrong constant biases it consistently rather
 * than randomly, so a fixed default is honest enough until the timer exposes
 * the real plan.
 */
export const ASSUMED_SESSION_MIN = 25;

/** Foreground switches older than this stop counting toward restlessness. */
const SWITCH_WINDOW_MS = 120_000;

interface ActiveDrift {
  moment: DriftMoment;
  choice: FuseChoice;
  startedAt: number;
}

export interface AdaptiveFuseStore {
  loadAdaptiveModel?(): unknown;
  saveAdaptiveModel?(value: unknown): void;
}

export class AdaptiveFuse {
  private model: AdaptiveModel;
  private readonly store: AdaptiveFuseStore | null;
  private readonly random: () => number;

  private sessionStartedAt: number | null = null;
  private focusProcess: string | null = null;
  private focusSince: number | null = null;
  private switchTimes: number[] = [];
  private priorDrifts = 0;
  private priorKills = 0;
  private active: ActiveDrift | null = null;
  /** Recomputed each tick; only read on the tick a countdown actually arms. */
  private pending: { moment: DriftMoment; choice: FuseChoice } | null = null;

  constructor(options: { store?: AdaptiveFuseStore; random?: () => number } = {}) {
    this.store = options.store ?? null;
    this.random = options.random ?? Math.random;
    this.model = this.restore();
  }

  private restore(): AdaptiveModel {
    try {
      const raw = this.store?.loadAdaptiveModel?.();
      if (raw !== null && raw !== undefined) {
        return reviveModel(raw);
      }
    } catch {
      // A corrupt or stale model file must never stop a session starting.
    }
    return createModel();
  }

  private persist(): void {
    try {
      this.store?.saveAdaptiveModel?.(this.model);
    } catch {
      // Learning is best-effort; a failed write costs accuracy, not a session.
    }
  }

  snapshot(): AdaptiveModel {
    return { ...this.model, weights: [...this.model.weights], prior: [...this.model.prior] };
  }

  startSession(ts: number): void {
    this.sessionStartedAt = ts;
    this.priorDrifts = 0;
    this.priorKills = 0;
    this.active = null;
    this.pending = null;
    this.switchTimes = [];
  }

  stopSession(): void {
    this.sessionStartedAt = null;
    this.active = null;
    this.pending = null;
  }

  /** Track dwell and restlessness from the same focus snapshots the policy sees. */
  noteFocus(snap: FocusSnapshot | null): void {
    if (snap === null) {
      return;
    }
    if (this.focusProcess !== snap.processName) {
      if (this.focusProcess !== null) {
        this.switchTimes.push(snap.ts);
      }
      this.focusProcess = snap.processName;
      this.focusSince = snap.ts;
    }
    const cutoff = snap.ts - SWITCH_WINDOW_MS;
    this.switchTimes = this.switchTimes.filter((at) => at >= cutoff);
  }

  /**
   * The fuse to hand the policy this tick. Returns `base` untouched whenever
   * there is nothing to decide, so a cold install behaves exactly as before.
   */
  fuseFor(
    input: { focus: FocusSnapshot | null; desk: DeskSnapshot | null },
    base: number,
    ts: number,
  ): number {
    if (this.sessionStartedAt === null || this.active !== null) {
      return base;
    }
    const violation = this.violationFor(input);
    if (violation === null) {
      this.pending = null;
      return base;
    }
    const moment: DriftMoment = {
      ts,
      sessionStartedAt: this.sessionStartedAt,
      sessionEndsAt: this.sessionStartedAt + ASSUMED_SESSION_MIN * 60_000,
      focus: input.focus,
      desk: input.desk,
      violation,
      dwellMs: this.focusSince === null ? 0 : Math.max(0, ts - this.focusSince),
      switchesLastTwoMin: this.switchTimes.length,
      priorDrifts: this.priorDrifts,
      priorKills: this.priorKills,
      fuseSec: base,
      hour: new Date(ts).getHours(),
    };
    const choice = chooseFuse(this.model, moment, base, { random: this.random });
    this.pending = { moment: { ...moment, fuseSec: choice.seconds }, choice };
    return choice.seconds;
  }

  /**
   * Which drift this is, by the same rule the policy classifies on: a blocked
   * foreground window is `blocked`, a confident empty chair is `away`.
   */
  private violationFor(input: {
    focus: FocusSnapshot | null;
    desk: DeskSnapshot | null;
  }): "blocked" | "away" | null {
    if (input.focus?.matchedBlock === true) {
      return "blocked";
    }
    if (input.desk?.label === "away") {
      return "away";
    }
    return null;
  }

  /** A countdown actually armed — freeze the moment we will learn from. */
  armed(seconds: number, ts: number): FuseChoice | null {
    const pending = this.pending;
    this.pending = null;
    if (pending === null) {
      return null;
    }
    this.active = {
      moment: { ...pending.moment, fuseSec: seconds },
      choice: pending.choice,
      startedAt: ts,
    };
    this.priorDrifts += 1;
    return pending.choice;
  }

  /** They fixed it themselves, this many ms after the countdown started. */
  recovered(ts: number): void {
    const active = this.active;
    this.active = null;
    if (active === null) {
      return;
    }
    const afterSec = Math.max(0, (ts - active.startedAt) / 1000);
    this.model = observeDrift(this.model, active.moment, {
      recoveredAfterSec: afterSec,
      fuseSec: active.moment.fuseSec,
      probed: active.choice.exploring,
    });
    this.persist();
  }

  /** The fuse ran out. Everything longer than it stays censored — see train.ts. */
  killed(): void {
    const active = this.active;
    this.active = null;
    if (active === null) {
      return;
    }
    this.priorKills += 1;
    this.model = observeDrift(this.model, active.moment, {
      recoveredAfterSec: null,
      fuseSec: active.moment.fuseSec,
      probed: active.choice.exploring,
    });
    this.persist();
  }
}
