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
import { isFaceId } from "../../shared/faces.ts";
import { normalizeFlightPair } from "../../shared/flightRoute.ts";
import { isPlugMode } from "../../shared/nudge.ts";
import type { AppSettings, Store } from "../../shared/ipc.ts";
import type {
  AppEntry,
  DeskModelId,
  PlugDevice,
  PlugProtocol,
  SessionEvent,
} from "../../shared/types.ts";
import { isControllable } from "../plugs/protect.ts";
import { ListsJsonStore } from "./lists.ts";

const MAX_SESSION_LOG = 1000;

/**
 * The four files FocusPlug keeps in `userData`, named once.
 *
 * `scripts/demo-seed.ts` writes two of them from outside the app — the plan
 * ledger it seeds and the settings it pins for filming — and a seeding tool
 * that guessed at a filename would write a file nothing reads, which is the
 * worst possible failure the night before a demo. It imports these instead,
 * so the app and the seeder cannot drift.
 */
export const SETTINGS_FILE = "settings.json";
export const SESSION_LOG_FILE = "session-log.json";
export const ADAPTIVE_MODEL_FILE = "adaptive-model.json";
export const PLAN_LEDGER_FILE = "focus-plan.json";

export function settingsPath(directory: string): string {
  return join(directory, SETTINGS_FILE);
}

export function planLedgerPath(directory: string): string {
  return join(directory, PLAN_LEDGER_FILE);
}

/**
 * The atomic JSON write the store uses, exported so a tool writing into a live
 * userData directory cannot leave a half-file behind either.
 */
export function writeUserDataJson(filePath: string, value: unknown): void {
  writeJsonAtomic(filePath, value);
}

/** The store's own defensive read: missing or unparseable ⇒ `null`, never a throw. */
export function readUserDataJson(filePath: string): unknown {
  return readJson(filePath);
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

const DESK_MODEL_IDS: readonly DeskModelId[] = ["stub", "blazeface", "custom"];
const PLUG_PROTOCOLS: readonly PlugProtocol[] = ["kasa", "http", "mock"];

export function isDeskModelId(value: unknown): value is DeskModelId {
  return (DESK_MODEL_IDS as readonly string[]).includes(value as string);
}

export function isPlugProtocol(value: unknown): value is PlugProtocol {
  return (PLUG_PROTOCOLS as readonly string[]).includes(value as string);
}

/** Accept only explicit `isStudyPc: false`. Study-PC plugs are never persisted. */
export function normalizePlugDevice(raw: unknown): PlugDevice | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }
  if (typeof record.name !== "string" || record.name.length === 0) {
    return null;
  }
  if (!isPlugProtocol(record.protocol)) {
    return null;
  }
  if (typeof record.address !== "string" || record.address.length === 0) {
    return null;
  }
  if (typeof record.enabled !== "boolean") {
    return null;
  }
  if (record.isStudyPc !== false) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    protocol: record.protocol,
    address: record.address,
    enabled: record.enabled,
    isStudyPc: false,
  };
}

/**
 * Load path for the plug array. Drops anything the protect layer would refuse
 * to command, not just malformed records: the SETTINGS_SET and PLUGS_ADD
 * routes both hard-deny those, so a legacy or hand-edited settings.json is the
 * only way one gets on disk — and if it survived the read, the renderer's
 * whole-array `persistPlugs` write would throw on every subsequent toggle of
 * ANY plug, with no in-app way to remove the offender. Dropping on load makes
 * a poisoned file self-heal on first read instead.
 */
export function normalizePlugs(raw: unknown): PlugDevice[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_SETTINGS.plugs.map((plug) => ({ ...plug }));
  }
  const seen = new Set<string>();
  const plugs: PlugDevice[] = [];
  for (const item of raw) {
    const plug = normalizePlugDevice(item);
    if (plug === null || seen.has(plug.id) || !isControllable(plug)) {
      continue;
    }
    seen.add(plug.id);
    plugs.push({ ...plug });
  }
  return plugs;
}

export function cloneSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    plugs: settings.plugs.map((plug) => ({ ...plug })),
  };
}

