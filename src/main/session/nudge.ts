import type { DeskDrift, NudgeKind, PauseKind } from "@shared/nudge";
import type { DeskSnapshot } from "@shared/types";

/** Off-task desk readings in a row before a drift counts. One is flicker. */
export const NUDGE_SUSTAIN_READINGS = 2;
/** A drift that continues re-nudges at most this often. */
export const NUDGE_REPEAT_MS = 30_000;

/**
 * Confirmed-away readings, all above the away floor, before the clock stops.
 * More than the nudge's two: a nudge costs a lamp and a glance, a pause costs
 * the student their round.
 */
export const PAUSE_SUSTAIN_AWAY = 3;
/**
 * Confirmed-phone readings before the clock stops. Deliberately higher than
 * `PAUSE_SUSTAIN_AWAY`: the trained presence head behind `away` is 92.5%
 * precise on that call (89.44% 3-way on the diverse-stock slice), while the
 * attention head behind `phone` runs 50-69% recall and calls roughly 17% of
 * non-phone photos "phone". Pausing a student who is working is the worst
 * thing this feature can do, so the weaker signal has to say it more times,
 * and louder (see `pausePhoneConfidence`). Neither count is what keeps the
 * *default* install safe — `deskModelMayPauseOnAway` does that.
 */
export const PAUSE_SUSTAIN_PHONE = 5;

/**
 * How long a confirmed away has to last before the clock stops.
 *
 * A reading count alone is not a duration: the desk monitor runs at 250 ms
 * (`DEFAULT_DESK_INTERVAL_MS`), so three readings is three quarters of a
 * second — long enough to nudge, nowhere near long enough to take a round off
 * someone who bent down for a pen. Fifteen seconds is a person who has left.
 *
 * This is a FLOOR and not the whole rule. It is long enough to clear the
 * shipped 10 s fuse, but the Settings slider goes to 30 s and the adaptive
 * fuse may hand out up to `MAX_FUSE_SEC`, so no constant can keep the two
 * features in their lanes on its own — `DriftPolicy.fuseBurning` does that.
 */
export const PAUSE_SUSTAIN_AWAY_MS = 15_000;
/**
 * The same floor for a phone, doubled — for the same reason the reading count
 * is higher. Half a minute of the weakest head in the product saying "phone",
 * above `pausePhoneConfidence`, without one frame dipping under it. That is a
 * hard bar on purpose: this rule is tuned to MISS rather than to fire wrongly,
 * because a missed pause costs a student nothing they had, and a wrong one
 * costs them a round they were working through.
 */
export const PAUSE_SUSTAIN_PHONE_MS = 30_000;

/** One desk reading, reduced to the drift it shows and how sure of it we are. */
interface DriftReading {
  kind: DeskDrift;
  /**
   * Confidence in *that* call: the presence head's for `away`, the attention
   * head's for `phone` / `unfocused`. They are different models, so they are
   * never compared against one shared floor.
   */
  confidence: number;
}

/** How much the tracker is allowed to do, from Settings. */
export interface DriftPolicy {
  /** Floor for a reading to count as a drift at all — Settings' `deskThreshold`. */
  threshold: number;
  /**
   * May a confirmed `away` stop the clock?
   *
   * TWO things have to be true, and the controller ANDs them: the student left
   * `pauseOnAwayEnabled` on, and the presence model that produced the reading
   * is one whose `away` earns a stopped clock (`deskModelMayPauseOnAway`). The
   * shipped default `blazeface` is not: it has no `away` class, so `away` is
   * what it answers when it cannot find a face, and 66.7% of at-desk frames in
   * the repo's own held-out eval come back that way. On it an `away` nudges
   * and stops there.
   */
  pauseOnAway: boolean;
  /** May a confirmed `phone` stop the clock? */
  pauseOnPhone: boolean;
  /** Presence-head floor a reading must clear to count toward an away pause. */
  awayConfidence: number;
  /** Attention-head floor a reading must clear to count toward a phone pause. */
  phoneConfidence: number;
  /**
   * A kill countdown is burning RIGHT NOW, so no pause may fire this reading.
   *
   * THE KILL GOES FIRST. Stopping the clock stops the session — the renderer
   * pauses, `shouldEnforce` drops, `Shell` calls `stopSession()` — and
   * `SessionController.stop()` builds a fresh `PolicyEngine`, which discards
   * a countdown mid-burn. A pause allowed to land inside the fuse would
   * therefore CANCEL the force-quit this product exists to perform, with the
   * student out of the room and nobody there to restart the clock.
   *
   * A duration floor cannot enforce that ordering, because the fuse is not a
   * constant: `countdownSec` is a Settings slider (3-30 s in the UI, 0-600 s
   * in the store), AdaptiveFuse personalises it and may explore up to
   * `MAX_FUSE_SEC`, and the Focus Forecast can pre-arm a shorter one. So the
   * gate is the live fuse itself, not arithmetic against it. The run keeps
   * counting while it is held; the pause fires on the first reading after the
   * countdown resolves — which is a kill, or a recovery that clears the run
   * anyway.
   */
  fuseBurning: boolean;
}

