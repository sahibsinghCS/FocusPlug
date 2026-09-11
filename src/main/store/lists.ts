import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Store } from "../../shared/ipc.ts";
import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "../../shared/defaults.ts";
import type { AppEntry } from "../../shared/types.ts";

export type ListsStore = Pick<
  Store,
  "loadAllowlist" | "saveAllowlist" | "loadBlocklist" | "saveBlocklist"
>;

function cloneEntries(entries: AppEntry[]): AppEntry[] {
  return entries.map((entry) => ({
    ...entry,
    match: [...entry.match],
  }));
}

function isAppEntry(value: unknown): value is AppEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.name === "string" &&
    Array.isArray(record.match) &&
    record.match.every((item) => typeof item === "string") &&
    typeof record.enabled === "boolean"
  );
}

function parseEntryList(raw: string, label: string): AppEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const entries = parsed.filter(isAppEntry);
  if (entries.length === 0 && parsed.length > 0) {
    console.error(`Ignoring corrupt ${label}: no valid AppEntry objects`);
    return null;
  }
  if (entries.length !== parsed.length) {
    console.error(
      `Dropping ${parsed.length - entries.length} invalid ${label} item(s)`,
    );
  }
  return cloneEntries(entries);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    renameSync(tmp, filePath);
  } catch {
    copyFileSync(tmp, filePath);
    unlinkSync(tmp);
  }
}

function readListFile(filePath: string, label: string): AppEntry[] | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return parseEntryList(readFileSync(filePath, "utf8"), label);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Failed to read ${label}: ${message}`);
    return null;
  }
}

export class ListsJsonStore implements ListsStore {
  private readonly allowPath: string;
  private readonly blockPath: string;
  private allowCache: AppEntry[] | null = null;
  private blockCache: AppEntry[] | null = null;

  constructor(directory: string) {
    this.allowPath = join(directory, "allowlist.json");
    this.blockPath = join(directory, "blocklist.json");
  }

  loadAllowlist(): AppEntry[] {
    if (this.allowCache !== null) {
      return cloneEntries(this.allowCache);
    }
    const loaded = readListFile(this.allowPath, "allowlist");
    this.allowCache = loaded ?? cloneEntries(DEFAULT_ALLOWLIST);
    if (loaded === null) {
      this.persistAllow();
    }
    return cloneEntries(this.allowCache);
  }

  saveAllowlist(entries: AppEntry[]): void {
    const validated = parseEntryList(JSON.stringify(entries), "allowlist");
    if (validated === null) {
      throw new Error("allowlist must be an array of AppEntry objects");
    }
    this.allowCache = validated;
    this.persistAllow();
  }

  loadBlocklist(): AppEntry[] {
    if (this.blockCache !== null) {
      return cloneEntries(this.blockCache);
    }
    const loaded = readListFile(this.blockPath, "blocklist");
    this.blockCache = loaded ?? cloneEntries(DEFAULT_BLOCKLIST);
    if (loaded === null) {
      this.persistBlock();
    }
    return cloneEntries(this.blockCache);
  }

  saveBlocklist(entries: AppEntry[]): void {
    const validated = parseEntryList(JSON.stringify(entries), "blocklist");
    if (validated === null) {
      throw new Error("blocklist must be an array of AppEntry objects");
    }
    this.blockCache = validated;
    this.persistBlock();
  }

  private persistAllow(): void {
    if (this.allowCache === null) {
      return;
    }
    writeJsonAtomic(this.allowPath, this.allowCache);
  }

  private persistBlock(): void {
    if (this.blockCache === null) {
      return;
    }
    writeJsonAtomic(this.blockPath, this.blockCache);
  }
}

export function createListsStore(directory: string): ListsJsonStore {
  return new ListsJsonStore(directory);
}
