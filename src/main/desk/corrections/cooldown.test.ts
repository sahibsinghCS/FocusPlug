import { describe, expect, it } from "vitest";
import {
  CORRECTION_COOLDOWN_AWAY_MS,
  CORRECTION_COOLDOWN_PHONE_MS,
} from "@shared/correction/constants";
import type { AppSettings, NudgeEvent } from "@shared/ipc";
import type { DeskSnapshot } from "@shared/types";
import { DEFAULT_SETTINGS } from "../../../shared/defaults.ts";
import { SessionController } from "../../session/controller.ts";
import {
  awayDesk,
  createMemoryStore,
  createRecordingPush,
  docsFocus,
  MutableClock,
  presentDesk,
  RecordingKiller,
  RecordingPlugController,
  ScriptedDeskMonitor,
  ScriptedWindowMonitor,
} from "../../session/harness.ts";
import { PAUSE_SUSTAIN_AWAY_MS, PAUSE_SUSTAIN_PHONE_MS } from "../../session/nudge.ts";
import type { RetainedFrame } from "../frameRing";
import { createMemoryFs, phoneSnapshot, testFrame, type MemoryFs } from "./harness";
import { DeskCorrections } from "./service";

/** The shipped desk cadence — `DEFAULT_DESK_INTERVAL_MS`. */
const TICK_MS = 250;

/**
 * A desk monitor with a ring.
 *
 * Its own double, deliberately not added to `src/main/session/harness.ts`:
 * a feature that is allowed to fail must not put fixtures in the harness for
 * the one that is not.
 */
class RingDeskMonitor extends ScriptedDeskMonitor {
  captureOn = false;
  peeks: number[] = [];
  /** Frames the ring "holds". Empty models a ring that had nothing. */
  frames: RetainedFrame[] = [];

  setCorrectionCapture(enabled: boolean): void {
    this.captureOn = enabled;
    if (!enabled) {
      this.frames = [];
    }
  }

  peekFrames(sinceMs: number): RetainedFrame[] {
    this.peeks.push(sinceMs);
    return this.frames.filter((frame) => frame.at >= sinceMs);
  }

  fill(now: number, count = 3): void {
    this.frames = [];
    for (let i = 0; i < count; i += 1) {
      const at = now - (count - 1 - i) * 5_000;
      this.frames.push({ at, frame: testFrame(i + 1), snapshot: phoneSnapshot(at) });
    }
  }
}

interface Rig {
  controller: SessionController;
  corrections: DeskCorrections;
  desk: RingDeskMonitor;
  window: ScriptedWindowMonitor;
  clock: MutableClock;
  killer: RecordingKiller;
  fs: MemoryFs;
  log: string[];
  nudges: NudgeEvent[];
  trace: ReturnType<typeof createRecordingPush>["trace"];
}

function makeRig(
  options: { settings?: Partial<AppSettings>; fs?: MemoryFs; clock?: MutableClock } = {},
): Rig {
  const clock = options.clock ?? new MutableClock();
  const window = new ScriptedWindowMonitor();
  const desk = new RingDeskMonitor();
  const killer = new RecordingKiller();
  const plugs = new RecordingPlugController([]);
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    deskModelId: "custom",
    ...options.settings,
  };
  const store = createMemoryStore({ settings });
  const { push, trace } = createRecordingPush();
  const controller = new SessionController({
    windowMonitor: window,
    deskMonitor: desk,
    killer,
    plugs,
    store,
    push,
    now: clock.now,
    tickIntervalMs: 0,
    adaptiveRandom: () => 1,
  });
  const fs = options.fs ?? createMemoryFs();
  const log: string[] = [];
  const corrections = new DeskCorrections({
    userDataDir: "/data",
    loadSettings: () => store.loadSettings(),
    appendLog: (detail) => log.push(detail),
    now: clock.now,
    fs,
    attentionHeadFile: "/nowhere",
  });
  controller.attachCorrections(corrections);
  return {
    controller,
    corrections,
    desk,
    window,
    clock,
    killer,
    fs,
    log,
    nudges: trace.nudges,
    trace,
  };
}

/**
 * Drift for `ms` of wall clock at the real camera rate, draining the policy
 * queue each reading.
 *
 * The drain matters: `enqueueEvaluate` is async, so a loop that only flushed
 * at the end would run every evaluate at the final clock value and no
 * countdown would ever elapse. These tests are partly about what the fuse does
 * WHILE a kind is silenced, so the fuse has to actually burn.
 */
async function driftFor(
  rig: Rig,
  desk: (ts: number) => DeskSnapshot,
  ms: number,
): Promise<void> {
  rig.window.emit(docsFocus(rig.clock.ms));
  const until = rig.clock.ms + ms;
  while (rig.clock.ms <= until) {
    rig.desk.fill(rig.clock.ms);
    rig.desk.emit(desk(rig.clock.ms));
    await rig.controller.flush();
    rig.clock.advance(TICK_MS);
  }
}