export function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const countdownRaw = isFiniteNumber(raw?.countdownSec)
    ? raw.countdownSec
    : DEFAULT_SETTINGS.countdownSec;
  const thresholdRaw = isFiniteNumber(raw?.deskThreshold)
    ? raw.deskThreshold
    : DEFAULT_SETTINGS.deskThreshold;
  const nudgeRiskRaw = isFiniteNumber(raw?.forecastNudgeRisk)
    ? raw.forecastNudgeRisk
    : DEFAULT_SETTINGS.forecastNudgeRisk;
  const prearmRiskRaw = isFiniteNumber(raw?.forecastPrearmRisk)
    ? raw.forecastPrearmRisk
    : DEFAULT_SETTINGS.forecastPrearmRisk;
  const prearmFuseRaw = isFiniteNumber(raw?.forecastPrearmFuseSec)
    ? raw.forecastPrearmFuseSec
    : DEFAULT_SETTINGS.forecastPrearmFuseSec;
  const awayPauseRaw = isFiniteNumber(raw?.pauseAwayConfidence)
    ? raw.pauseAwayConfidence
    : DEFAULT_SETTINGS.pauseAwayConfidence;
  const phonePauseRaw = isFiniteNumber(raw?.pausePhoneConfidence)
    ? raw.pausePhoneConfidence
    : DEFAULT_SETTINGS.pausePhoneConfidence;
  const pauseAwayConfidence = Math.min(0.95, Math.max(0.5, awayPauseRaw));
  // Structural, not advisory: the attention head is the weaker of the two, so
  // stopping the clock on a phone must always demand more than stopping it on
  // an away — whatever a hand-edited settings.json says.
  const pausePhoneConfidence = Math.max(
    Math.min(0.99, Math.max(0.5, phonePauseRaw)),
    pauseAwayConfidence + 0.05,
  );
  const forecastNudgeRisk = Math.min(0.9, Math.max(0.05, nudgeRiskRaw));
  // Pre-arm must sit meaningfully above the nudge threshold or the bands collapse.
  const forecastPrearmRisk = Math.max(
    Math.min(0.95, Math.max(0.1, prearmRiskRaw)),
    forecastNudgeRisk + 0.05,
  );
  return {
    countdownSec: Math.min(600, Math.max(0, Math.round(countdownRaw))),
    deskThreshold: Math.min(1, Math.max(0, thresholdRaw)),
    strictMode: typeof raw?.strictMode === "boolean" ? raw.strictMode : DEFAULT_SETTINGS.strictMode,
    webcamEnabled:
      typeof raw?.webcamEnabled === "boolean"
        ? raw.webcamEnabled
        : DEFAULT_SETTINGS.webcamEnabled,
    deskModelId: isDeskModelId(raw?.deskModelId) ? raw.deskModelId : DEFAULT_SETTINGS.deskModelId,
    faceId: isFaceId(raw?.faceId) ? raw.faceId : DEFAULT_SETTINGS.faceId,
    ...normalizeFlightPair(raw?.flightDep, raw?.flightArr),
    plugMode: isPlugMode(raw?.plugMode) ? raw.plugMode : DEFAULT_SETTINGS.plugMode,
    plugs: normalizePlugs(raw?.plugs),
    forecastEnabled:
      typeof raw?.forecastEnabled === "boolean"
        ? raw.forecastEnabled
        : DEFAULT_SETTINGS.forecastEnabled,
    forecastPrearmEnabled:
      typeof raw?.forecastPrearmEnabled === "boolean"
        ? raw.forecastPrearmEnabled
        : DEFAULT_SETTINGS.forecastPrearmEnabled,
    forecastNudgeRisk,
    forecastPrearmRisk,
    forecastPrearmFuseSec: Math.min(600, Math.max(3, Math.round(prearmFuseRaw))),
    pauseOnAwayEnabled:
      typeof raw?.pauseOnAwayEnabled === "boolean"
        ? raw.pauseOnAwayEnabled
        : DEFAULT_SETTINGS.pauseOnAwayEnabled,
    pauseOnPhoneEnabled:
      typeof raw?.pauseOnPhoneEnabled === "boolean"
        ? raw.pauseOnPhoneEnabled
        : DEFAULT_SETTINGS.pauseOnPhoneEnabled,
    pauseAwayConfidence,
    pausePhoneConfidence,
    focusPlanEnabled:
      typeof raw?.focusPlanEnabled === "boolean"
        ? raw.focusPlanEnabled
        : DEFAULT_SETTINGS.focusPlanEnabled,
    focusPlanStretchEnabled:
      typeof raw?.focusPlanStretchEnabled === "boolean"
        ? raw.focusPlanStretchEnabled
        : DEFAULT_SETTINGS.focusPlanStretchEnabled,
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
  private readonly modelPath: string;
  private readonly planPath: string;
  private settingsCache: AppSettings | null = null;
  private logCache: SessionEvent[] | null = null;

  constructor(directory: string) {
    this.lists = new ListsJsonStore(directory);
    this.settingsPath = settingsPath(directory);
    this.logPath = join(directory, SESSION_LOG_FILE);
    this.modelPath = join(directory, ADAPTIVE_MODEL_FILE);
    this.planPath = planLedgerPath(directory);
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
    this.settingsCache = loaded ?? cloneSettings(DEFAULT_SETTINGS);
    if (loaded === null) {
      this.persistSettings();
    }
    return cloneSettings(this.settingsCache);
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

  /**
   * The adaptive fuse's learned weights. Kept in its own file: it is derived
   * data that can always be thrown away and relearned, and losing it must
   * never take settings or the log with it.
   */
  loadAdaptiveModel(): unknown {
    return readJson(this.modelPath);
  }

  saveAdaptiveModel(value: unknown): void {
    writeJsonAtomic(this.modelPath, value);
  }

  /**
   * Focus Plan's round ledger, a sibling of `adaptive-model.json` and kept in
   * its own file for the same stated reason: derived data that can always be
   * thrown away and relearned, and losing it must never take settings or the
   * log with it. Written on round close only — roughly once every 25 minutes,
   * which is nothing next to the log's per-event write. Revived defensively
   * by `revivePlanLedger`; nothing here validates, and nothing here throws
   * into a session start.
   */
  loadPlanLedger(): unknown {
    return readJson(this.planPath);
  }

  savePlanLedger(value: unknown): void {
    writeJsonAtomic(this.planPath, value);
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
