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

const MAX_SESSION_LOG = 1000;

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

function readJson(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Failed to read ${filePath}: ${message}`);
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const countdownRaw = isFiniteNumber(raw?.countdownSec)
    ? raw.countdownSec
    : DEFAULT_SETTINGS.countdownSec;
  const thresholdRaw = isFiniteNumber(raw?.deskThreshold)
    ? raw.deskThreshold
    : DEFAULT_SETTINGS.deskThreshold;
  return {
    countdownSec: Math.min(600, Math.max(0, Math.round(countdownRaw))),
    deskThreshold: Math.min(1, Math.max(0, thresholdRaw)),
    strictMode: typeof raw?.strictMode === "boolean" ? raw.strictMode : DEFAULT_SETTINGS.strictMode,
    webcamEnabled:
      typeof raw?.webcamEnabled === "boolean"
        ? raw.webcamEnabled
        : DEFAULT_SETTINGS.webcamEnabled,
  };
}

function parseSettings(value: unknown): AppSettings | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return normalizeSettings(value as Partial<AppSettings>);
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
    typeof record.detail === "string"
  );
}

function parseSessionLog(value: unknown): SessionEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isSessionEvent).slice(0, MAX_SESSION_LOG);
}

/**
 * JSON Store for lists, settings, and the session event log.
 * Lists stay in the existing `allowlist.json` / `blocklist.json` files so the
 * window monitor can share this instance via loadAllowlist/loadBlocklist.
 */
export class FocusPlugStore implements Store {
  private readonly lists: ListsJsonStore;
  private readonly settingsPath: string;
  private readonly logPath: string;
  private settingsCache: AppSettings | null = null;
  private logCache: SessionEvent[] | null = null;

  constructor(directory: string) {
    this.lists = new ListsJsonStore(directory);
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
      return { ...this.settingsCache };
    }
    const loaded = parseSettings(readJson(this.settingsPath));
    this.settingsCache = loaded ?? { ...DEFAULT_SETTINGS };
    if (loaded === null) {
      this.persistSettings();
    }
    return { ...this.settingsCache };
  }

  saveSettings(settings: AppSettings): void {
    this.settingsCache = normalizeSettings(settings);
    this.persistSettings();
  }

  appendSessionLog(event: SessionEvent): void {
    if (!isSessionEvent(event)) {
      throw new Error("session log event must include ts, kind, and detail");
    }
    const next: SessionEvent = {
      ts: event.ts,
      kind: event.kind,
      detail: event.detail,
    };
    const log = this.loadSessionLog();
    this.logCache = [next, ...log].slice(0, MAX_SESSION_LOG);
    this.persistLog();
  }

  loadSessionLog(): SessionEvent[] {
    if (this.logCache !== null) {
      return this.logCache.map((event) => ({ ...event }));
    }
    const loaded = parseSessionLog(readJson(this.logPath));
    this.logCache = loaded;
    return loaded.map((event) => ({ ...event }));
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

export function createAppStore(directory: string): FocusPlugStore {
  return new FocusPlugStore(directory);
}
