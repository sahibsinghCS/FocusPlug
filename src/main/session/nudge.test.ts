import { describe, expect, it } from "vitest";
import type { AttentionLabel, DeskSnapshot } from "@shared/types";
import { NUDGE_REPEAT_MS, NudgeTracker } from "./nudge";

function reading(label: AttentionLabel, confidence = 0.9): DeskSnapshot {
  return { ts: 0, label: "at_desk", confidence: 0.95, webcamEnabled: true, attention: { label, confidence } };
}

describe("NudgeTracker", () => {
  it("needs two off-task readings in a row, then nudges with the latest kind", () => {
    const tracker = new NudgeTracker();
    expect(tracker.observeDesk(reading("phone"), 0.6, 0)).toBeNull();
    expect(tracker.observeDesk(reading("phone"), 0.6, 1000)).toBe("phone");
  });

  it("a continuing drift re-nudges only after the repeat window", () => {
    const tracker = new NudgeTracker();
    tracker.observeDesk(reading("unfocused"), 0.6, 0);
    expect(tracker.observeDesk(reading("unfocused"), 0.6, 1000)).toBe("unfocused");
    expect(tracker.observeDesk(reading("unfocused"), 0.6, 2000)).toBeNull();
    expect(tracker.observeDesk(reading("phone"), 0.6, 1000 + NUDGE_REPEAT_MS)).toBe("phone");
  });

  it("refocusing re-arms immediately", () => {
    const tracker = new NudgeTracker();
    tracker.observeDesk(reading("phone"), 0.6, 0);
    expect(tracker.observeDesk(reading("phone"), 0.6, 1000)).toBe("phone");
    tracker.observeDesk(reading("focused"), 0.6, 2000);
    tracker.observeDesk(reading("phone"), 0.6, 3000);
    expect(tracker.observeDesk(reading("phone"), 0.6, 4000)).toBe("phone");
  });

  it("unsure readings break a streak without counting as drift or recovery", () => {
    const tracker = new NudgeTracker();
    tracker.observeDesk(reading("phone"), 0.6, 0);
    expect(tracker.observeDesk(reading("phone", 0.4), 0.6, 1000)).toBeNull();
    expect(tracker.observeDesk({ ...reading("phone"), label: "away" }, 0.6, 2000)).toBeNull();
    expect(tracker.observeDesk({ ...reading("phone"), webcamEnabled: false }, 0.6, 3000)).toBeNull();
    const noHead: DeskSnapshot = { ts: 0, label: "at_desk", confidence: 0.95, webcamEnabled: true };
    expect(tracker.observeDesk(noHead, 0.6, 4000)).toBeNull();
    expect(tracker.observeDesk(null, 0.6, 5000)).toBeNull();
  });

  it("a blocked-app nudge holds attention nudges off for the window", () => {
    const tracker = new NudgeTracker();
    tracker.blocked(0);
    tracker.observeDesk(reading("phone"), 0.6, 1000);
    expect(tracker.observeDesk(reading("phone"), 0.6, 2000)).toBeNull();
    tracker.reset();
    tracker.observeDesk(reading("phone"), 0.6, 3000);
    expect(tracker.observeDesk(reading("phone"), 0.6, 4000)).toBe("phone");
  });
});
