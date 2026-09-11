import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "../../shared/defaults.ts";
import type { AppEntry } from "../../shared/types.ts";
import { ListsJsonStore } from "./lists.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "focusplug-lists-"));
}

describe("ListsJsonStore", () => {
  test("seeds defaults on first load and reloads from disk in a new instance", () => {
    const dir = tempDir();
    const first = new ListsJsonStore(dir);
    const allow = first.loadAllowlist();
    const block = first.loadBlocklist();
    assert.equal(allow.some((e) => e.id === "chrome"), true);
    assert.equal(block.some((e) => e.id === "discord"), true);
    assert.deepEqual(
      allow.map((e) => e.id),
      DEFAULT_ALLOWLIST.map((e) => e.id),
    );
    assert.deepEqual(
      block.map((e) => e.id),
      DEFAULT_BLOCKLIST.map((e) => e.id),
    );

    const second = new ListsJsonStore(dir);
    assert.deepEqual(
      second.loadAllowlist().map((e) => e.id),
      DEFAULT_ALLOWLIST.map((e) => e.id),
    );
    assert.equal(second.loadBlocklist().find((e) => e.id === "discord")?.enabled, true);
  });

  test("save/load roundtrip custom lists", () => {
    const dir = tempDir();
    const store = new ListsJsonStore(dir);
    const allow: AppEntry[] = [
      { id: "docs", name: "Docs", match: ["google docs"], enabled: true },
    ];
    const block: AppEntry[] = [
      { id: "game", name: "Game", match: ["discord"], enabled: true },
    ];
    store.saveAllowlist(allow);
    store.saveBlocklist(block);

    const reloaded = new ListsJsonStore(dir);
    assert.deepEqual(reloaded.loadAllowlist(), allow);
    assert.deepEqual(reloaded.loadBlocklist(), block);
  });

  test("returns clones so callers cannot mutate the cache", () => {
    const dir = tempDir();
    const store = new ListsJsonStore(dir);
    const loaded = store.loadAllowlist();
    const first = loaded[0];
    assert.ok(first);
    first.name = "mutated";
    first.match.push("nope");
    assert.notEqual(store.loadAllowlist()[0]?.name, "mutated");
    assert.equal(store.loadAllowlist()[0]?.match.includes("nope"), false);
  });

  test("corrupt JSON falls back to defaults", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "allowlist.json"), "{not json", "utf8");
    const store = new ListsJsonStore(dir);
    assert.equal(store.loadAllowlist()[0]?.id, DEFAULT_ALLOWLIST[0]?.id);
  });

  test("rejects invalid save payloads", () => {
    const dir = tempDir();
    const store = new ListsJsonStore(dir);
    assert.throws(() => store.saveAllowlist("nope" as unknown as AppEntry[]));
  });

  test("written files are JSON arrays", () => {
    const dir = tempDir();
    const store = new ListsJsonStore(dir);
    store.loadAllowlist();
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "allowlist.json"), "utf8"));
    assert.equal(Array.isArray(parsed), true);
  });
});