/**
 * What one desk reading asks the controller to do.
 *
 * A `Drift` is returned only when at least one flag is set, and the controller
 * pulls them back — window forward, overlay, lamp in `plugMode: "nudge"` — for
 * **either** of them. A stopped clock has to announce itself, and at the
 * shipped timings it cannot ride a nudge to do it: 15 s of away lands well
 * inside `NUDGE_REPEAT_MS`, so the reading that stops the clock arrives with
 * `nudge: false`. A pause held out for a long fuse can land on the same
 * reading as the next repeat nudge instead — which is why the controller acts
 * on either flag rather than treating them as two cases.
 */
export interface Drift {
  kind: NudgeKind;
  /**
   * The nudge gate cleared: `NUDGE_SUSTAIN_READINGS` readings in a row, and
   * the repeat window is not silencing this drift. This is the *gate*, not the
   * pull-back — see above, a pause-only reading pulls them back too.
   */
  nudge: boolean;
  /** Stop the study clock. Never true for `unfocused`, never for `uncertain`. */
  pause: boolean;
}

/**
 * Reduce a desk snapshot to what it is evidence of.
 *
 * `"focused"` is recovery and re-arms. `null` is *unsure* — a low-confidence
 * reading, a webcam that is off, a model with no attention head, and the
 * `uncertain` label, which is a first-class answer in this product and stays
 * non-actionable: neither drift nor recovery.
 */
function readDrift(desk: DeskSnapshot | null, threshold: number): DriftReading | "focused" | null {
  if (desk === null || !desk.webcamEnabled) {
    return null;
  }
  if (desk.label === "away") {
    // The presence head is the signal here, so it is the presence head's
    // confidence that has to clear the floor.
    if (!Number.isFinite(desk.confidence) || desk.confidence < threshold) {
      return null;
    }
    return { kind: "away", confidence: desk.confidence };
  }
  if (desk.label !== "at_desk" || !desk.attention) {
    return null;
  }
  const attention = desk.attention;
  if (!Number.isFinite(attention.confidence) || attention.confidence < threshold) {
    return null;
  }
  if (attention.label === "focused") {
    return "focused";
  }
  return { kind: attention.label, confidence: attention.confidence };
}

/**
 * The kind and its pause floor, or `null` when this drift may never pause —
 * because `unfocused` never can, or because its setting is off.
 */
function pauseGateFor(
  kind: DeskDrift,
  policy: DriftPolicy,
): { kind: PauseKind; floor: number } | null {
  if (kind === "away") {
    return policy.pauseOnAway ? { kind, floor: policy.awayConfidence } : null;
  }
  if (kind === "phone") {
    return policy.pauseOnPhone ? { kind, floor: policy.phoneConfidence } : null;
  }
  return null;
}

/** Both floors a confirmed run has to clear: how many readings, and how long. */
function pauseSustainFor(kind: PauseKind): { readings: number; ms: number } {
  return kind === "away"
    ? { readings: PAUSE_SUSTAIN_AWAY, ms: PAUSE_SUSTAIN_AWAY_MS }
    : { readings: PAUSE_SUSTAIN_PHONE, ms: PAUSE_SUSTAIN_PHONE_MS };
}

