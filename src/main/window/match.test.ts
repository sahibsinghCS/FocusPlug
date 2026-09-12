import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "../../shared/defaults.ts";
import type { AppEntry } from "../../shared/types.ts";
import { entryMatches, findMatchingEntry, processBasename } from "./match.ts";
import { buildFocusSnapshot } from "./snapshot.ts";
import { FOREGROUND_SCRIPT, parseForegroundPayload } from "./win32.ts";

const discordLike = {
  processName: "Discord",
  windowTitle: "Friends - Discord",
};

const chromeDocs = {
  processName: "chrome",
  windowTitle: "Essay - Google Docs - Google Chrome",
};

describe("processBasename", () => {
  test("strips .exe and path", () => {
    assert.equal(processBasename("Discord.exe"), "discord");
    assert.equal(
      processBasename(String.raw`C:\Users\a\AppData\Local\Discord\Discord.exe`),
      "discord",
    );
    assert.equal(processBasename("chrome"), "chrome");
  });
});

describe("entryMatches", () => {
  test("matches Discord process against default blocklist", () => {
    const discord = DEFAULT_BLOCKLIST.find((e) => e.id === "discord");
    assert.ok(discord);
    assert.equal(entryMatches(discord, discordLike.processName, discordLike.windowTitle), true);
    assert.equal(entryMatches(discord, "discord.exe", ""), true);
  });

  test("matches Chrome process and Google Docs title against default allowlist", () => {
    const chrome = DEFAULT_ALLOWLIST.find((e) => e.id === "chrome");
    const docs = DEFAULT_ALLOWLIST.find((e) => e.id === "google-docs");
    assert.ok(chrome);
    assert.ok(docs);
    assert.equal(entryMatches(chrome, chromeDocs.processName, chromeDocs.windowTitle), true);
    assert.equal(entryMatches(docs, chromeDocs.processName, chromeDocs.windowTitle), true);
    assert.equal(entryMatches(docs, "msedge", "Homework - Google Docs"), true);
  });

  test("ignores disabled entries", () => {
    const disabled: AppEntry = {
      id: "discord",
      name: "Discord",
      match: ["discord"],
      enabled: false,
    };
    assert.equal(entryMatches(disabled, "Discord", "Discord"), false);
  });

  test("does not treat short process tokens as title-only false friends on process basename", () => {
    const code = DEFAULT_ALLOWLIST.find((e) => e.id === "code");
    assert.ok(code);
    assert.equal(entryMatches(code, "code", "FocusPlug"), true);
    assert.equal(entryMatches(code, "codehelper", "FocusPlug"), false);
  });
});

describe("buildFocusSnapshot", () => {
  test("Discord-like title/process → matchedBlock with blockEntryId", () => {
    const snap = buildFocusSnapshot({
      ...discordLike,
      allowlist: DEFAULT_ALLOWLIST,
      blocklist: DEFAULT_BLOCKLIST,
      ts: 1,
    });
    assert.equal(snap.matchedBlock, true);
    assert.equal(snap.matchedAllow, false);
    assert.equal(snap.blockEntryId, "discord");
    assert.equal(snap.processName, "Discord");
    assert.equal(snap.ts, 1);
  });

  test("Chrome/Docs → matchedAllow", () => {
    const snap = buildFocusSnapshot({
      ...chromeDocs,
      allowlist: DEFAULT_ALLOWLIST,
      blocklist: DEFAULT_BLOCKLIST,
      ts: 2,
    });
    assert.equal(snap.matchedAllow, true);
    assert.equal(snap.matchedBlock, false);
    assert.equal(snap.blockEntryId, undefined);
  });

  test("can match allow and block together", () => {
    const snap = buildFocusSnapshot({
      processName: "chrome",
      windowTitle: "Discord | #general - Google Chrome",
      allowlist: DEFAULT_ALLOWLIST,
      blocklist: DEFAULT_BLOCKLIST,
    });
    assert.equal(snap.matchedAllow, true);
    assert.equal(snap.matchedBlock, true);
    assert.equal(snap.blockEntryId, "discord");
  });

  test("findMatchingEntry returns first enabled hit", () => {
    const hit = findMatchingEntry(DEFAULT_BLOCKLIST, "steam.exe", "Steam");
    assert.equal(hit?.id, "steam");
  });
});

describe("parseForegroundPayload", () => {
  test("parses PowerShell JSON line", () => {
    const parsed = parseForegroundPayload(
      '{"processName":"chrome","windowTitle":"Docs","pid":44}',
    );
    assert.deepEqual(parsed, {
      processName: "chrome",
      windowTitle: "Docs",
      pid: 44,
    });
  });

  test("returns null on garbage", () => {
    assert.equal(parseForegroundPayload(""), null);
    assert.equal(parseForegroundPayload("not-json"), null);
  });
});

describe("FOREGROUND_SCRIPT", () => {
  test("never uses the read-only $pid automatic variable", () => {
    // $pid/$PID is a PowerShell automatic variable (ReadOnly, AllScope, case-insensitive);
    // assigning it throws every tick, degrading the sensor to the empty fallback payload.
    assert.doesNotMatch(FOREGROUND_SCRIPT, /\$pid\b/i);
    assert.match(FOREGROUND_SCRIPT, /\[ref\]\$procId/);
  });
});
