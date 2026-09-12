import { DEFAULT_SESSION_STATE } from "../../shared/defaults.ts";
import { isFaceId } from "../../shared/faces.ts";
import {
  PLUG_DRIVER_NOT_IMPLEMENTED,
  type AppLists,
  type AppSettings,
  type DeskMonitor,
  type KillResult,
  type PlugController,
  type PolicyEngine as PolicyEngineSeam,
  type ProcessKiller,
  type SessionState,
  type WindowMonitor,
} from "../../shared/ipc.ts";
import { enabledFunPlugIds, PolicyEngine, type PolicyEngineInput } from "../../shared/policy/index.ts";
import type {
  AppEntry,
  DeskModelId,
  DeskSnapshot,
  FocusSnapshot,
  PlugDevice,
  PlugSnapshot,
  PolicyEvent,
  SessionEvent,
} from "../../shared/types.ts";
import { assertControllable, createPlugController, SettingsPlugStore } from "../plugs/index.ts";
import {
  cloneSettings,
  isDeskModelId,
  normalizePlugDevice,
  normalizeSettings,
} from "../store/appStore.ts";
import { formatPlug, resolveSessionPlugIds } from "./plugActions.ts";
import type { SessionPush } from "./push.ts";
import { demoKillMatchers, enabledPlugIds, expandKillTargets } from "./targets.ts";

export const DEFAULT_SESSION_TICK_MS = 250;

/** JSON persistence used by the session loop. Returns are synchronous. */
export interface SessionStore {
  loadAllowlist(): AppEntry[];
  saveAllowlist(entries: AppEntry[]): void;
  loadBlocklist(): AppEntry[];
  saveBlocklist(entries: AppEntry[]): void;
  loadSettings(): AppSettings;
  saveSettings(settings: AppSettings): void;
  appendSessionLog(event: SessionEvent): void;
  loadSessionLog(): SessionEvent[];
}

export interface SessionControllerOptions {
  windowMonitor: WindowMonitor;
  deskMonitor: DeskMonitor;
  killer: ProcessKiller;
  /** Defaults to settings.plugs + Kasa/HTTP/mock hosts. */
  plugs?: PlugController;
  store: SessionStore;
  push: SessionPush;
  policyFactory?: () => PolicyEngineSeam;
  now?: () => number;
  /** Policy/countdown loop interval. `0` disables the timer (tests drive `flush`). */
  tickIntervalMs?: number;
}

function cloneState(state: SessionState): SessionState {
  return {
    sessionActive: state.sessionActive,
    focus: state.focus === null ? null : { ...state.focus },
    desk: state.desk === null ? null : { ...state.desk },
    decision: state.decision,
    countdownSec: state.countdownSec,
    detail: state.detail,
  };
}

function cloneEntries(entries: AppEntry[]): AppEntry[] {
  return entries.map((entry) => ({
    ...entry,
    match: [...entry.match],
  }));
}

function cloneDevices(devices: readonly PlugDevice[]): PlugDevice[] {
  return devices.map((device) => ({ ...device }));
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

function requireEntries(value: unknown, label: string): AppEntry[] {
  if (!Array.isArray(value) || !value.every(isAppEntry)) {
    throw new Error(`${label} must be an array of AppEntry objects`);
  }
  return cloneEntries(value);
}

function requirePatch(value: unknown): Partial<AppSettings> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("settings patch must be an object");
  }
  const record = value as Record<string, unknown>;
  const patch: Partial<AppSettings> = {};
  if ("countdownSec" in record) {
    if (typeof record.countdownSec !== "number" || !Number.isFinite(record.countdownSec)) {
      throw new Error("countdownSec must be a finite number");
    }
    patch.countdownSec = record.countdownSec;
  }
  if ("deskThreshold" in record) {
    if (typeof record.deskThreshold !== "number" || !Number.isFinite(record.deskThreshold)) {
      throw new Error("deskThreshold must be a finite number");
    }
    patch.deskThreshold = record.deskThreshold;
  }
  if ("strictMode" in record) {
    if (typeof record.strictMode !== "boolean") {
      throw new Error("strictMode must be a boolean");
    }
    patch.strictMode = record.strictMode;
  }
  if ("webcamEnabled" in record) {
    if (typeof record.webcamEnabled !== "boolean") {
      throw new Error("webcamEnabled must be a boolean");
    }
    patch.webcamEnabled = record.webcamEnabled;
  }
  if ("deskModelId" in record) {
    if (!isDeskModelId(record.deskModelId)) {
      throw new Error("deskModelId must be stub, blazeface, or custom");
    }
    patch.deskModelId = record.deskModelId;
  }
  if ("faceId" in record) {
    if (!isFaceId(record.faceId)) {
      throw new Error("faceId must be a known session face");
    }
    patch.faceId = record.faceId;
  }
  if ("plugs" in record) {
    if (!Array.isArray(record.plugs)) {
      throw new Error("plugs must be an array of PlugDevice objects");
    }
    patch.plugs = record.plugs.map((item, index) => requirePlugDevice(item, `plugs[${index}]`));
  }
  return patch;
}

