import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@shared/ipc";
import type { RunPosition } from "../timer/runtime";
import { buildLockFaceProps, lockFacePhase, sessionLogSince } from "./lockProps";

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
      startedAtMs: 1000,
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
    expect(focus.sessionId).toBe("sess-1000");

    const rest = buildLockFaceProps({
      status: "running",
      position: breakPosition,
      elapsedSec: 1620,
      remainingSec: 180,
      planFocusMin: 25,
      log,
      startedAtMs: 1000,
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
      startedAtMs: 1_700_000_000_000,
      now: new Date("2026-09-12T12:00:00Z"),
      width: 800,
      height: 600,
    });
    expect(face.phase).toBe("focus");
    expect(face.paused).toBe(false);
    expect(face.sessionId).toBe("sess-1700000000000");
  });

  it("does not count kills logged before the session start", () => {
    const startedAtMs = 50_000;
    const leaked: SessionEvent[] = [
      { ts: 1_000, kind: "kill", detail: "blocked_focus · killed discord.exe" },
      { ts: 40_000, kind: "demo", detail: "Demo Kill · killed discord.exe" },
      { ts: 49_999, kind: "kill", detail: "one millisecond too old" },
      { ts: 50_000, kind: "session", detail: "Session started" },
      { ts: 51_000, kind: "kill", detail: "blocked_focus · killed steam.exe" },
    ];

    expect(sessionLogSince(leaked, startedAtMs)).toEqual([
      { ts: 50_000, kind: "session", detail: "Session started" },
      { ts: 51_000, kind: "kill", detail: "blocked_focus · killed steam.exe" },
    ]);
    expect(sessionLogSince(leaked, null)).toEqual([]);

    const face = buildLockFaceProps({
      status: "running",
      position: focusPosition,
      elapsedSec: 1,
      remainingSec: 1499,
      planFocusMin: 25,
      log: leaked,
      startedAtMs,
      now: new Date("2026-09-12T12:00:00Z"),
      width: 1280,
      height: 720,
    });
    expect(face.killCount).toBe(1);
    expect(face.events).toHaveLength(2);
    expect(face.events.some((event) => event.kind === "kill" && event.ts < startedAtMs)).toBe(
      false,
    );
    expect(face.sessionId).toBe("sess-50000");

    const nextSession = buildLockFaceProps({
      status: "running",
      position: focusPosition,
      elapsedSec: 1,
      remainingSec: 1499,
      planFocusMin: 25,
      log: leaked,
      startedAtMs: 80_000,
      now: new Date("2026-09-12T12:00:00Z"),
      width: 1280,
      height: 720,
    });
    expect(nextSession.killCount).toBe(0);
    expect(nextSession.sessionId).toBe("sess-80000");
    expect(nextSession.sessionId).not.toBe(face.sessionId);
  });
});
