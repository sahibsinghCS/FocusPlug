import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactToken,
  matchesForKill,
  matchesForProtect,
  peelExe,
} from "./match";

describe("peelExe / compactToken", () => {
  it("strips path, case, and .exe", () => {
    assert.equal(peelExe("C:\\\\Program Files\\\\Discord\\\\Discord.exe"), "discord");
    assert.equal(peelExe("chrome"), "chrome");
    assert.equal(compactToken("msedgewebview2.exe"), "msedgewebview2");
    assert.equal(compactToken("google chrome"), "googlechrome");
  });
});

describe("matchesForKill", () => {
  it("matches Discord.exe against discord", () => {
    assert.equal(matchesForKill("Discord.exe", "discord"), true);
    assert.equal(matchesForKill("discord.exe", "Discord"), true);
    assert.equal(matchesForKill("Discord.exe", "discord.exe"), true);
  });

  it("matches separator prefixes only (discord-canary), not steamwebhelper via steam", () => {
    assert.equal(matchesForKill("discord-canary.exe", "discord"), true);
    assert.equal(matchesForKill("steamwebhelper.exe", "steam"), false);
    assert.equal(matchesForKill("steamwebhelper.exe", "steamwebhelper"), true);
  });

  it("does not match allowlisted chrome when killing discord", () => {
    assert.equal(matchesForKill("chrome.exe", "discord"), false);
    assert.equal(matchesForKill("Code.exe", "discord"), false);
  });

  it("rejects empty matchers", () => {
    assert.equal(matchesForKill("discord.exe", "  "), false);
    assert.equal(matchesForKill("", "discord"), false);
  });
});

describe("matchesForProtect", () => {
  it("protects chrome helpers via prefix", () => {
    assert.equal(matchesForProtect("chrome.exe", "chrome"), true);
    assert.equal(matchesForProtect("chrome_crashpad_handler.exe", "chrome"), true);
    assert.equal(matchesForProtect("msedgewebview2.exe", "msedge"), true);
  });

  it("protects Code.exe via code matcher", () => {
    assert.equal(matchesForProtect("Code.exe", "code"), true);
    assert.equal(matchesForProtect("code.exe", "Code"), true);
  });

  it("does not let matcher 'c' protect chrome", () => {
    assert.equal(matchesForProtect("chrome.exe", "c"), false);
  });

  it("does not protect discord via chrome", () => {
    assert.equal(matchesForProtect("Discord.exe", "chrome"), false);
  });
});
