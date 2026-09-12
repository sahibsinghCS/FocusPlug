import { describe, expect, it } from "vitest";
import { appDisplayName, formatRemainingWords, isPlugMode, nudgeCopy } from "./nudge";

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

  it("formats time and names", () => {
    expect(formatRemainingWords(30)).toBe("under a minute");
    expect(formatRemainingWords(60)).toBe("1 minute");
    expect(appDisplayName("  ")).toBeNull();
    expect(isPlugMode("nudge")).toBe(true);
    expect(isPlugMode("off")).toBe(false);
  });
});