const onPhone = (ts: number, confidence = 0.97): DeskSnapshot => ({
  ...presentDesk(ts),
  attention: { label: "phone", confidence },
});

const pauses = (rig: Rig): NudgeEvent[] => rig.nudges.filter((nudge) => nudge.pause === true);

describe("the pause carries a correction id", () => {
  it("hands the renderer an id, taken from frames the model already looked at", async () => {
    const rig = makeRig();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();

    expect(pauses(rig)).toHaveLength(1);
    expect(pauses(rig)[0]?.correctionId).toBe("dc-0001");
    // The window asked for is exactly the confirmed run's length.
    const asked = rig.desk.peeks[rig.desk.peeks.length - 1] ?? 0;
    expect(asked).toBeLessThanOrEqual(rig.clock.ms - PAUSE_SUSTAIN_AWAY_MS);
    expect(rig.corrections.getState().pending?.kind).toBe("away");
  });

  it("asks for the phone run's longer window when a phone pauses", async () => {
    const rig = makeRig({ settings: { pauseOnPhoneEnabled: true } });
    await rig.controller.start();
    const startedAt = rig.clock.ms;
    await driftFor(rig, onPhone, PAUSE_SUSTAIN_PHONE_MS + 5_000);
    await rig.controller.flush();

    expect(pauses(rig)).toHaveLength(1);
    const asked = rig.desk.peeks[rig.desk.peeks.length - 1] ?? 0;
    expect(rig.clock.ms - asked).toBeGreaterThanOrEqual(PAUSE_SUSTAIN_PHONE_MS);
    expect(asked).toBeGreaterThan(startedAt - PAUSE_SUSTAIN_PHONE_MS);
  });

  it("carries no id when the ring had nothing — no chips over an empty offer", async () => {
    const rig = makeRig();
    await rig.controller.start();
    rig.window.emit(docsFocus(rig.clock.ms));
    const until = rig.clock.ms + PAUSE_SUSTAIN_AWAY_MS + 5_000;
    while (rig.clock.ms <= until) {
      rig.desk.frames = [];
      rig.desk.emit(awayDesk(rig.clock.ms));
      rig.clock.advance(TICK_MS);
    }
    await rig.controller.flush();

    expect(pauses(rig)).toHaveLength(1);
    expect(pauses(rig)[0]?.correctionId).toBeUndefined();
    expect(rig.corrections.getState().pending).toBeNull();
  });

  it("retains nothing on a default install — the ring switch is off", async () => {
    const rig = makeRig({ settings: { deskModelId: "blazeface" } });
    await rig.controller.start();
    expect(rig.desk.captureOn).toBe(false);
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();
    // blazeface cannot pause at all, and it holds no pictures either.
    expect(pauses(rig)).toHaveLength(0);
    expect(rig.nudges.every((nudge) => nudge.correctionId === undefined)).toBe(true);
  });

  it("switches the ring off the moment corrections are turned off", async () => {
    const rig = makeRig();
    await rig.controller.start();
    expect(rig.desk.captureOn).toBe(true);
    rig.controller.setSettings({ deskCorrectionsEnabled: false });
    expect(rig.desk.captureOn).toBe(false);
    rig.controller.setSettings({ deskCorrectionsEnabled: true });
    expect(rig.desk.captureOn).toBe(true);
    // …and off again when neither pause switch is on: nothing could ask.
    rig.controller.setSettings({ pauseOnAwayEnabled: false, pauseOnPhoneEnabled: false });
    expect(rig.desk.captureOn).toBe(false);
  });
});