/**
 * Decides when a drift becomes a nudge, and when it becomes a pause.
 *
 * Readings the model is unsure about (low confidence, `uncertain`, webcam off,
 * no attention head) are neither drift nor recovery: they break a streak but
 * do not re-arm. A confident `focused` reading re-arms immediately, so a
 * second drift after refocusing nudges again without waiting out the repeat
 * window.
 *
 * The pause runs on its own, stricter counter rather than riding the nudge:
 * `NUDGE_REPEAT_MS` deliberately silences a drift that is still going, and a
 * pause that only ever travelled with a nudge would be silenced with it.
 * That counter only advances on consecutive readings of ONE kind that all
 * clear that kind's pause floor — a wobble below the floor drops it back to
 * zero — and it has to clear a wall-clock floor as well as a reading count, so
 * "sustained" survives someone changing the camera's frame rate. It latches
 * once it fires, so one drift stops the clock once.
 *
 * Sustained is necessary and not sufficient: a pause is held while a kill
 * countdown burns (`DriftPolicy.fuseBurning`), because stopping the clock
 * stops the session and a stopped session throws the fuse away. Enforcement
 * outranks the clock at every fuse length, not just the shipped one.
 */
export class NudgeTracker {
  private streak = 0;
  private lastNudgeAt: number | null = null;
  /** Consecutive readings above the pause floor, and the kind they agree on. */
  private confirmStreak = 0;
  private confirmKind: PauseKind | null = null;
  /** When that run started, so the pause is a duration and not a frame count. */
  private confirmFrom = 0;
  /** Latch: this drift already stopped the clock, so it does not do it twice. */
  private paused = false;

  observeDesk(desk: DeskSnapshot | null, policy: DriftPolicy, now: number): Drift | null {
    const reading = readDrift(desk, policy.threshold);
    if (reading === "focused") {
      this.recovered();
      return null;
    }
    if (reading === null) {
      // Unsure: break both streaks, re-arm neither.
      this.streak = 0;
      this.clearConfirm();
      return null;
    }

    this.streak += 1;
    const pause = this.trackConfirm(reading, policy, now);
    const nudge = this.trackNudge(now);
    return nudge || pause ? { kind: reading.kind, nudge, pause } : null;
  }

  /** A blocked-app nudge fired; hold attention nudges off for the repeat window. */
  blocked(now: number): void {
    this.lastNudgeAt = now;
  }

  /** A fresh session. Includes the pause latch: a new round may pause again. */
  reset(): void {
    this.streak = 0;
    this.lastNudgeAt = null;
    this.paused = false;
    this.clearConfirm();
  }

  private trackNudge(now: number): boolean {
    if (this.streak < NUDGE_SUSTAIN_READINGS) {
      return false;
    }
    if (this.lastNudgeAt !== null && now - this.lastNudgeAt < NUDGE_REPEAT_MS) {
      return false;
    }
    this.lastNudgeAt = now;
    return true;
  }

  private trackConfirm(reading: DriftReading, policy: DriftPolicy, now: number): boolean {
    const gate = pauseGateFor(reading.kind, policy);
    if (gate === null || reading.confidence < gate.floor) {
      // Either this kind may never pause, or the head is not sure enough for
      // this reading to count toward one. Both drop the run to zero.
      this.clearConfirm();
      return false;
    }
    if (this.confirmKind === gate.kind) {
      this.confirmStreak += 1;
    } else {
      this.confirmStreak = 1;
      this.confirmKind = gate.kind;
      this.confirmFrom = now;
    }
    const sustain = pauseSustainFor(gate.kind);
    if (
      this.paused ||
      this.confirmStreak < sustain.readings ||
      now - this.confirmFrom < sustain.ms
    ) {
      return false;
    }
    if (policy.fuseBurning) {
      // Sustained long enough, but a countdown is still burning: hold. See
      // `DriftPolicy.fuseBurning` — a pause here would stop the session and
      // take the kill with it. Nothing is latched, so the next reading after
      // the fuse resolves stops the clock.
      return false;
    }
    this.paused = true;
    return true;
  }

  private clearConfirm(): void {
    this.confirmStreak = 0;
    this.confirmKind = null;
    this.confirmFrom = 0;
  }

  /** A confident `focused` reading: forget the drift entirely. */
  private recovered(): void {
    this.streak = 0;
    this.lastNudgeAt = null;
    this.paused = false;
    this.clearConfirm();
  }
}
