import { describe, expect, it } from "vitest";
import { deriveFaceProps, derivePhase, roundAtProgress } from "./derive";
import { DEMO_ROUNDS } from "./fixtures";

describe("deriveFaceProps", () => {
  it("fills FaceProps from a live session and real log kinds", () => {
    const started = 2_000_000;
    const now = started + 10 * 60 * 1000;
    const props = deriveFaceProps({
      sessionActive: true,
      decision: "ON_TASK",
      countdownSec: 0,
      log: [
        { ts: started, kind: "session", detail: "Session started" },
        { ts: started + 60_000, kind: "desk", detail: "away · 90%" },
      ],
      nowMs: now,
      elapsedMs: now - started,
      durationMs: 25 * 60 * 1000,
      sessionId: "fp-test",
    });
    expect(props.sessionId).toBe("fp-test");
    expect(props.elapsedMs).toBe(10 * 60 * 1000);
    expect(props.remainingMs).toBe(15 * 60 * 1000);
    expect(props.progress).toBeCloseTo(0.4, 5);
    expect(props.phase).toBe("focus");
    expect(props.events.some((event) => event.kind === "start")).toBe(true);
    expect(props.events.some((event) => event.kind === "drift")).toBe(true);
  });

  it("marks break from plan rounds and countdown from a live fuse", () => {
    const base = {
      sessionActive: true,
      decision: "ON_TASK" as const,
      countdownSec: 0,
      log: [],
      nowMs: 1,
      elapsedMs: 1,
    };
    expect(derivePhase(base, 0.34)).toBe("focus");
    expect(derivePhase({ ...base, rounds: DEMO_ROUNDS }, 0.34)).toBe("break");
    expect(
      derivePhase({ ...base, decision: "DISTRACTED", countdownSec: 8 }, 0.34),
    ).toBe("countdown");
  });

  it("resolves the round under the playhead", () => {
    expect(roundAtProgress(DEMO_ROUNDS, 0.34)?.kind).toBe("break");
    expect(roundAtProgress(DEMO_ROUNDS, 0.5)?.label).toBe("Round 2");
    expect(roundAtProgress(undefined, 0.5)).toBeNull();
  });
});
