import {
  DEFAULT_ALLOWLIST,
  DEFAULT_BLOCKLIST,
  DEFAULT_SESSION_STATE,
  DEFAULT_SETTINGS,
} from "@shared/defaults";
import {
  type AppEntry,
  type AppLists,
  type AppSettings,
  type DeskModelId,
  type DeskSnapshot,
  type FocusPlugApi,
  type FocusSnapshot,
  type KillResult,
  type PlugDevice,
  type PolicyEvent,
  type SessionEvent,
  type SessionState,
} from "@shared/ipc";
import { isDeskModelId } from "./plugsUi";
import { readUrlScene } from "./urlScene";
import { goldenSessionEvents } from "../features/logs/fixtures";

function cloneEntries(entries: AppEntry[]): AppEntry[] {
  return entries.map((entry) => ({
    ...entry,
    match: [...entry.match],
  }));
}

function clonePlugs(plugs: readonly PlugDevice[]): PlugDevice[] {
  return plugs.map((plug) => ({ ...plug, isStudyPc: false as const }));
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    plugs: clonePlugs(settings.plugs),
  };
}

function now(): number {
  return Date.now();
}

const LIVE_FOCUS: FocusSnapshot = {
  ts: 0,
  processName: "chrome",
  windowTitle: "Essay draft — Google Docs",
  matchedAllow: true,
  matchedBlock: false,
};

const DISTRACTED_FOCUS: FocusSnapshot = {
  ts: 0,
  processName: "Discord",
  windowTitle: "#general — Discord",
  matchedAllow: false,
  matchedBlock: true,
  blockEntryId: "discord",
};

const LIVE_DESK: DeskSnapshot = {
  ts: 0,
  label: "at_desk",
  confidence: 0.94,
  webcamEnabled: true,
};

const AWAY_DESK: DeskSnapshot = {
  ts: 0,
  label: "away",
  confidence: 0.91,
  webcamEnabled: true,
};

type Listener<T> = (payload: T) => void;

function createBus<T>(): {
  on: (cb: Listener<T>) => () => void;
  emit: (payload: T) => void;
} {
  const listeners = new Set<Listener<T>>();
  return {
    on: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    emit: (payload) => {
      for (const cb of listeners) {
        cb(payload);
      }
    },
  };
}

const MOCK_SETTINGS_KEY = "focusplug.mock.settings";
const MOCK_POWER_KEY = "focusplug.mock.plugPower";

function readStored(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode — mock still works in-memory.
  }
}

function loadStoredSettings(): AppSettings {
  const raw = readStored(MOCK_SETTINGS_KEY);
  if (typeof raw !== "object" || raw === null) {
    return cloneSettings(DEFAULT_SETTINGS);
  }
  const record = raw as Record<string, unknown>;
  const plugsRaw = Array.isArray(record.plugs) ? record.plugs : [];
  const plugs: PlugDevice[] = [];
  for (const item of plugsRaw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const plug = item as Record<string, unknown>;
    if (typeof plug.id !== "string" || plug.id.length === 0) continue;
    if (typeof plug.name !== "string" || plug.name.length === 0) continue;
    if (plug.protocol !== "kasa" && plug.protocol !== "http" && plug.protocol !== "mock") continue;
    if (typeof plug.address !== "string" || plug.address.length === 0) continue;
    if (typeof plug.enabled !== "boolean") continue;
    if (plug.isStudyPc !== false) continue;
    plugs.push({
      id: plug.id,
      name: plug.name,
      protocol: plug.protocol,
      address: plug.address,
      enabled: plug.enabled,
      isStudyPc: false,
    });
  }
  return {
    countdownSec:
      typeof record.countdownSec === "number" && Number.isFinite(record.countdownSec)
        ? record.countdownSec
        : DEFAULT_SETTINGS.countdownSec,
    deskThreshold:
      typeof record.deskThreshold === "number" && Number.isFinite(record.deskThreshold)
        ? record.deskThreshold
        : DEFAULT_SETTINGS.deskThreshold,
    strictMode:
      typeof record.strictMode === "boolean" ? record.strictMode : DEFAULT_SETTINGS.strictMode,
    webcamEnabled:
      typeof record.webcamEnabled === "boolean"
        ? record.webcamEnabled
        : DEFAULT_SETTINGS.webcamEnabled,
    deskModelId: isDeskModelId(record.deskModelId) ? record.deskModelId : DEFAULT_SETTINGS.deskModelId,
    plugs,
  };
}