describe("the cooldown survives the resume", () => {
  /**
   * THE HEADLINE TEST.
   *
   * "I was working" resumes the clock, the resume calls `startSession()`, and
   * `SessionController.start()` calls `NudgeTracker.reset()`. A cooldown
   * stored in the tracker would be wiped by the very tap that armed it. This
   * one is derived from the records, so it cannot be.
   */
  it("a correction, then a resume, and the app still does not pause for that kind", async () => {
    const rig = makeRig();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();
    const id = pauses(rig)[0]?.correctionId ?? "";
    expect(id).not.toBe("");

    const result = rig.corrections.record({ correctionId: id, verdict: "wrong" });
    expect(result.recorded).toBe(true);
    expect(result.cooldown?.kind).toBe("away");

    // The resume. This is the reset that would have wiped a stored cooldown.
    await rig.controller.stop();
    await rig.controller.start();

    const before = rig.nudges.length;
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 20_000);
    await rig.controller.flush();

    // Not one pause, and not one nudge either: the reading reads as unsure.
    expect(pauses(rig)).toHaveLength(1);
    expect(rig.nudges.slice(before)).toEqual([]);
  });

  it("lets go when the cooldown lapses, and pauses again", async () => {
    const rig = makeRig();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();
    rig.corrections.record({
      correctionId: pauses(rig)[0]?.correctionId ?? "",
      verdict: "wrong",
    });

    await rig.controller.stop();
    rig.clock.advance(CORRECTION_COOLDOWN_AWAY_MS + 1_000);
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();

    expect(pauses(rig)).toHaveLength(2);
  });

  it("silences only the kind that was corrected", async () => {
    const rig = makeRig({ settings: { pauseOnPhoneEnabled: true } });
    await rig.controller.start();
    await driftFor(rig, onPhone, PAUSE_SUSTAIN_PHONE_MS + 5_000);
    await rig.controller.flush();
    rig.corrections.record({
      correctionId: pauses(rig)[0]?.correctionId ?? "",
      verdict: "wrong",
    });
    expect(rig.corrections.silencedKinds(rig.clock.ms)).toEqual(["phone"]);

    await rig.controller.stop();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();

    // `away` still stops the clock. Correcting a phone bought nothing here.
    expect(pauses(rig).map((nudge) => nudge.kind)).toEqual(["phone", "away"]);
  });

  it("a `right` verdict silences nothing — the pause was correct", async () => {
    const rig = makeRig();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();
    rig.corrections.record({
      correctionId: pauses(rig)[0]?.correctionId ?? "",
      verdict: "right",
    });

    await rig.controller.stop();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();

    expect(pauses(rig)).toHaveLength(2);
  });

  it("survives an app restart: a fresh controller reads the same records", async () => {
    const fs = createMemoryFs();
    const clock = new MutableClock();
    const first = makeRig({ fs, clock });
    await first.controller.start();
    await driftFor(first, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await first.controller.flush();
    first.corrections.record({
      correctionId: pauses(first)[0]?.correctionId ?? "",
      verdict: "wrong",
    });
    await first.controller.stop();

    const restarted = makeRig({ fs, clock: new MutableClock(clock.ms + 60_000) });
    await restarted.controller.start();
    await driftFor(restarted, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await restarted.controller.flush();

    expect(pauses(restarted)).toHaveLength(0);
  });

  it("deleting the correction drops the cooldown, and the pause comes back", async () => {
    const rig = makeRig();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();
    const id = pauses(rig)[0]?.correctionId ?? "";
    rig.corrections.record({ correctionId: id, verdict: "wrong" });
    rig.corrections.delete(id);

    await rig.controller.stop();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();

    expect(pauses(rig)).toHaveLength(2);
  });
});

describe("the cooldown never reaches enforcement", () => {
  /**
   * The worst case of a cooldown, named and paid for: for ten minutes after a
   * student swore they were at their desk, if they then leave, the lamp does
   * not come on. They still get force-quit. Enforcement is not a coaching
   * decision and the student's verdict does not get a vote in it.
   */
  it("a silenced away still decides AWAY, still burns the fuse and still kills", async () => {
    const rig = makeRig();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();
    rig.corrections.record({
      correctionId: pauses(rig)[0]?.correctionId ?? "",
      verdict: "wrong",
    });

    await rig.controller.stop();
    await rig.controller.start();
    const killsBefore = rig.killer.calls.length;
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 30_000);
    await rig.controller.flush();

    expect(rig.controller.getState().decision).toBe("AWAY");
    const types = rig.trace.policies.map((event) => event.type);
    expect(types).toContain("start_countdown");
    expect(types).toContain("kill");
    expect(rig.killer.calls.length).toBeGreaterThan(killsBefore);
    // …and still no pause and no nudge, which is the whole point.
    expect(pauses(rig)).toHaveLength(1);
  });

  it("cannot silence a blocked-app nudge — `blocked` is not a PauseKind", async () => {
    const rig = makeRig();
    await rig.controller.start();
    await driftFor(rig, awayDesk, PAUSE_SUSTAIN_AWAY_MS + 5_000);
    await rig.controller.flush();
    rig.corrections.record({
      correctionId: pauses(rig)[0]?.correctionId ?? "",
      verdict: "wrong",
    });
    expect(rig.corrections.silencedKinds(rig.clock.ms)).toEqual(["away"]);

    await rig.controller.stop();
    await rig.controller.start();
    const before = rig.nudges.length;
    await rig.controller.demoNudge("blocked");
    expect(rig.nudges.length).toBeGreaterThan(before);
  });
});

describe("the cooldown lengths differ, and say why", () => {
  it("phone is one focus block and away is ten minutes", () => {
    expect(CORRECTION_COOLDOWN_PHONE_MS).toBe(25 * 60_000);
    expect(CORRECTION_COOLDOWN_AWAY_MS).toBe(10 * 60_000);
    expect(CORRECTION_COOLDOWN_PHONE_MS).toBeGreaterThan(CORRECTION_COOLDOWN_AWAY_MS);
  });
});
