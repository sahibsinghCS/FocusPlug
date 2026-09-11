import { describe, expect, it } from "vitest";
import { atmosphereFromSession, padCountdown, resolveAppName } from "./format";

describe("format helpers", () => {
  it("maps session atmosphere for the chassis glow", () => {
    expect(atmosphereFromSession(false, "ON_TASK", false)).toBe("off");
    expect(atmosphereFromSession(true, "ON_TASK", false)).toBe("live");
    expect(atmosphereFromSession(true, "AWAY", false)).toBe("away");
    expect(atmosphereFromSession(true, "DISTRACTED", false)).toBe("kill");
    expect(atmosphereFromSession(true, "ON_TASK", true)).toBe("kill");
    expect(atmosphereFromSession(true, "IDLE", false)).toBe("off");
  });

  it("resolves process names against list match tokens", () => {
    const lists = {
      allowlist: [{ name: "Google Chrome", match: ["chrome", "chrome.exe"] }],
      blocklist: [{ name: "Discord", match: ["discord"] }],
    };
    expect(resolveAppName("chrome", lists)).toBe("Google Chrome");
    expect(resolveAppName("Discord", lists)).toBe("Discord");
    expect(resolveAppName("unknown", lists)).toBe("unknown");
    expect(resolveAppName("No foreground app", lists)).toBe("No foreground app");
  });

  it("pads countdown digits", () => {
    expect(padCountdown(8)).toBe("08");
    expect(padCountdown(14)).toBe("14");
  });
});