function loadStoredPower(): Map<string, boolean> {
  const raw = readStored(MOCK_POWER_KEY);
  const map = new Map<string, boolean>();
  if (typeof raw !== "object" || raw === null) {
    return map;
  }
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "boolean") {
      map.set(id, value);
    }
  }
  return map;
}

const SCENE_LAMP: PlugDevice = {
  id: "desk-lamp",
  name: "Desk lamp",
  protocol: "mock",
  address: "mock://lamp",
  enabled: true,
  isStudyPc: false,
};

export function createMockApi(): FocusPlugApi {
  const scene = readUrlScene();
  let settings: AppSettings = loadStoredSettings();
  let allowlist = cloneEntries(DEFAULT_ALLOWLIST);
  let blocklist = cloneEntries(DEFAULT_BLOCKLIST);
  if (scene.scene !== "default" && settings.plugs.length === 0) {
    settings = { ...settings, plugs: [SCENE_LAMP] };
  }
  let state: SessionState = buildInitialState(scene, settings);
  let log: SessionEvent[] = buildInitialLog(scene);
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  const lastPower = loadStoredPower();
  if (settings.plugs.some((plug) => plug.id === SCENE_LAMP.id) && !lastPower.has(SCENE_LAMP.id)) {
    lastPower.set(SCENE_LAMP.id, true);
  }

  const sessionBus = createBus<SessionState>();
  const policyBus = createBus<PolicyEvent>();
  const focusBus = createBus<FocusSnapshot>();
  const deskBus = createBus<DeskSnapshot>();
  const logBus = createBus<SessionEvent>();

  function lists(): AppLists {
    return {
      allowlist: cloneEntries(allowlist),
      blocklist: cloneEntries(blocklist),
    };
  }

  function persistSettings(): void {
    writeStored(MOCK_SETTINGS_KEY, cloneSettings(settings));
  }

  function persistPower(): void {
    writeStored(MOCK_POWER_KEY, Object.fromEntries(lastPower.entries()));
  }

  function enabledPlugIds(): string[] {
    return settings.plugs.filter((plug) => plug.enabled).map((plug) => plug.id);
  }

  function cutEnabledPlugs(reason: string): string[] {
    const deviceIds = enabledPlugIds();
    if (deviceIds.length === 0) {
      return [];
    }
    for (const id of deviceIds) {
      lastPower.set(id, false);
    }
    persistPower();
    policyBus.emit({ type: "plug_off", deviceIds, reason });
    appendLog("plug_off", `off · ${deviceIds.join(", ")}`);
    return deviceIds;
  }

  function publishState(next: SessionState): void {
    state = next;
    sessionBus.emit(state);
    if (state.focus) {
      focusBus.emit(state.focus);
    }
    if (state.desk) {
      deskBus.emit(state.desk);
    }
  }

  function patchState(partial: Partial<SessionState>): void {
    publishState({ ...state, ...partial });
  }

  function appendLog(kind: string, detail: string): void {
    const event: SessionEvent = { ts: now(), kind, detail };
    log = [event, ...log].slice(0, 400);
    logBus.emit(event);
  }

  function stopCountdownTick(): void {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function startCountdown(reason: string, seconds: number): void {
    stopCountdownTick();
    patchState({
      sessionActive: true,
      countdownSec: seconds,
      decision: "DISTRACTED",
      detail: reason,
      focus: { ...DISTRACTED_FOCUS, ts: now() },
      desk: { ...(state.desk ?? LIVE_DESK), ts: now() },
    });
    policyBus.emit({ type: "start_countdown", reason, seconds });
    appendLog("policy", `start_countdown · ${reason} · ${seconds}s`);
    if (scene.freeze) {
      return;
    }
    countdownTimer = setInterval(() => {
      const remaining = state.countdownSec - 1;
      if (remaining <= 0) {
        stopCountdownTick();
        patchState({
          countdownSec: 0,
          detail: "Kill window reached — Discord",
        });
        policyBus.emit({ type: "kill", targets: ["discord.exe"], reason });
        cutEnabledPlugs(reason);
        appendLog("kill", "Force-quit Discord (mock countdown elapsed)");
        return;
      }
      patchState({ countdownSec: remaining });
    }, 1000);
  }

  if (scene.countdown !== null) {
    startCountdown("Distracted: Discord", scene.countdown);
  }

  if (scene.scene !== "default" && settings.plugs.length > 0) {
    setTimeout(() => {
      policyBus.emit({
        type: "plug_on",
        deviceIds: settings.plugs.filter((plug) => plug.enabled).map((plug) => plug.id),
        reason: "scene inventory",
      });
    }, 20);
  }

  const api: FocusPlugApi = {
    sessionStart: async () => {
      stopCountdownTick();
      const ts = now();
      publishState({
        sessionActive: true,
        focus: { ...LIVE_FOCUS, ts },
        desk: { ...LIVE_DESK, ts, webcamEnabled: settings.webcamEnabled },
        decision: "ON_TASK",
        countdownSec: 0,
        detail: "Allowlisted focus · at desk",
      });
      appendLog("session", "Session started");
      policyBus.emit({ type: "status", decision: "ON_TASK", detail: state.detail });
      return state;
    },
    sessionStop: async () => {
      stopCountdownTick();
      publishState({
        ...DEFAULT_SESSION_STATE,
        focus: state.focus,
        desk: state.desk,
      });
      appendLog("session", "Session stopped — observe only");
      return state;
    },
    sessionGetState: async () => state,
    listsGet: async () => lists(),
    listsSetAllow: async (entries) => {
      allowlist = cloneEntries(entries);
      appendLog("lists", `Allowlist updated (${allowlist.length} apps)`);
      return lists();
    },
    listsSetBlock: async (entries) => {
      blocklist = cloneEntries(entries);
      appendLog("lists", `Blocklist updated (${blocklist.length} apps)`);
      return lists();
    },
    settingsGet: async () => cloneSettings(settings),
    settingsSet: async (patch) => {
      if (patch.deskModelId !== undefined && !isDeskModelId(patch.deskModelId)) {
        throw new Error("deskModelId must be stub, blazeface, or custom");
      }
      if (patch.plugs) {
        for (const plug of patch.plugs) {
          if (plug.isStudyPc !== false) {
            throw new Error("Study PC plugs are forbidden");
          }
        }
      }
      settings = {
        ...settings,
        ...patch,
        plugs: clonePlugs(patch.plugs ?? settings.plugs),
      };
      persistSettings();
      if (patch.webcamEnabled !== undefined && state.desk) {
        patchState({
          desk: { ...state.desk, webcamEnabled: patch.webcamEnabled, ts: now() },
        });
      }
      appendLog(
        "settings",
        patch.deskModelId
          ? `Settings saved · deskModelId=${patch.deskModelId}`
          : patch.plugs
            ? `Settings saved · ${patch.plugs.filter((plug) => plug.enabled).length} plugs armed`
            : "Settings saved",
      );
      return cloneSettings(settings);
    },
    logGet: async () => [...log],
    deskSetEnabled: async (enabled) => {
      settings = { ...settings, webcamEnabled: enabled };
      persistSettings();
      if (state.desk) {
        patchState({
          desk: { ...state.desk, webcamEnabled: enabled, ts: now() },
        });
      }
      appendLog("desk", enabled ? "Webcam enabled" : "Webcam disabled");
      return settings.webcamEnabled;
    },
    deskGetModelId: async () => settings.deskModelId,
    deskSetModelId: async (id: DeskModelId) => {
      if (!isDeskModelId(id)) {
        throw new Error("deskModelId must be stub, blazeface, or custom");
      }
      settings = { ...settings, deskModelId: id };
      persistSettings();
      appendLog("desk", `Desk model set to ${id}`);
      return settings.deskModelId;
    },
    plugsList: async () => clonePlugs(settings.plugs),
    plugsAdd: async (device) => {
      if (device.isStudyPc !== false) {
        throw new Error("Study PC plugs are forbidden");
      }
      if (settings.plugs.some((plug) => plug.id === device.id)) {
        throw new Error("Plug already exists");
      }
      const next: PlugDevice = { ...device, isStudyPc: false };
      settings = { ...settings, plugs: [...settings.plugs, next] };
      lastPower.set(next.id, true);
      persistSettings();
      persistPower();
      appendLog("plugs", `Added ${next.name} (${next.protocol})`);
      return clonePlugs(settings.plugs);
    },
    plugsRemove: async (deviceId) => {
      if (!settings.plugs.some((plug) => plug.id === deviceId)) {
        throw new Error("Plug not found");
      }
      settings = {
        ...settings,
        plugs: settings.plugs.filter((plug) => plug.id !== deviceId),
      };
      lastPower.delete(deviceId);
      persistSettings();
      persistPower();
      appendLog("plugs", `Removed ${deviceId}`);
      return clonePlugs(settings.plugs);
    },
    plugsTest: async (deviceId) => {
      const plug = settings.plugs.find((item) => item.id === deviceId);
      if (!plug) {
        throw new Error("Plug not found");
      }
      const powerOn = lastPower.get(deviceId) ?? true;
      return {
        ts: now(),
        deviceId,
        online: true,
        powerOn,
      };
    },
    demoKill: async () => {
      stopCountdownTick();
      const result: KillResult = {
        killed: ["discord.exe"],
        errors: [],
      };
      patchState({
        countdownSec: 0,
        detail: "Demo Kill — Discord force-quit",
      });
      policyBus.emit({ type: "kill", targets: result.killed, reason: "Demo Kill" });
      cutEnabledPlugs("demo");
      appendLog("kill", "Demo Kill · discord.exe");
      return result;
    },
    onSessionState: (cb) => sessionBus.on(cb),
    onPolicyEvent: (cb) => policyBus.on(cb),
    onFocusSnapshot: (cb) => focusBus.on(cb),
    onDeskSnapshot: (cb) => deskBus.on(cb),
    onSessionEvent: (cb) => logBus.on(cb),
  };

  return api;
}

function buildInitialState(
  scene: ReturnType<typeof readUrlScene>,
  settings: AppSettings,
): SessionState {
  const ts = now();
  if (scene.scene === "live") {
    return {
      sessionActive: true,
      focus: { ...LIVE_FOCUS, ts },
      desk: { ...LIVE_DESK, ts, webcamEnabled: settings.webcamEnabled },
      decision: "ON_TASK",
      countdownSec: 0,
      detail: "Allowlisted focus · at desk",
    };
  }
  if (scene.scene === "distracted") {
    return {
      sessionActive: true,
      focus: { ...DISTRACTED_FOCUS, ts },
      desk: { ...LIVE_DESK, ts, webcamEnabled: settings.webcamEnabled },
      decision: "DISTRACTED",
      countdownSec: scene.countdown ?? 10,
      detail: "Distracted: Discord",
    };
  }
  if (scene.scene === "away") {
    return {
      sessionActive: true,
      focus: { ...LIVE_FOCUS, ts },
      desk: { ...AWAY_DESK, ts, webcamEnabled: settings.webcamEnabled },
      decision: "AWAY",
      countdownSec: 0,
      detail: "Away · high-confidence desk absence",
    };
  }
  if (scene.scene === "recovered") {
    return {
      sessionActive: true,
      focus: { ...LIVE_FOCUS, ts },
      desk: { ...LIVE_DESK, ts, webcamEnabled: settings.webcamEnabled },
      decision: "ON_TASK",
      countdownSec: 0,
      detail: "Unlocked — allowlisted focus · at desk",
    };
  }
  if (scene.scene === "golden") {
    return {
      sessionActive: true,
      focus: { ...LIVE_FOCUS, ts },
      desk: { ...LIVE_DESK, ts, webcamEnabled: settings.webcamEnabled },
      decision: "ON_TASK",
      countdownSec: 0,
      detail: "On task: chrome.exe",
    };
  }
  return { ...DEFAULT_SESSION_STATE };
}

function buildInitialLog(scene: ReturnType<typeof readUrlScene>): SessionEvent[] {
  const ts = now();
  if (scene.scene === "live") {
    return [
      { ts, kind: "decision", detail: "ON_TASK · Allowlisted focus · at desk" },
      { ts: ts - 1200, kind: "desk", detail: "at_desk · 94%" },
      { ts: ts - 2400, kind: "focus", detail: "chrome — Essay draft — Google Docs" },
      { ts: ts - 4000, kind: "session", detail: "Session started" },
      { ts: ts - 6200, kind: "desk", detail: "webcam enabled" },
      { ts: ts - 9100, kind: "focus", detail: "chrome — docs.google.com" },
      { ts: ts - 15000, kind: "settings", detail: "Strict mode on · 10s countdown" },
    ];
  }
  if (scene.scene === "distracted") {
    return [
      { ts, kind: "policy", detail: "start_countdown · Distracted: Discord" },
      { ts: ts - 800, kind: "decision", detail: "DISTRACTED · Discord" },
      { ts: ts - 1600, kind: "focus", detail: "Discord — #general" },
      { ts: ts - 5000, kind: "session", detail: "Session started" },
    ];
  }
  if (scene.scene === "away") {
    return [
      { ts, kind: "decision", detail: "AWAY · high-confidence desk absence" },
      { ts: ts - 900, kind: "desk", detail: "away · 91%" },
      { ts: ts - 4000, kind: "decision", detail: "ON_TASK · Allowlisted focus · at desk" },
      { ts: ts - 5200, kind: "session", detail: "Session started" },
    ];
  }
  if (scene.scene === "recovered") {
    return [
      { ts, kind: "unlock", detail: "Unlocked — back on task" },
      { ts: ts - 400, kind: "plug_on", detail: "on · desk-lamp" },
      { ts: ts - 800, kind: "decision", detail: "ON_TASK · Allowlisted focus · at desk" },
      { ts: ts - 1400, kind: "kill", detail: "Distracted: Discord · discord.exe" },
      { ts: ts - 1600, kind: "plug_off", detail: "off · desk-lamp" },
      { ts: ts - 4200, kind: "countdown", detail: "start_countdown · Distracted: Discord · 10s" },
      { ts: ts - 5000, kind: "decision", detail: "DISTRACTED · Discord" },
      { ts: ts - 5600, kind: "focus", detail: "Discord — #general" },
      { ts: ts - 12000, kind: "decision", detail: "ON_TASK · Allowlisted focus · at desk" },
      { ts: ts - 13200, kind: "session", detail: "Session started" },
    ];
  }
  if (scene.scene === "golden") {
    return goldenSessionEvents(ts);
  }
  return [];
}

let mockSingleton: FocusPlugApi | null = null;

export function getMockApi(): FocusPlugApi {
  mockSingleton ??= createMockApi();
  return mockSingleton;
}
