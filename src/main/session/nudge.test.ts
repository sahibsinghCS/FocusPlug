import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { AttentionLabel, DeskSnapshot } from "@shared/types";
import {
  NUDGE_REPEAT_MS,
  NudgeTracker,
  PAUSE_SUSTAIN_AWAY,
  PAUSE_SUSTAIN_AWAY_MS,
  PAUSE_SUSTAIN_PHONE,
  PAUSE_SUSTAIN_PHONE_MS,
  type Drift,
  type DriftPolicy,
} from "./nudge";

/** The shipped defaults: away may stop the clock, phone may not. */
const POLICY: DriftPolicy = {
  threshold: 0.6,
  pauseOnAway: DEFAULT_SETTINGS.pauseOnAwayEnabled,
  pauseOnPhone: DEFAULT_SETTINGS.pauseOnPhoneEnabled,
  awayConfidence: DEFAULT_SETTINGS.pauseAwayConfidence,
  phoneConfidence: DEFAULT_SETTINGS.pausePhoneConfidence,
  // Nothing corrected: `silenced: []` is today's behaviour byte for byte.
  silenced: [],
  // No countdown burning. On a default install the 10 s fuse has long since
  // resolved by the time the 15 s away floor is met, so this is what the
  // shipped case looks like at the moment a pause is due. The fuse lengths
  // where it has NOT resolved are their own describe block below.
  fuseBurning: false,
};

/** Both pauses armed, for the tests that are about the counters themselves. */
const PAUSING: DriftPolicy = { ...POLICY, pauseOnPhone: true };

/** Neither pause armed — this is today's behaviour, unchanged. */
const NO_PAUSE: DriftPolicy = { ...POLICY, pauseOnAway: false, pauseOnPhone: false };

/** Sustained long enough to pause, but a force-quit countdown is still burning. */
const BURNING: DriftPolicy = { ...PAUSING, fuseBurning: true };

function reading(label: AttentionLabel, confidence = 0.9): DeskSnapshot {
  return {
    ts: 0,
    label: "at_desk",
    confidence: 0.95,
    webcamEnabled: true,
    attention: { label, confidence },
  };
}

function away(confidence = 0.92): DeskSnapshot {
  return { ts: 0, label: "away", confidence, webcamEnabled: true };
}

function uncertain(confidence = 0.95): DeskSnapshot {
  return { ts: 0, label: "uncertain", confidence, webcamEnabled: true };
}

/** The nudge kind, or null when the reading asked for nothing. */
function kindOf(drift: Drift | null): string | null {
  return drift === null ? null : drift.kind;
}

