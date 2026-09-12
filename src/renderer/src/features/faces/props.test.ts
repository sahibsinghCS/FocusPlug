import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@shared/ipc";
import { formatFaceClock } from "./clock";
import {
  buildFaceProps,
  countKills,
  facePhase,
  faceProgress,
  faceSessionId,
  remainingMs,
  selectedFaceId,
} from "./props";

const log: SessionEvent[] = [
  { ts: 1000, kind: "session", detail: "Session started" },
  { ts: 2000, kind: "kill", detail: "blocked_focus · killed discord.exe" },
  { ts: 3000, kind: "demo", detail: "Demo Kill · killed discord.exe" },
];

describe("face props", () => {
  it("maps idle / focus / fuse phases and honest clocks", () => {
    expect(facePhase({ sessionActive: false, countdownSec: 0 })).toBe("idle");
    expect(facePhase({ sessionActive: true, countdownSec: 0 })).toBe("focus");
    expect(facePhase({ sessionActive: true, countdownSec: 8 })).toBe("break");
    expect(formatFaceClock(94_000)).toBe("01:34");
    expect(formatFaceClock(3_723_000)).toBe("1:02:03");
    expect(faceSessionId(null, true)).toBe("idle");
    expect(faceSessionId(1700, true)).toBe("sess-1700");
  });

  it("transfers hourglass sand on the block, and on the fuse when it is live", () => {
    expect(
      faceProgress({
        phase: "idle",
        elapsedMs: 0,
        estimateMinutes: 50,
        countdownSec: 0,
        fuseArmedSec: 10,
      }),
    ).toBe(0);
    expect(
      faceProgress({
        phase: "focus",
        elapsedMs: 25 * 60_000,
        estimateMinutes: 50,
        countdownSec: 0,
        fuseArmedSec: 10,
      }),
    ).toBe(0.5);
    expect(
      faceProgress({
        phase: "break",
        elapsedMs: 12_000,
        estimateMinutes: 50,
        countdownSec: 2,
        fuseArmedSec: 10,
      }),
    ).toBe(0.8);
    expect(
      remainingMs({
        phase: "break",
        elapsedMs: 12_000,
        estimateMinutes: 50,
        countdownSec: 8,
      }),
    ).toBe(8000);
  });

  it("counts kill/demo events and keeps selected ids in the catalog", () => {
    expect(countKills(log)).toBe(2);
    expect(selectedFaceId("hourglass")).toBe("hourglass");
    expect(selectedFaceId("flask")).toBe("flask");
    expect(selectedFaceId("candle")).toBe("candle");
    expect(selectedFaceId("column")).toBe("flight");
    expect(selectedFaceId("field")).toBe("flight");
    const props = buildFaceProps({
      sessionActive: true,
      decision: "ON_TASK",
      elapsedSec: 120,
      countdownSec: 0,
      fuseArmedSec: 10,
      startedAt: 50,
      log,
      now: new Date("2026-09-12T12:00:00Z"),
      width: 960,
      height: 300,
    });
    expect(props.phase).toBe("focus");
    expect(props.elapsedMs).toBe(120_000);
    expect(props.killCount).toBe(2);
    expect(props.sessionId).toBe("sess-50");
    expect(props.estimateMinutes).toBe(50);
    expect(props.events[1]?.severity).toBe(1);
  });
});
