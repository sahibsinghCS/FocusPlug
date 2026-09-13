import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@shared/ipc";
import type { RunPosition } from "../timer/runtime";
import { buildLockFaceProps, lockFacePhase } from "./lockProps";

const focusPosition: RunPosition = {
  segment: {
    index: 0,
    kind: "focus",
    round: 1,
    seconds: 1500,
    startSec: 0,
    endSec: 1500,
  },
  remainingSec: 975,
  segmentProgress: 0.35,
  planProgress: 0.35,
  round: 1,
  roundsTotal: 2,
};

const breakPosition: RunPosition = {
  segment: {
    index: 1,
    kind: "break",
    round: 1,
    seconds: 300,
    startSec: 1500,
    endSec: 1800,
  },
  remainingSec: 180,
  segmentProgress: 0.4,
  planProgress: 0.7,
  round: 1,
  roundsTotal: 2,
};

const log: SessionEvent[] = [
  { ts: 1000, kind: "session", detail: "Session started" },
  { ts: 2000, kind: "kill", detail: "blocked_focus · killed discord.exe" },
];

describe("lock face phase mapping", () => {
  it("uses scheduled rest for FacePhase break, never a missing position", () => {
    expect(lockFacePhase("setup", null)).toBe("idle");
    expect(lockFacePhase("done", null)).toBe("idle");
    expect(lockFacePhase("running", focusPosition)).toBe("focus");
    expect(lockFacePhase("paused", focusPosition)).toBe("focus");
    expect(lockFacePhase("running", breakPosition)).toBe("break");
    expect(lockFacePhase("paused", breakPosition)).toBe("break");
  });

  it("builds clocks from the current lock segment, not a kill countdown", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const focus = buildLockFaceProps({
      status: "running",
      position: focusPosition,
      elapsedSec: 525,
      remainingSec: 1275,
      planFocusMin: 25,
      log,
      now,
      width: 1280,
      height: 720,
    });
    expect(focus.phase).toBe("focus");
    expect(focus.progress).toBe(0.35);
    expect(focus.elapsedMs).toBe(525_000);
    expect(focus.remainingMs).toBe(975_000);
    expect(focus.estimateMinutes).toBe(25);
    expect(focus.sessionProgress).toBe(0.35);
    expect(focus.sessionElapsedMs).toBe(525_000);
    expect(focus.sessionRemainingMs).toBe(1_275_000);
    expect(focus.sessionEstimateMinutes).toBe(30);
    expect(focus.killCount).toBe(1);
    expect(focus.paused).toBe(false);
    expect(focus.sessionId).toBe("lock");

    const rest = buildLockFaceProps({
      status: "running",
      position: breakPosition,
      elapsedSec: 1620,
      remainingSec: 180,
      planFocusMin: 25,
      log,
      now,
      width: 1280,
      height: 720,
    });
    expect(rest.phase).toBe("break");
    expect(rest.progress).toBe(0.4);
    expect(rest.elapsedMs).toBe(120_000);
    expect(rest.remainingMs).toBe(180_000);
    expect(rest.estimateMinutes).toBe(5);
    expect(rest.sessionProgress).toBe(0.7);
    expect(rest.sessionElapsedMs).toBe(1_620_000);
    expect(rest.sessionRemainingMs).toBe(180_000);
    expect(rest.sessionEstimateMinutes).toBe(30);
  });

  it("keeps the lock face in motion even when the timer is paused", () => {
    const face = buildLockFaceProps({
      status: "paused",
      position: focusPosition,
      elapsedSec: 525,
      remainingSec: 1275,
      planFocusMin: 25,
      log: [],
      now: new Date("2026-09-12T12:00:00Z"),
      width: 800,
      height: 600,
    });
    expect(face.phase).toBe("focus");
    expect(face.paused).toBe(false);
  });
});
