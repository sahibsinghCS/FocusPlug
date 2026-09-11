import { describe, expect, it } from "vitest";
import { ALL_BLOCKLIST_TARGET } from "../../shared/policy/index.ts";
import type { AppEntry } from "../../shared/types.ts";
import { enabledBlocklistMatchers, expandKillTargets, flattenEnabledMatchers } from "./targets.ts";

const allow: AppEntry[] = [
  { id: "chrome", name: "Chrome", match: ["chrome", "chrome.exe"], enabled: true },
  { id: "docs", name: "Docs", match: ["google docs"], enabled: false },
];

const block: AppEntry[] = [
  { id: "discord", name: "Discord", match: ["discord", "discord.exe"], enabled: true },
  { id: "steam", name: "Steam", match: ["steam", "steam.exe"], enabled: true },
  { id: "games", name: "Off", match: ["fortnite"], enabled: false },
];

describe("expandKillTargets", () => {
  it("expands the blocklist sentinel to enabled matchers only", () => {
    const expanded = expandKillTargets([ALL_BLOCKLIST_TARGET], block);
    expect(expanded).toEqual(["discord", "discord.exe", "steam", "steam.exe"]);
    expect(expanded).not.toContain(ALL_BLOCKLIST_TARGET);
    expect(expanded).not.toContain("fortnite");
  });

  it("passes through a focused process name and unions sentinel matchers", () => {
    const expanded = expandKillTargets(["Discord.exe", ALL_BLOCKLIST_TARGET], block);
    expect(expanded[0]).toBe("Discord.exe");
    expect(expanded).toContain("steam");
    expect(expanded.filter((item) => item.toLowerCase() === "discord.exe")).toHaveLength(1);
  });

  it("drops empty tokens", () => {
    expect(expandKillTargets(["", "  ", "discord.exe"], block)).toEqual(["discord.exe"]);
  });
});

describe("flattenEnabledMatchers", () => {
  it("skips disabled allowlist entries", () => {
    expect(flattenEnabledMatchers(allow)).toEqual(["chrome", "chrome.exe"]);
  });

  it("enabledBlocklistMatchers matches sentinel expansion", () => {
    expect(enabledBlocklistMatchers(block)).toEqual(expandKillTargets([ALL_BLOCKLIST_TARGET], block));
  });
});
