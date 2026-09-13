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
  type FocusPlanState,
  type FocusSnapshot,
  type ForecastEvent,
  type ForecastSnapshot,
  type KillResult,
  type PlanRound,
  type PlugDevice,
  type PolicyEvent,
  type SessionEvent,
  type SessionState,
} from "@shared/ipc";
import { isFaceId } from "@shared/faces";
import { ledgerFromSessionLog } from "@shared/plan";
import { isFlightIata, normalizeFlightPair } from "@shared/flightRoute";
import { isDeskModelId } from "./plugsUi";
import { isPlugMode, type NudgeEvent, type NudgeKind } from "@shared/nudge";
import { readUrlScene } from "./urlScene";
import { describeForecastEvent } from "../features/forecast/model";
import {
  buildForecastReplay,
  type ForecastReplay,
  type ReplayFrame,
} from "../features/forecast/replay";
import { goldenSessionEvents } from "../features/logs/fixtures";
import { planSceneState, readPlanScene } from "../features/focusplan/scenes";

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
    faceId: isFaceId(record.faceId) ? record.faceId : DEFAULT_SETTINGS.faceId,
    ...normalizeFlightPair(record.flightDep, record.flightArr),
    plugMode: isPlugMode(record.plugMode) ? record.plugMode : DEFAULT_SETTINGS.plugMode,
    forecastEnabled:
      typeof record.forecastEnabled === "boolean"
        ? record.forecastEnabled
        : DEFAULT_SETTINGS.forecastEnabled,
    forecastPrearmEnabled:
      typeof record.forecastPrearmEnabled === "boolean"
        ? record.forecastPrearmEnabled
        : DEFAULT_SETTINGS.forecastPrearmEnabled,
    forecastNudgeRisk:
      typeof record.forecastNudgeRisk === "number" && Number.isFinite(record.forecastNudgeRisk)
        ? record.forecastNudgeRisk
        : DEFAULT_SETTINGS.forecastNudgeRisk,
    forecastPrearmRisk:
      typeof record.forecastPrearmRisk === "number" && Number.isFinite(record.forecastPrearmRisk)
        ? record.forecastPrearmRisk
        : DEFAULT_SETTINGS.forecastPrearmRisk,
    forecastPrearmFuseSec:
      typeof record.forecastPrearmFuseSec === "number" &&
      Number.isFinite(record.forecastPrearmFuseSec)
        ? record.forecastPrearmFuseSec
        : DEFAULT_SETTINGS.forecastPrearmFuseSec,
    focusPlanEnabled:
      typeof record.focusPlanEnabled === "boolean"
        ? record.focusPlanEnabled
        : DEFAULT_SETTINGS.focusPlanEnabled,
    focusPlanStretchEnabled:
      typeof record.focusPlanStretchEnabled === "boolean"
        ? record.focusPlanStretchEnabled
        : DEFAULT_SETTINGS.focusPlanStretchEnabled,
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
  const nudgeBus = createBus<NudgeEvent>();

  // Preview hook: run `__focusplugNudge("phone")` in the console to see a nudge without Electron.
  if (typeof window !== "undefined") {
    (window as unknown as { __focusplugNudge?: (kind: NudgeKind, app?: string) => void }).__focusplugNudge =
      (kind, app) => nudgeBus.emit({ ts: now(), kind, ...(app ? { app } : {}) });
  }

  const forecastBus = createBus<ForecastSnapshot>();
  const forecastEventBus = createBus<ForecastEvent>();
  const planRoundBus = createBus<PlanRound>();

  /**
   * Focus Plan's ledger, seeded two honest ways and never a third: a named
   * fixture for the `?scene=plan-*` / `?scene=debrief-*` screens, and
   * otherwise `ledgerFromSessionLog` over this mock's own log — the same pure
   * reducer the app ships, so the preview reads a real data path rather than a
   * hand-typed number. No scene at all is the fresh install, which is exactly
   * the state the cold-start card has to survive.
   */
  const planScene = readPlanScene(window.location.search, window.location.hash);
  let planCleared = false;

  function planState(): FocusPlanState {
    const seeded = planSceneState(planScene, now());
    if (seeded !== null) {
      return seeded;
    }
    const rebuilt = planCleared
      ? { rounds: [], lifetimeRounds: 0 }
      : ledgerFromSessionLog(log);
    return {
      v: 1,
      enabled: settings.focusPlanEnabled,
      rounds: rebuilt.rounds,
      lifetimeRounds: rebuilt.lifetimeRounds,
    };
  }

  // The forecast side of the mock is the deterministic scripted replay —
  // the same shared core (ring → features → GLM → escalation) the main
  // process runs, so browser dev/stills show real attributions and a real
  // receipt, not canned numbers. The replay drives the whole live-session
  // story: calm → flicking → nudge → pre-arm → Discord → 5 s fuse → kill.
  let forecastSnap: ForecastSnapshot | null = null;
  let forecastTimer: ReturnType<typeof setInterval> | null = null;
  let replay: ForecastReplay | null = null;
  let replayIndex = 0;
  let prevFrame: ReplayFrame | null = null;

  function readForecastFrame(): number | null {
    const hash = window.location.hash;
    const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const raw =
      new URLSearchParams(window.location.search).get("fct") ??
      new URLSearchParams(hashQuery).get("fct");
    if (!raw) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function applyReplayFrame(frame: ReplayFrame, silent = false): void {
    const prev = prevFrame;
    prevFrame = frame;
    if (silent) {
      // Frozen scenes stay visually static: fill the forecast panel (snapshot
      // history + events) without touching session state or the log.
      for (const event of frame.events) {
        forecastEventBus.emit(event);
      }
      forecastSnap = frame.snapshot;
      forecastBus.emit(frame.snapshot);
      return;
    }
    patchState({
      sessionActive: true,
      focus: frame.focus,
      desk: frame.desk,
      decision: frame.decision,
      countdownSec: frame.countdownSec,
      detail: frame.detail,
    });
    if (prev && frame.decision !== prev.decision) {
      appendLog("decision", `${frame.decision} · ${frame.detail}`);
    }
    if ((prev?.countdownSec ?? 0) === 0 && frame.countdownSec > 0) {
      policyBus.emit({
        type: "start_countdown",
        reason: frame.detail,
        seconds: frame.countdownSec,
      });
      appendLog("policy", `start_countdown · ${frame.detail} · ${frame.countdownSec}s`);
    }
    if ((prev?.countdownSec ?? 0) > 0 && frame.countdownSec === 0) {
      policyBus.emit({ type: "kill", targets: ["discord.exe"], reason: "Distracted: Discord" });
      cutEnabledPlugs("Distracted: Discord");
      appendLog("kill", "Force-quit Discord (mock fuse elapsed)");
    }
    if (prev && prev.decision === "DISTRACTED" && frame.decision === "ON_TASK") {
      policyBus.emit({ type: "unlock" });
      appendLog("unlock", "Unlocked — back on task");
    }
    for (const event of frame.events) {
      forecastEventBus.emit(event);
      appendLog("forecast", describeForecastEvent(event));
    }
    forecastSnap = frame.snapshot;
    forecastBus.emit(frame.snapshot);
  }

  function stepForecast(silent = false): void {
    if (!replay) {
      return;
    }
    const frame = replay.frames[replayIndex];
    if (!frame) {
      // Script over — hold the final calm state.
      if (forecastTimer !== null) {
        clearInterval(forecastTimer);
        forecastTimer = null;
      }
      return;
    }
    replayIndex += 1;
    applyReplayFrame(frame, silent);
  }

  function stopForecastTick(): void {
    if (forecastTimer !== null) {
      clearInterval(forecastTimer);
      forecastTimer = null;
    }
    replay = null;
    replayIndex = 0;
    prevFrame = null;
    forecastSnap = null;
  }

  function startForecastTick(): void {
    stopForecastTick();
    if (!settings.forecastEnabled || !state.sessionActive) {
      return;
    }
    if (scene.countdown !== null || (scene.scene !== "default" && scene.scene !== "live")) {
      // URL countdown / distracted / away / golden scenes own their session
      // state and fixture logs — no replay on top of them.
      return;
    }
    replay = buildForecastReplay(now());
    if (scene.freeze) {
      // Fast-forward the forecast (only) to the requested frame (?fct=<sec>)
      // and hold — the scene's session state stays exactly as scripted.
      const target = Math.min(readForecastFrame() ?? 40, replay.frames.length - 1);
      forecastTimer = setInterval(() => {
        if (replayIndex > target) {
          if (forecastTimer !== null) {
            clearInterval(forecastTimer);
            forecastTimer = null;
          }
          return;
        }
        stepForecast(true);
      }, 25);
      return;
    }
    stepForecast();
    forecastTimer = setInterval(stepForecast, 1000);
  }

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
      planCleared = false;
      policyBus.emit({ type: "status", decision: "ON_TASK", detail: state.detail });
      startForecastTick();
      return state;
    },
    sessionStop: async () => {
      stopCountdownTick();
      stopForecastTick();
      publishState({
        ...DEFAULT_SESSION_STATE,
        focus: state.focus,
        desk: state.desk,
      });
      appendLog("session", "Session stopped — observe only");
      // The round that just closed, through the shipped log reducer — so the
      // preview's debrief appears on the same push the app uses.
      const closed = planState().rounds.at(-1);
      if (closed) {
        planRoundBus.emit(closed);
      }
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
      if (patch.faceId !== undefined && !isFaceId(patch.faceId)) {
        throw new Error("faceId must be a known session face");
      }
      if (patch.flightDep !== undefined && !isFlightIata(patch.flightDep)) {
        throw new Error("flightDep must be a curated IATA code");
      }
      if (patch.flightArr !== undefined && !isFlightIata(patch.flightArr)) {
        throw new Error("flightArr must be a curated IATA code");
      }
      if (patch.plugs) {
        for (const plug of patch.plugs) {
          if (plug.isStudyPc !== false) {
            throw new Error("Study PC plugs are forbidden");
          }
        }
      }
      const forecastWasEnabled = settings.forecastEnabled;
      settings = {
        ...settings,
        ...patch,
        plugs: clonePlugs(patch.plugs ?? settings.plugs),
        ...normalizeFlightPair(
          patch.flightDep ?? settings.flightDep,
          patch.flightArr ?? settings.flightArr,
        ),
      };
      persistSettings();
      if (settings.forecastEnabled !== forecastWasEnabled) {
        if (settings.forecastEnabled) {
          startForecastTick();
        } else {
          stopForecastTick();
        }
      }
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
    demoNudge: async (kind) => {
      appendLog("demo", `Test nudge · ${kind}`);
      nudgeBus.emit({ ts: now(), kind });
    },
    forecastGetState: async () => forecastSnap,
    planGetState: async () => planState(),
    planReset: async () => {
      const cleared = planState().rounds.length;
      planCleared = true;
      appendLog("plan", `history cleared (${cleared} ${cleared === 1 ? "round" : "rounds"})`);
      return planState();
    },
    onSessionState: (cb) => sessionBus.on(cb),
    onPolicyEvent: (cb) => policyBus.on(cb),
    onFocusSnapshot: (cb) => focusBus.on(cb),
    onDeskSnapshot: (cb) => deskBus.on(cb),
    onSessionEvent: (cb) => logBus.on(cb),
    onNudge: (cb) => nudgeBus.on(cb),
    onForecastSnapshot: (cb) => forecastBus.on(cb),
    onForecastEvent: (cb) => forecastEventBus.on(cb),
    onPlanRound: (cb) => planRoundBus.on(cb),
  };

  if (state.sessionActive) {
    startForecastTick();
  }

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