function requirePlugDevice(value: unknown, label = "plug"): PlugDevice {
  const plug = normalizePlugDevice(value);
  if (plug === null) {
    throw new Error(
      `${label} must be a PlugDevice with isStudyPc=false (study PC plugs are forbidden)`,
    );
  }
  // Same hard-deny as PLUGS_ADD — the SETTINGS_SET route must never persist
  // a device the protect layer would refuse to command.
  assertControllable(plug);
  return plug;
}

function formatKill(reason: string, result: KillResult): string {
  const killed = result.killed.length > 0 ? result.killed.join(", ") : "nothing";
  const errors = result.errors.length > 0 ? `; errors: ${result.errors.join("; ")}` : "";
  return `${reason} · killed ${killed}${errors}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : String(error);
}

/**
 * Session orchestrator: monitors → PolicyEngine.step → countdown IPC →
 * ProcessKiller + PlugController → unlock. Injectable seams so the golden
 * path can be proven without Win32 or hardware plugs.
 */
export class SessionController {
  private readonly windowMonitor: WindowMonitor;
  private readonly deskMonitor: DeskMonitor;
  private readonly killer: ProcessKiller;
  private readonly plugs: PlugController;
  private readonly store: SessionStore;
  private readonly push: SessionPush;
  private readonly policyFactory: () => PolicyEngineSeam;
  private readonly now: () => number;
  private readonly tickIntervalMs: number;

  private policy: PolicyEngineSeam;
  private generation = 0;
  private sessionActive = false;
  private focus: FocusSnapshot | null = null;
  private desk: DeskSnapshot | null = null;
  private state: SessionState = cloneState(DEFAULT_SESSION_STATE);
  private countdownStartedAt: number | null = null;
  private countdownDurationSec = 0;
  private lastLoggedDecision: SessionState["decision"] | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: SessionControllerOptions) {
    this.windowMonitor = options.windowMonitor;
    this.deskMonitor = options.deskMonitor;
    this.killer = options.killer;
    this.store = options.store;
    this.plugs =
      options.plugs ??
      createPlugController({
        store: new SettingsPlugStore({
          loadSettings: () => this.loadSettings(),
          saveSettings: (settings) => this.store.saveSettings(settings),
        }),
        now: options.now,
      });
    this.push = options.push;
    this.policyFactory = options.policyFactory ?? (() => new PolicyEngine());
    this.now = options.now ?? Date.now;
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_SESSION_TICK_MS;
    this.policy = this.policyFactory();
    this.syncDeskEnabled(this.loadSettings().webcamEnabled);
  }

  async start(): Promise<SessionState> {
    if (this.sessionActive) {
      await this.stop();
    }
    const gen = ++this.generation;
    this.sessionActive = true;
    this.policy = this.policyFactory();
    this.clearFuse();
    this.lastLoggedDecision = null;
    // Drop the previous session's snapshots — buildPolicyInput re-stamps ts,
    // so stale focus/desk data would look current and could arm (or with a
    // 0s fuse, fire) enforcement before either monitor emits.
    this.focus = null;
    this.desk = null;
    this.state = {
      ...cloneState(DEFAULT_SESSION_STATE),
      sessionActive: true,
      focus: this.focus,
      desk: this.desk,
      decision: "IDLE",
      countdownSec: 0,
      detail: "Session started",
    };

    this.windowMonitor.start((snap) => {
      if (this.generation !== gen || !this.sessionActive) {
        return;
      }
      this.focus = snap;
      this.push.focusSnapshot({ ...snap });
      this.enqueueEvaluate();
    });
    this.deskMonitor.start((snap) => {
      if (this.generation !== gen || !this.sessionActive) {
        return;
      }
      this.desk = snap;
      this.push.deskSnapshot({ ...snap });
      this.enqueueEvaluate();
    });
    this.startTicker(gen);
    this.appendLog("session", "Session started");
    this.publishState();
    this.enqueueEvaluate();
    await this.flush();
    return cloneState(this.state);
  }

  async stop(): Promise<SessionState> {
    this.stopTicker();
    this.windowMonitor.stop();
    this.deskMonitor.stop();
    // Drain in-flight evaluation before flipping inactive so a mid-flight
    // kill finishes with its paired plug_off and logs before "Session stopped".
    await this.flush();
    this.generation += 1;
    this.sessionActive = false;
    this.clearFuse();

    const idleInput = this.buildPolicyInput(false);
    const events = this.policy.step(idleInput);
    for (const event of events) {
      this.push.policyEvent(event);
      if (event.type === "cancel_countdown") {
        this.appendLog("countdown", "cancel_countdown");
      }
      if (event.type === "status") {
        this.lastLoggedDecision = event.decision;
      }
    }
    this.policy = this.policyFactory();
    this.state = {
      ...cloneState(DEFAULT_SESSION_STATE),
      focus: this.focus,
      desk: this.desk,
    };
    this.appendLog("session", "Session stopped — observe only");
    this.publishState();
    await this.flush();
    return cloneState(this.state);
  }

  getState(): SessionState {
    return cloneState({
      ...this.state,
      countdownSec: this.remainingCountdown(),
      focus: this.focus,
      desk: this.desk,
      sessionActive: this.sessionActive,
    });
  }

  getLists(): AppLists {
    return {
      allowlist: cloneEntries(this.store.loadAllowlist()),
      blocklist: cloneEntries(this.store.loadBlocklist()),
    };
  }

  setAllowlist(entries: unknown): AppLists {
    this.store.saveAllowlist(requireEntries(entries, "allowlist"));
    const lists = this.getLists();
    this.appendLog("lists", `Allowlist updated (${lists.allowlist.length} apps)`);
    if (this.sessionActive) {
      this.enqueueEvaluate();
    }
    return lists;
  }

  setBlocklist(entries: unknown): AppLists {
    this.store.saveBlocklist(requireEntries(entries, "blocklist"));
    const lists = this.getLists();
    this.appendLog("lists", `Blocklist updated (${lists.blocklist.length} apps)`);
    if (this.sessionActive) {
      this.enqueueEvaluate();
    }
    return lists;
  }

  getSettings(): AppSettings {
    return cloneSettings(this.loadSettings());
  }

  setSettings(patch: unknown): AppSettings {
    const next = normalizeSettings({ ...this.loadSettings(), ...requirePatch(patch) });
    this.store.saveSettings(next);
    this.syncDeskEnabled(next.webcamEnabled);
    this.syncDeskModel(next.deskModelId);
    this.appendLog(
      "settings",
      `countdown=${next.countdownSec}s · strict=${next.strictMode} · deskThreshold=${next.deskThreshold} · webcam=${next.webcamEnabled} · deskModel=${next.deskModelId} · plugs=${next.plugs.length}`,
    );
    this.publishState();
    if (this.sessionActive) {
      this.enqueueEvaluate();
    }
    return cloneSettings(next);
  }

  getLog(): SessionEvent[] {
    return this.store.loadSessionLog();
  }

  setDeskEnabled(enabled: unknown): boolean {
    if (typeof enabled !== "boolean") {
      throw new Error("enabled must be a boolean");
    }
    const next = normalizeSettings({ ...this.loadSettings(), webcamEnabled: enabled });
    this.store.saveSettings(next);
    this.syncDeskEnabled(enabled);
    this.appendLog("desk", enabled ? "Webcam enabled" : "Webcam disabled");
    this.publishState();
    if (this.sessionActive) {
      this.enqueueEvaluate();
    }
    return next.webcamEnabled;
  }

  getDeskModelId(): DeskModelId {
    return this.loadSettings().deskModelId;
  }

  setDeskModelId(id: unknown): DeskModelId {
    if (!isDeskModelId(id)) {
      throw new Error("deskModelId must be stub, blazeface, or custom");
    }
    const next = normalizeSettings({ ...this.loadSettings(), deskModelId: id });
    this.store.saveSettings(next);
    this.syncDeskModel(next.deskModelId);
    this.appendLog("desk", `Desk model set to ${next.deskModelId}`);
    return next.deskModelId;
  }

  listPlugs(): PlugDevice[] {
    return cloneDevices(this.loadSettings().plugs);
  }

  addPlug(value: unknown): PlugDevice[] {
    const plug = requirePlugDevice(value);
    const current = this.loadSettings();
    if (current.plugs.some((existing) => existing.id === plug.id)) {
      throw new Error("Plug already exists");
    }
    const next = normalizeSettings({
      ...current,
      plugs: [...current.plugs, plug],
    });
    this.store.saveSettings(next);
    this.appendLog("plugs", `Added ${plug.name} (${plug.protocol})`);
    return next.plugs.map((item) => ({ ...item }));
  }

  removePlug(deviceId: unknown): PlugDevice[] {
    if (typeof deviceId !== "string" || deviceId.length === 0) {
      throw new Error("deviceId must be a non-empty string");
    }
    const current = this.loadSettings();
    if (!current.plugs.some((plug) => plug.id === deviceId)) {
      throw new Error("Plug not found");
    }
    const next = normalizeSettings({
      ...current,
      plugs: current.plugs.filter((plug) => plug.id !== deviceId),
    });
    this.store.saveSettings(next);
    this.appendLog("plugs", `Removed ${deviceId}`);
    return next.plugs.map((item) => ({ ...item }));
  }

  testPlug(deviceId: unknown): PlugSnapshot {
    if (typeof deviceId !== "string" || deviceId.length === 0) {
      throw new Error("deviceId must be a non-empty string");
    }
    const found = this.loadSettings().plugs.some((plug) => plug.id === deviceId);
    if (!found) {
      throw new Error("Plug not found");
    }
    return {
      ts: this.now(),
      deviceId,
      online: false,
      powerOn: null,
      error: PLUG_DRIVER_NOT_IMPLEMENTED,
    };
  }

  async demoKill(): Promise<KillResult> {
    this.clearFuse();
    // clearFuse only resets the displayed countdown — replace the engine too,
    // or a policy fuse armed before Demo Kill keeps burning invisibly and
    // fires a second kill + plug_off with no countdown on screen.
    this.policy = this.policyFactory();
    const matchers = demoKillMatchers(this.store.loadBlocklist(), this.focus);
    const event: PolicyEvent = {
      type: "kill",
      targets: matchers,
      reason: "demo",
    };
    this.push.policyEvent(event);
    const [result] = await Promise.all([
      this.runKill(matchers),
      this.cutEnabledPlugs("demo"),
    ]);
    this.appendLog("demo", formatKill("Demo Kill", result));
    this.state = {
      ...this.state,
      countdownSec: 0,
      detail:
        result.killed.length > 0
          ? `Demo Kill — ${result.killed.join(", ")}`
          : `Demo Kill — ${result.errors[0] ?? "no matching processes"}`,
    };
    this.publishState();
    return {
      killed: [...result.killed],
      errors: [...result.errors],
    };
  }

  /** Drain in-flight policy/kill work. Tests use this after injecting snapshots. */
  async flush(): Promise<void> {
    await this.queue;
  }

  /** Advance the policy loop using the injected clock (tests / stalled monitors). */
  async tick(): Promise<void> {
    this.enqueueEvaluate();
    await this.flush();
  }

  private enqueueEvaluate(): void {
    this.queue = this.queue.then(
      () => this.evaluateOnce(),
      () => this.evaluateOnce(),
    );
  }

  private async evaluateOnce(): Promise<void> {
    if (!this.sessionActive) {
      return;
    }
    const gen = this.generation;
    const settings = this.loadSettings();
    // The engine checks fuse expiry against the live countdownSec, so a
    // mid-fuse settings change must retime the displayed countdown to match.
    if (this.countdownStartedAt !== null) {
      this.countdownDurationSec = settings.countdownSec;
    }
    const input = this.buildPolicyInput(true, settings);
    const events = this.policy.step(input);
    if (this.generation !== gen || !this.sessionActive) {
      return;
    }
    for (const event of events) {
      this.push.policyEvent(event);
      await this.applyPolicyEvent(event);
      if (this.generation !== gen || !this.sessionActive) {
        return;
      }
    }
    this.state = {
      sessionActive: true,
      focus: this.focus,
      desk: this.desk,
      decision: this.state.decision,
      countdownSec: this.remainingCountdown(),
      detail: this.state.detail,
    };
    this.publishState();
  }

  private async applyPolicyEvent(event: PolicyEvent): Promise<void> {
    switch (event.type) {
      case "start_countdown":
        this.countdownStartedAt = this.now();
        this.countdownDurationSec = event.seconds;
        this.appendLog(
          "countdown",
          `start_countdown · ${event.reason} · ${event.seconds}s`,
        );
        return;
      case "cancel_countdown":
        this.clearFuse();
        this.appendLog("countdown", "cancel_countdown");
        return;
      case "kill": {
        this.clearFuse();
        const matchers = expandKillTargets(event.targets, this.store.loadBlocklist());
        const result = await this.runKill(matchers);
        this.appendLog("kill", formatKill(event.reason, result));
        return;
      }
      case "unlock":
        this.appendLog("unlock", "Unlocked — back on task");
        return;
      case "plug_off":
        await this.applyPlugCommand("off", event.deviceIds, event.reason, {
          emitEvent: false,
        });
        return;
      case "plug_on":
        await this.applyPlugCommand("on", event.deviceIds, event.reason, {
          emitEvent: false,
        });
        return;
      case "status":
        this.state = {
          ...this.state,
          decision: event.decision,
          detail: event.detail,
        };
        if (this.lastLoggedDecision !== event.decision) {
          this.lastLoggedDecision = event.decision;
          this.appendLog("decision", `${event.decision} · ${event.detail}`);
        }
        return;
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
        return;
      }
    }
  }

  private async runKill(matchers: string[]): Promise<KillResult> {
    try {
      const result = await Promise.resolve(this.killer.kill(matchers));
      return {
        killed: [...result.killed],
        errors: [...result.errors],
      };
    } catch (error) {
      return { killed: [], errors: [errorMessage(error)] };
    }
  }

  private loadPlugDevices(): PlugDevice[] {
    return cloneDevices(this.loadSettings().plugs);
  }

  private sessionPlugIds(requested?: readonly string[]): string[] {
    return resolveSessionPlugIds(this.loadPlugDevices(), requested);
  }

  /** Demo Kill and other session-owned paths — policy does not emit these. */
  private async cutEnabledPlugs(reason: string): Promise<PlugSnapshot[]> {
    return this.applyPlugCommand("off", enabledPlugIds(this.loadPlugDevices()), reason);
  }

  private async applyPlugCommand(
    action: "off" | "on",
    requested: readonly string[],
    reason: string,
    options?: { emitEvent?: boolean },
  ): Promise<PlugSnapshot[]> {
    const deviceIds = this.sessionPlugIds(requested);
    const snapshots = await this.runPlugs(action, deviceIds);
    if (options?.emitEvent !== false) {
      const event: PolicyEvent =
        action === "off"
          ? { type: "plug_off", deviceIds: [...deviceIds], reason }
          : { type: "plug_on", deviceIds: [...deviceIds], reason };
      this.push.policyEvent(event);
    }
    this.appendLog(action === "off" ? "plug_off" : "plug_on", formatPlug(action, snapshots));
    return snapshots;
  }

  private async runPlugs(action: "off" | "on", ids: string[]): Promise<PlugSnapshot[]> {
    try {
      const snapshots =
        action === "off"
          ? await Promise.resolve(this.plugs.off(ids))
          : await Promise.resolve(this.plugs.on(ids));
      return snapshots.map((snap) => ({ ...snap }));
    } catch (error) {
      return ids.map((deviceId) => ({
        ts: this.now(),
        deviceId,
        online: false,
        powerOn: null,
        error: errorMessage(error),
      }));
    }
  }

  private buildPolicyInput(sessionActive: boolean, settings?: AppSettings): PolicyEngineInput {
    const resolved = settings ?? this.loadSettings();
    const ts = this.now();
    const focus =
      this.focus === null ? null : { ...this.focus, ts: Math.max(this.focus.ts, ts) };
    const desk = this.desk === null ? null : { ...this.desk, ts: Math.max(this.desk.ts, ts) };
    const funPlugIds = enabledFunPlugIds(resolved.plugs);
    return {
      sessionActive,
      focus,
      desk,
      countdownSec: resolved.countdownSec,
      deskThreshold: resolved.deskThreshold,
      strictMode: resolved.strictMode,
      enabledPlugIds: funPlugIds,
      plugsArmed: funPlugIds.length > 0,
      plugs: resolved.plugs,
    };
  }

  private remainingCountdown(): number {
    if (this.countdownStartedAt === null) {
      return 0;
    }
    const remainingMs =
      this.countdownStartedAt + this.countdownDurationSec * 1000 - this.now();
    if (remainingMs <= 0) {
      return 0;
    }
    return Math.max(1, Math.ceil(remainingMs / 1000));
  }

  private clearFuse(): void {
    this.countdownStartedAt = null;
    this.countdownDurationSec = 0;
  }

  private startTicker(gen: number): void {
    this.stopTicker();
    if (this.tickIntervalMs <= 0) {
      return;
    }
    this.timer = setInterval(() => {
      if (this.generation !== gen || !this.sessionActive) {
        return;
      }
      this.enqueueEvaluate();
    }, this.tickIntervalMs);
  }

  private stopTicker(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private loadSettings(): AppSettings {
    return cloneSettings(normalizeSettings(this.store.loadSettings()));
  }

  private syncDeskModel(id: DeskModelId): void {
    const monitor = this.deskMonitor as DeskMonitor & {
      setModelId?: (next: DeskModelId) => void;
    };
    monitor.setModelId?.(id);
  }

  private syncDeskEnabled(enabled: boolean): void {
    this.deskMonitor.setEnabled(enabled);
    if (this.desk !== null) {
      this.desk = { ...this.desk, webcamEnabled: enabled, ts: this.now() };
      this.state = { ...this.state, desk: this.desk };
      this.push.deskSnapshot({ ...this.desk });
    }
  }

  private publishState(): void {
    const next = cloneState({
      ...this.state,
      sessionActive: this.sessionActive,
      focus: this.focus,
      desk: this.desk,
      countdownSec: this.sessionActive ? this.remainingCountdown() : 0,
    });
    this.state = next;
    this.push.sessionState(cloneState(next));
  }

  private appendLog(kind: string, detail: string): void {
    const event: SessionEvent = { ts: this.now(), kind, detail };
    try {
      this.store.appendSessionLog(event);
    } catch (error) {
      console.error("Failed to persist session log:", errorMessage(error));
    }
    this.push.sessionEvent({ ...event });
  }
}

export function createSessionController(options: SessionControllerOptions): SessionController {
  return new SessionController(options);
}
