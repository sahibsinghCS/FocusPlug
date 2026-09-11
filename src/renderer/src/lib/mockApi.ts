import {
  DEFAULT_ALLOWLIST,
  DEFAULT_BLOCKLIST,
  DEFAULT_SESSION_STATE,
  DEFAULT_SETTINGS,
} from "@shared/defaults";
import {
  PLUG_DRIVER_NOT_IMPLEMENTED,
  type AppEntry,
  type AppLists,
  type AppSettings,
  type DeskSnapshot,
  type FocusPlugApi,
  type FocusSnapshot,
  type KillResult,
  type PolicyEvent,
  type SessionEvent,
  type SessionState,
} from "@shared/ipc";
import { readUrlScene } from "./urlScene";

function cloneEntries(entries: AppEntry[]): AppEntry[] {
  return entries.map((entry) => ({
    ...entry,
    match: [...entry.match],
  }));
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

export function createMockApi(): FocusPlugApi {
  const scene = readUrlScene();
  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  let allowlist = cloneEntries(DEFAULT_ALLOWLIST);
  let blocklist = cloneEntries(DEFAULT_BLOCKLIST);
  let state: SessionState = buildInitialState(scene, settings);
  let log: SessionEvent[] = buildInitialLog(scene);
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

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
        policyBus.emit({
          type: "plug_off",
          deviceIds: ["console-lamp", "tv-outlet"],
          reason: reason,
        });
        appendLog("kill", "Force-quit Discord (mock countdown elapsed)");
        appendLog("plug_off", "off · console-lamp, tv-outlet");
        return;
      }
      patchState({ countdownSec: remaining });
    }, 1000);
  }

  if (scene.countdown !== null) {
    startCountdown("Distracted: Discord", scene.countdown);
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
    settingsGet: async () => ({
      ...settings,
      plugs: settings.plugs.map((plug) => ({ ...plug })),
    }),
    settingsSet: async (patch) => {
      settings = {
        ...settings,
        ...patch,
        plugs: (patch.plugs ?? settings.plugs).map((plug) => ({ ...plug })),
      };
      if (patch.webcamEnabled !== undefined && state.desk) {
        patchState({
          desk: { ...state.desk, webcamEnabled: patch.webcamEnabled, ts: now() },
        });
      }
      appendLog("settings", "Settings saved");
      return { ...settings };
    },
    logGet: async () => [...log],
    deskSetEnabled: async (enabled) => {
      settings = { ...settings, webcamEnabled: enabled };
      if (state.desk) {
        patchState({
          desk: { ...state.desk, webcamEnabled: enabled, ts: now() },
        });
      }
      appendLog("desk", enabled ? "Webcam enabled" : "Webcam disabled");
      return settings.webcamEnabled;
    },
    deskGetModelId: async () => settings.deskModelId,
    deskSetModelId: async (id) => {
      settings = { ...settings, deskModelId: id };
      appendLog("desk", `Desk model set to ${id}`);
      return settings.deskModelId;
    },
    plugsList: async () => settings.plugs.map((plug) => ({ ...plug })),
    plugsAdd: async (device) => {
      if (device.isStudyPc !== false) {
        throw new Error("Study PC plugs are forbidden");
      }
      if (settings.plugs.some((plug) => plug.id === device.id)) {
        throw new Error("Plug already exists");
      }
      settings = { ...settings, plugs: [...settings.plugs, { ...device, isStudyPc: false }] };
      appendLog("plugs", `Added ${device.name}`);
      return settings.plugs.map((plug) => ({ ...plug }));
    },
    plugsRemove: async (deviceId) => {
      if (!settings.plugs.some((plug) => plug.id === deviceId)) {
        throw new Error("Plug not found");
      }
      settings = {
        ...settings,
        plugs: settings.plugs.filter((plug) => plug.id !== deviceId),
      };
      appendLog("plugs", `Removed ${deviceId}`);
      return settings.plugs.map((plug) => ({ ...plug }));
    },
    plugsTest: async (deviceId) => {
      if (!settings.plugs.some((plug) => plug.id === deviceId)) {
        throw new Error("Plug not found");
      }
      return {
        ts: now(),
        deviceId,
        online: false,
        powerOn: null,
        error: PLUG_DRIVER_NOT_IMPLEMENTED,
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
      policyBus.emit({
        type: "plug_off",
        deviceIds: ["console-lamp", "tv-outlet"],
        reason: "demo",
      });
      appendLog("kill", "Demo Kill · discord.exe");
      appendLog("plug_off", "off · console-lamp, tv-outlet");
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
  return [];
}

let mockSingleton: FocusPlugApi | null = null;

export function getMockApi(): FocusPlugApi {
  mockSingleton ??= createMockApi();
  return mockSingleton;
}