describe("NudgeTracker", () => {
  it("needs two off-task readings in a row, then nudges with the latest kind", () => {
    const tracker = new NudgeTracker();
    expect(tracker.observeDesk(reading("phone"), POLICY, 0)).toBeNull();
    expect(kindOf(tracker.observeDesk(reading("phone"), POLICY, 1000))).toBe("phone");
  });

  it("a continuing drift re-nudges only after the repeat window", () => {
    const tracker = new NudgeTracker();
    tracker.observeDesk(reading("unfocused"), POLICY, 0);
    expect(kindOf(tracker.observeDesk(reading("unfocused"), POLICY, 1000))).toBe("unfocused");
    expect(tracker.observeDesk(reading("unfocused"), POLICY, 2000)).toBeNull();
    expect(kindOf(tracker.observeDesk(reading("phone"), POLICY, 1000 + NUDGE_REPEAT_MS))).toBe(
      "phone",
    );
  });

  it("refocusing re-arms immediately", () => {
    const tracker = new NudgeTracker();
    tracker.observeDesk(reading("phone"), POLICY, 0);
    expect(kindOf(tracker.observeDesk(reading("phone"), POLICY, 1000))).toBe("phone");
    tracker.observeDesk(reading("focused"), POLICY, 2000);
    tracker.observeDesk(reading("phone"), POLICY, 3000);
    expect(kindOf(tracker.observeDesk(reading("phone"), POLICY, 4000))).toBe("phone");
  });

  it("unsure readings break a streak without counting as drift or recovery", () => {
    const tracker = new NudgeTracker();
    tracker.observeDesk(reading("phone"), POLICY, 0);
    expect(tracker.observeDesk(reading("phone", 0.4), POLICY, 1000)).toBeNull();
    expect(tracker.observeDesk(away(0.4), POLICY, 2000)).toBeNull();
    expect(
      tracker.observeDesk({ ...reading("phone"), webcamEnabled: false }, POLICY, 3000),
    ).toBeNull();
    const noHead: DeskSnapshot = { ts: 0, label: "at_desk", confidence: 0.95, webcamEnabled: true };
    expect(tracker.observeDesk(noHead, POLICY, 4000)).toBeNull();
    expect(tracker.observeDesk(null, POLICY, 5000)).toBeNull();
  });

  it("a blocked-app nudge holds attention nudges off for the window", () => {
    const tracker = new NudgeTracker();
    tracker.blocked(0);
    tracker.observeDesk(reading("phone"), POLICY, 1000);
    expect(tracker.observeDesk(reading("phone"), POLICY, 2000)).toBeNull();
    tracker.reset();
    tracker.observeDesk(reading("phone"), POLICY, 3000);
    expect(kindOf(tracker.observeDesk(reading("phone"), POLICY, 4000))).toBe("phone");
  });

  describe("leaving the room", () => {
    it("two sustained away readings nudge, like any other drift", () => {
      const tracker = new NudgeTracker();
      expect(tracker.observeDesk(away(), POLICY, 0)).toBeNull();
      expect(tracker.observeDesk(away(), POLICY, 1000)).toMatchObject({
        kind: "away",
        nudge: true,
      });
    });

    it("a low-confidence away reading is unsure, not a drift", () => {
      const tracker = new NudgeTracker();
      expect(tracker.observeDesk(away(0.5), POLICY, 0)).toBeNull();
      expect(tracker.observeDesk(away(0.5), POLICY, 1000)).toBeNull();
      expect(tracker.observeDesk(away(0.5), POLICY, 2000)).toBeNull();
    });

    it("coming back to the desk re-arms the away nudge", () => {
      const tracker = new NudgeTracker();
      tracker.observeDesk(away(), POLICY, 0);
      expect(kindOf(tracker.observeDesk(away(), POLICY, 1000))).toBe("away");
      tracker.observeDesk(reading("focused"), POLICY, 2000);
      tracker.observeDesk(away(), POLICY, 3000);
      expect(kindOf(tracker.observeDesk(away(), POLICY, 4000))).toBe("away");
    });
  });

  describe("uncertain is never actionable", () => {
    it("never nudges and never pauses, however long it lasts", () => {
      const tracker = new NudgeTracker();
      for (let i = 0; i < PAUSE_SUSTAIN_PHONE + PAUSE_SUSTAIN_AWAY + 5; i += 1) {
        expect(tracker.observeDesk(uncertain(0.99), PAUSING, i * 1000)).toBeNull();
      }
    });

    it("breaks a drift run rather than counting toward one", () => {
      const tracker = new NudgeTracker();
      tracker.observeDesk(away(), PAUSING, 0);
      expect(tracker.observeDesk(uncertain(), PAUSING, 1000)).toBeNull();
      // Back to zero: the next away reading is a first, not a second.
      expect(tracker.observeDesk(away(), PAUSING, 2000)).toBeNull();
      expect(kindOf(tracker.observeDesk(away(), PAUSING, 3000))).toBe("away");
    });
  });

  describe("pausing the clock", () => {
    /** The shipped desk cadence — `DEFAULT_DESK_INTERVAL_MS`. */
    const TICK_MS = 250;

    interface Run {
      /** Elapsed ms at the reading that stopped the clock, or null if none did. */
      pausedAtMs: number | null;
      /** How many readings it took. */
      pausedAtReading: number | null;
      nudges: number;
    }

    /** Feed `count` readings at `stepMs` apart and report what happened. */
    function feed(
      tracker: NudgeTracker,
      desk: (ts: number) => DeskSnapshot,
      count: number,
      options?: { stepMs?: number; policy?: DriftPolicy; fromMs?: number },
    ): Run {
      const stepMs = options?.stepMs ?? TICK_MS;
      const policy = options?.policy ?? PAUSING;
      const from = options?.fromMs ?? 0;
      const run: Run = { pausedAtMs: null, pausedAtReading: null, nudges: 0 };
      for (let i = 1; i <= count; i += 1) {
        const at = from + i * stepMs;
        const drift = tracker.observeDesk(desk(at), policy, at);
        if (drift?.nudge === true) {
          run.nudges += 1;
        }
        if (drift?.pause === true && run.pausedAtMs === null) {
          run.pausedAtMs = at - from - stepMs;
          run.pausedAtReading = i;
        }
      }
      return run;
    }

    /** Readings needed to cover `ms` at the shipped cadence, plus the first. */
    const readingsFor = (ms: number): number => Math.ceil(ms / TICK_MS) + 1;

    it("stops the clock only once fifteen seconds of away have passed", () => {
      const tracker = new NudgeTracker();
      const run = feed(tracker, away, readingsFor(PAUSE_SUSTAIN_AWAY_MS) + 4);
      expect(run.pausedAtMs).toBe(PAUSE_SUSTAIN_AWAY_MS);
      // Exactly one: the run latches, so a student who stays away is not
      // paused again every quarter second.
      expect(
        feed(tracker, away, 40, { fromMs: 100_000 }).pausedAtMs,
      ).toBeNull();
    });

    it("a fast camera cannot buy a shorter pause", () => {
      // Three readings is `PAUSE_SUSTAIN_AWAY`, and at 250 ms it is also three
      // quarters of a second — nowhere near a person leaving the room. The
      // reading count alone must not be able to stop a clock.
      expect(feed(new NudgeTracker(), away, PAUSE_SUSTAIN_AWAY).pausedAtMs).toBeNull();
      expect(feed(new NudgeTracker(), away, 20, { stepMs: 5 }).pausedAtMs).toBeNull();
      // Even a camera running 100x fast has to wait out the wall clock.
      expect(
        feed(new NudgeTracker(), away, readingsFor(PAUSE_SUSTAIN_AWAY_MS), { stepMs: 2.5 })
          .pausedAtMs,
      ).toBeNull();
    });

    it("a slow camera cannot buy one either: both floors have to clear", () => {
      // 20 s apart, so the duration is met on reading two — but two frames is
      // not a sustained reading of anything.
      const run = feed(new NudgeTracker(), away, 4, { stepMs: 20_000 });
      expect(run.pausedAtReading).toBe(PAUSE_SUSTAIN_AWAY);
    });

    it("a phone has to last twice as long, and say it more times", () => {
      expect(PAUSE_SUSTAIN_PHONE_MS).toBeGreaterThan(PAUSE_SUSTAIN_AWAY_MS);
      expect(PAUSE_SUSTAIN_PHONE).toBeGreaterThan(PAUSE_SUSTAIN_AWAY);
      const onPhone = (): DeskSnapshot => reading("phone", 0.97);
      expect(
        feed(new NudgeTracker(), onPhone, readingsFor(PAUSE_SUSTAIN_AWAY_MS) + 4).pausedAtMs,
      ).toBeNull();
      expect(
        feed(new NudgeTracker(), onPhone, readingsFor(PAUSE_SUSTAIN_PHONE_MS) + 4).pausedAtMs,
      ).toBe(PAUSE_SUSTAIN_PHONE_MS);
    });

    it("pauses even while the repeat window is silencing the nudge", () => {
      // The pause must not ride the nudge: NUDGE_REPEAT_MS silences a drift
      // that is still going, and fifteen seconds of away lands inside it.
      expect(PAUSE_SUSTAIN_AWAY_MS).toBeLessThan(NUDGE_REPEAT_MS);
      const tracker = new NudgeTracker();
      const run = feed(tracker, away, readingsFor(PAUSE_SUSTAIN_AWAY_MS));
      expect(run.pausedAtMs).toBe(PAUSE_SUSTAIN_AWAY_MS);
      // One nudge in that whole window, and the pause is not it.
      expect(run.nudges).toBe(1);
    });

    it("holds the confidence floor: readings below it never confirm", () => {
      // Above deskThreshold (0.6) so every one is a real drift and nudges, but
      // below the away pause floor (0.75), so none counts toward a pause.
      const run = feed(new NudgeTracker(), () => away(0.7), 400);
      expect(run.pausedAtMs).toBeNull();
      expect(run.nudges).toBeGreaterThan(1);
    });

    it("a single frame under the floor sends the run back to the start", () => {
      const tracker = new NudgeTracker();
      const nearly = readingsFor(PAUSE_SUSTAIN_AWAY_MS) - 1;
      expect(feed(tracker, away, nearly).pausedAtMs).toBeNull();
      // One wobble at the last moment, and the fifteen seconds start over.
      expect(
        tracker.observeDesk(away(0.7), PAUSING, nearly * TICK_MS + TICK_MS)?.pause ?? false,
      ).toBe(false);
      const after = feed(tracker, away, nearly, { fromMs: (nearly + 1) * TICK_MS });
      expect(after.pausedAtMs).toBeNull();
      expect(
        feed(tracker, away, 8, { fromMs: (nearly + 1 + nearly) * TICK_MS }).pausedAtMs,
      ).toBe(0);
    });

    it("a mixed run of kinds confirms neither", () => {
      const tracker = new NudgeTracker();
      const mixed = (ts: number): DeskSnapshot =>
        Math.round(ts / TICK_MS) % 2 === 0 ? away(0.95) : reading("phone", 0.97);
      expect(feed(tracker, mixed, 400).pausedAtMs).toBeNull();
    });

    it("unfocused never pauses, however sure and however long", () => {
      expect(feed(new NudgeTracker(), () => reading("unfocused", 0.99), 400).pausedAtMs).toBeNull();
    });

    it("each setting gates only its own kind", () => {
      const awayOnly: DriftPolicy = { ...POLICY, pauseOnAway: true, pauseOnPhone: false };
      const phoneOnly: DriftPolicy = { ...POLICY, pauseOnAway: false, pauseOnPhone: true };
      expect(
        feed(new NudgeTracker(), () => reading("phone", 0.99), 400, { policy: awayOnly })
          .pausedAtMs,
      ).toBeNull();
      expect(feed(new NudgeTracker(), away, 400, { policy: phoneOnly }).pausedAtMs).toBeNull();
      // Each one still works on its own kind.
      expect(feed(new NudgeTracker(), away, 400, { policy: awayOnly }).pausedAtMs).toBe(
        PAUSE_SUSTAIN_AWAY_MS,
      );
    });

    it("with both settings off nothing ever pauses, and the nudge gate is unchanged", () => {
      const off = feed(new NudgeTracker(), away, 400, { policy: NO_PAUSE });
      const on = feed(new NudgeTracker(), away, 400, { policy: PAUSING });
      expect(off.pausedAtMs).toBeNull();
      // The switch adds a pause and moves no nudge: the sustain and repeat
      // gates run exactly as they did. What the CONTROLLER does with a
      // pause-only reading — pull them back anyway, because a stopped clock
      // has to announce itself — is pinned in controller.test.ts, not here.
      expect(off.nudges).toBe(on.nudges);
    });

    it("uncertain never pauses, and breaks a run instead of extending it", () => {
      expect(feed(new NudgeTracker(), uncertain, 400).pausedAtMs).toBeNull();

      const tracker = new NudgeTracker();
      const nearly = readingsFor(PAUSE_SUSTAIN_AWAY_MS) - 1;
      feed(tracker, away, nearly);
      expect(tracker.observeDesk(uncertain(), PAUSING, 100_000)).toBeNull();
      // Back to the start, both floors.
      expect(feed(tracker, away, nearly, { fromMs: 200_000 }).pausedAtMs).toBeNull();
    });

    it("coming back to the desk re-arms the pause", () => {
      const tracker = new NudgeTracker();
      expect(feed(tracker, away, 400).pausedAtMs).toBe(PAUSE_SUSTAIN_AWAY_MS);
      tracker.observeDesk(reading("focused"), PAUSING, 200_000);
      expect(feed(tracker, away, 400, { fromMs: 200_000 }).pausedAtMs).toBe(PAUSE_SUSTAIN_AWAY_MS);
    });

    it("a fresh session re-arms the pause latch", () => {
      // The controller keeps one tracker for the app's life and resets it on
      // start. A latch that survived that would let the first round of a
      // session pause and every later one silently not.
      const tracker = new NudgeTracker();
      expect(feed(tracker, away, 400).pausedAtMs).toBe(PAUSE_SUSTAIN_AWAY_MS);
      tracker.reset();
      expect(feed(tracker, away, 400, { fromMs: 200_000 }).pausedAtMs).toBe(PAUSE_SUSTAIN_AWAY_MS);
    });
  });

  /**
   * THE KILL GOES FIRST. Stopping the clock stops the session, and
   * `SessionController.stop()` builds a fresh `PolicyEngine` — so a pause
   * inside the fuse would cancel the force-quit outright. The end-to-end
   * proof, across every countdown length the slider offers, is
   * `controller.test.ts` › "a drift pause never displaces the kill"; this is
   * the counter's own half of it.
   */
  describe("holding the pause while the kill burns", () => {
    const TICK_MS = 250;
    const readingsFor = (ms: number): number => Math.ceil(ms / TICK_MS) + 1;

    /** Feed away readings under `policy` and report when the pause fired. */
    function awayRun(
      tracker: NudgeTracker,
      count: number,
      policy: DriftPolicy,
      fromMs = 0,
    ): number | null {
      for (let i = 1; i <= count; i += 1) {
        const at = fromMs + i * TICK_MS;
        if (tracker.observeDesk(away(), policy, at)?.pause === true) {
          return at;
        }
      }
      return null;
    }

    it("never pauses while a countdown burns, however long the away lasts", () => {
      // Two minutes of confirmed away — eight times the floor — and not one
      // pause, because a 30 s Settings fuse (or an adaptive one) is still
      // running. Without this the clock would stop at 15 s and take the kill
      // with it, leaving Discord alive and nobody in the room to notice.
      expect(awayRun(new NudgeTracker(), 480, BURNING)).toBeNull();
    });

    it("fires on the first reading after the fuse resolves", () => {
      const tracker = new NudgeTracker();
      // Held past the floor...
      const held = readingsFor(PAUSE_SUSTAIN_AWAY_MS) + 20;
      expect(awayRun(tracker, held, BURNING)).toBeNull();
      // ...and the kill lands, so the very next reading stops the clock. The
      // run was still counting while it waited: no second fifteen seconds.
      expect(awayRun(tracker, 1, PAUSING, held * TICK_MS)).toBe((held + 1) * TICK_MS);
    });

    it("holds the phone pause too — any fuse outranks any clock", () => {
      // A blocked app can be burning a fuse while the camera sees a phone, so
      // the gate is not away-only. Thirty seconds of confirmed phone with
      // `pauseOnPhone` on, and it still waits.
      const onPhone = (): DeskSnapshot => reading("phone", 0.97);
      const tracker = new NudgeTracker();
      const count = readingsFor(PAUSE_SUSTAIN_PHONE_MS) + 20;
      for (let i = 1; i <= count; i += 1) {
        expect(tracker.observeDesk(onPhone(), BURNING, i * TICK_MS)?.pause ?? false).toBe(false);
      }
      expect(
        tracker.observeDesk(onPhone(), PAUSING, (count + 1) * TICK_MS)?.pause,
      ).toBe(true);
    });

    it("holding is not latching: a recovery mid-hold still clears the run", () => {
      const tracker = new NudgeTracker();
      expect(awayRun(tracker, readingsFor(PAUSE_SUSTAIN_AWAY_MS) + 10, BURNING)).toBeNull();
      // They came back inside the fuse — the countdown cancels and so does
      // the pause run. The next away starts its fifteen seconds from scratch
      // rather than cashing in the time it spent held.
      tracker.observeDesk(reading("focused"), PAUSING, 100_000);
      expect(awayRun(tracker, 400, PAUSING, 100_000)).toBe(
        100_000 + PAUSE_SUSTAIN_AWAY_MS + TICK_MS,
      );
    });

    it("still nudges while it holds — the pull-back is not gated on the fuse", () => {
      // The lamp, the window and the overlay are what a burning countdown
      // wants MORE of, not less. Only the clock waits.
      const tracker = new NudgeTracker();
      let nudges = 0;
      for (let i = 1; i <= 480; i += 1) {
        if (tracker.observeDesk(away(), BURNING, i * TICK_MS)?.nudge === true) {
          nudges += 1;
        }
      }
      expect(nudges).toBeGreaterThan(1);
    });
  });
});
