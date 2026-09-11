import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import type { AppSettings, Store } from "../../shared/ipc.ts";
import type { AppEntry, SessionEvent } from "../../shared/types.ts";
import { ListsJsonStore } from "./lists.ts";

export const MAX_SESSION_LOG = 500;

function cloneEntries(entries: AppEntry[]): AppEntry[] {
  return entries.map((entry) => ({
    ...entry,
    match: [...entry.match],
  }));
}

function cloneSettings(settings: AppSettings): AppSettings {
  return { ...settings };
}

function cloneEvent(event: SessionEvent): SessionEvent {
  return { ts: event.ts, kind: event.kind, detail: event.detail };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function isSessionEvent(value: unknown): value is SessionEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.ts === "number" &&
    Number.isFinite(record.ts) &&
    typeof record.kind === "string" &&
    record.kind.length > 0 &&
    typeof record.detail === "string"
  );
}

export function parseAppSettings(raw: unknown): AppSettings | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.countdownSec !== "number" || !Number.isFinite(record.countdownSec)) {
    return null;
  }
  if (typeof record.deskThreshold !== "number" || !Number.isFinite(record.deskThreshold)) {
    return null;
  }
  if (typeof record.strictMode !== "boolean") {
    return null;
  }
  if (typeof record.webcamEnabled !== "boolean") {
    return null;
  }
  return {
    countdownSec: clamp(record.countdownSec, 0, 600),
    deskThreshold: clamp(record.deskThreshold, 0, 1),
    strictMode: record.strictMode,
    webcamEnabled: record.webcamEnabled,
  };
}

function readJson(filePath: string): unknown | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Failed to read ${filePath}: ${message}`);
    return null;
  }
}

/**
 * Settings + session-log persistence wrapping the existing lists store.
 * Session-wiring may extend Store; lists JSON remains owned by window-monitor.
 */
export class FocusPlugStore implements Store {
  private readonly lists: ListsJsonStore;
  private readonly settingsPath: string;
  private readonly logPath: string;
  private settingsCache: AppSettings | null = null;
  private logCache: SessionEvent[] | null = null;

  constructor(directory: string, lists?: ListsJsonStore) {
    this.lists = lists ?? new ListsJsonStore(directory);
    this.settingsPath = join(directory, "settings.json");
    this.logPath = join(directory, "session-log.json");
  }

  loadAllowlist(): AppEntry[] {
    return this.lists.loadAllowlist();
  }

  saveAllowlist(entries: AppEntry[]): void {
    this.lists.saveAllowlist(entries);
  }

  loadBlocklist(): AppEntry[] {
    return this.lists.loadBlocklist();
  }

  saveBlocklist(entries: AppEntry[]): void {
    this.lists.saveBlocklist(entries);
  }

  loadSettings(): AppSettings {
    if (this.settingsCache !== null) {
      return cloneSettings(this.settingsCache);
    }
    const parsed = parseAppSettings(readJson(this.settingsPath));
    this.settingsCache = parsed ?? cloneSettings(DEFAULT_SETTINGS);
    if (parsed === null) {
      this.persistSettings();
    }
    return cloneSettings(this.settingsCache);
  }

  saveSettings(settings: AppSettings): void {
    const parsed = parseAppSettings(settings);
    if (parsed === null) {
      throw new Error("settings must include countdownSec, deskThreshold, strictMode, webcamEnabled");
    }
    this.settingsCache = parsed;
    this.persistSettings();
  }

  loadSessionLog(): SessionEvent[] {
    if (this.logCache !== null) {
      return this.logCache.map(cloneEvent);
    }
    const raw = readJson(this.logPath);
    const events: SessionEvent[] = [];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (isSessionEvent(item)) {
          events.push(cloneEvent(item));
        }
      }
    }
    this.logCache = events.slice(0, MAX_SESSION_LOG);
    if (!existsSync(this.logPath)) {
      this.persistLog();
    }
    return this.logCache.map(cloneEvent);
  }

  appendSessionLog(event: SessionEvent): void {
    if (!isSessionEvent(event)) {
      throw new Error("session log event must have ts, kind, and detail");
    }
    const current = this.loadSessionLog();
    this.logCache = [cloneEvent(event), ...current].slice(0, MAX_SESSION_LOG);
    this.persistLog();
  }

  private persistSettings(): void {
    if (this.settingsCache === null) {
      return;
    }
    writeJsonAtomic(this.settingsPath, this.settingsCache);
  }

  private persistLog(): void {
    if (this.logCache === null) {
      return;
    }
    writeJsonAtomic(this.logPath, this.logCache);
  }
}

export function createFocusPlugStore(
  directory: string,
  lists?: ListsJsonStore,
): FocusPlugStore {
  return new FocusPlugStore(directory, lists);
}

export function cloneAppEntries(entries: AppEntry[]): AppEntry[] {
  return cloneEntries(entries);
}
