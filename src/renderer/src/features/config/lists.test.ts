import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "@shared/defaults";
import {
  commitTokenDraft,
  countEnabled,
  entryReturned,
  isShippedDefault,
  listCopy,
  parseMatchTokens,
  validateListDraft,
} from "./lists";

describe("config lists", () => {
  it("parses, trims, and de-dupes match tokens", () => {
    expect(parseMatchTokens(" chrome, Chrome.exe , ,docs.google.com\nCHROME")).toEqual([
      "chrome",
      "Chrome.exe",
      "docs.google.com",
    ]);
  });

  it("commits a draft token onto existing chips", () => {
    expect(commitTokenDraft(["discord"], "discord.exe")).toEqual(["discord", "discord.exe"]);
    expect(commitTokenDraft(["discord"], "Discord")).toEqual(["discord"]);
  });

  it("requires a name and at least one token", () => {
    expect(validateListDraft({ name: "  ", match: ["chrome"] })?.field).toBe("name");
    expect(validateListDraft({ name: "Chrome", match: [] })?.field).toBe("match");
    expect(validateListDraft({ name: "Chrome", match: ["chrome"] })).toBeNull();
  });

  it("explains shipped defaults by id", () => {
    expect(isShippedDefault("allow", "chrome")).toBe(true);
    expect(isShippedDefault("allow", "obsidian")).toBe(false);
    expect(isShippedDefault("block", "discord")).toBe(true);
    expect(DEFAULT_ALLOWLIST.every((entry) => entry.enabled)).toBe(true);
    expect(DEFAULT_BLOCKLIST.every((entry) => entry.enabled)).toBe(true);
    expect(listCopy("allow").defaults).toMatch(/Chrome/);
    expect(listCopy("block").defaults).toMatch(/Discord/);
  });

  it("counts enabled rows and confirms returned ids", () => {
    const entries = [
      { id: "a", name: "A", match: ["a"], enabled: true },
      { id: "b", name: "B", match: ["b"], enabled: false },
    ];
    expect(countEnabled(entries)).toBe(1);
    expect(entryReturned(entries, "a")).toBe(true);
    expect(entryReturned(entries, "missing")).toBe(false);
  });
});
