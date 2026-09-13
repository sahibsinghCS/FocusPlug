import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import {
  appDisplayName,
  deskModelMayPauseOnAway,
  formatRemainingWords,
  isNudgeKind,
  isPauseKind,
  isPlugMode,
  nudgeCopy,
  pauseNotice,
} from "./nudge";

describe("nudge copy", () => {
  it("names the blocked app and counts down to the break", () => {
    expect(nudgeCopy({ kind: "blocked", app: "discord.exe", remainingSec: 750, until: "break" })).toEqual({
      title: "Discord can wait.",
      line: "Just 13 minutes to your break — keep going.",
    });
  });

  it("without a blocked app, counts down to the end", () => {
    expect(nudgeCopy({ kind: "phone", remainingSec: 480, until: "end" })).toEqual({
      title: "Phone down.",
      line: "Only 8 minutes longer to go — you got this.",
    });
    expect(nudgeCopy({ kind: "unfocused", remainingSec: 61, until: "break" }).line).toBe(
      "Only 2 minutes to your break — you got this.",
    );
  });

  it("still encourages when no timer is running", () => {
    expect(nudgeCopy({ kind: "unfocused", remainingSec: null, until: "end" }).line).toBe(
      "You got this — back to it.",
    );
    expect(nudgeCopy({ kind: "blocked", remainingSec: 0, until: "break" })).toEqual({
      title: "That app can wait.",
      line: "Close it and keep going.",
    });
  });

  it("names the drift that walked off", () => {
    expect(nudgeCopy({ kind: "away", remainingSec: 300, until: "break" })).toEqual({
      title: "Back to your desk.",
      line: "Only 5 minutes to your break — you got this.",
    });
    expect(nudgeCopy({ kind: "away", remainingSec: null, until: "end" }).line).toBe(
      "You got this — back to it.",
    );
  });

  it("knows which kinds exist and which may stop the clock", () => {
    expect(["phone", "unfocused", "away", "blocked"].every(isNudgeKind)).toBe(true);
    expect(isNudgeKind("uncertain")).toBe(false);
    expect(isNudgeKind("at_desk")).toBe(false);

    expect(isPauseKind("away")).toBe(true);
    expect(isPauseKind("phone")).toBe(true);
    // The vague one and the app one pull you back and nothing more.
    expect(isPauseKind("unfocused")).toBe(false);
    expect(isPauseKind("blocked")).toBe(false);
    expect(isPauseKind("uncertain")).toBe(false);
  });

  it("lets only the trained presence head stop the clock on away", () => {
    // `away` is a presence reading, and the presence models are not the same
    // instrument. The trained head is 92.5% precise on that call; the shipped
    // BlazeFace detector has no `away` class at all — it answers `away` for
    // any frame with no usable face — and is 42.1% precise, calling `away` on
    // 66.7% of the at-desk frames in the repo's own held-out eval.
    expect(deskModelMayPauseOnAway("custom")).toBe(true);
    expect(deskModelMayPauseOnAway("blazeface")).toBe(false);
    expect(deskModelMayPauseOnAway("stub")).toBe(false);

    // And the model that ships enabled is the one that may not, which is the
    // whole point: the default install nudges on away and never pauses on it.
    expect(DEFAULT_SETTINGS.deskModelId).toBe("blazeface");
    expect(deskModelMayPauseOnAway(DEFAULT_SETTINGS.deskModelId)).toBe(false);
  });

  it("says why the clock stopped, and offers one way to start it", () => {
    const away = pauseNotice("away");
    expect(away.kicker).toBe("Paused — you left the desk");
    expect(away.line).toContain("will not start itself");
    expect(away.line).toContain("not study time");
    expect(away.action).toBe("Start the clock again");

    const phone = pauseNotice("phone");
    expect(phone.kicker).toBe("Paused — phone");
    expect(phone.line).toContain("will not start itself");
    expect(phone.action).toBe(away.action);
    expect(phone.line).not.toBe(away.line);
  });

  it("formats time and names", () => {
    expect(formatRemainingWords(30)).toBe("under a minute");
    expect(formatRemainingWords(60)).toBe("1 minute");
    expect(appDisplayName("  ")).toBeNull();
    expect(isPlugMode("nudge")).toBe(true);
    expect(isPlugMode("off")).toBe(false);
  });
});
