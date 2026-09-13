import { DEFAULT_SESSION_STATE } from "../../shared/defaults.ts";
import { isFaceId } from "../../shared/faces.ts";
import { isFlightIata } from "../../shared/flightRoute.ts";
import type { ForecastHook } from "../../shared/forecast/index.ts";
import { isNudgeKind, isPlugMode, type NudgeEvent, type NudgeKind } from "../../shared/nudge.ts";
import { REASONS } from "../../shared/policy/constants.ts";
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
import {
  enabledFunPlugIds,
  plugEventFor,
  PolicyEngine,
  type PolicyEngineInput,
} from "../../shared/policy/index.ts";
import { AdaptiveFuse } from "./adaptiveFuse.ts";
import { composeFuse } from "./fuseAuthority.ts";
import { NudgeTracker } from "./nudge.ts";
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
  /** Optional: stores that cannot persist the adaptive model just relearn. */
  loadAdaptiveModel?(): unknown;
  saveAdaptiveModel?(value: unknown): void;
  /**
   * Optional: stores that cannot persist the Focus Plan ledger just forget it.
   * The controller never calls these — `PlanRecorder` does, over the same
   * store instance — but they belong on the seam the runtime already shares,
   * exactly as the adaptive-model pair does.
   */
  loadPlanLedger?(): unknown;
  savePlanLedger?(value: unknown): void;
}

export interface SessionControllerOptions {
  windowMonitor: WindowMonitor;
  /** Injectable so the adaptive fuse's exploration is deterministic in tests. */
  adaptiveRandom?: () => number;
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
  /**
   * Focus Forecast advisory seam. Called once per evaluateOnce on the
   * active-session path; a non-null return is the pre-arm signal, which
   * SCALES the adaptive fuse toward the floor (see `fuseAuthority.ts`) and
   * touches nothing else. Absent ⇒ the adaptive fuse alone, as on `main`.
   */
  forecast?: ForecastHook;
  /** Bring the app window to the front for a nudge. Absent in tests and headless runs. */
  revealWindow?: () => void;
}

/** One evaluate's answer from the fuse authority — see `resolveFuse`. */
interface ResolvedFuse {
  /** The composed countdown handed to the policy engine, in seconds. */
  seconds: number;
  /** AdaptiveFuse's personalised length before the pre-arm scaled it. */
  personalSec: number;
  /** True when the Focus Forecast had pre-armed as this fuse was resolved. */
  prearmed: boolean;
  /** True when a model, not the raw Settings value, chose `seconds`. */
  modelChosen: boolean;
}

/** The fuse when nothing has an opinion: the Settings value, unmodelled. */
function settingsFuse(seconds: number): ResolvedFuse {
  return { seconds, personalSec: seconds, prearmed: false, modelChosen: false };
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
  if ("flightDep" in record) {
    if (!isFlightIata(record.flightDep)) {
      throw new Error("flightDep must be a curated IATA code");
    }
    patch.flightDep = record.flightDep.trim().toUpperCase();
  }
  if ("flightArr" in record) {
    if (!isFlightIata(record.flightArr)) {
      throw new Error("flightArr must be a curated IATA code");
    }
    patch.flightArr = record.flightArr.trim().toUpperCase();
  }
  if ("plugMode" in record) {
    if (!isPlugMode(record.plugMode)) {
      throw new Error("plugMode must be nudge or cut");
    }
    patch.plugMode = record.plugMode;
  }
  if ("plugs" in record) {
    if (!Array.isArray(record.plugs)) {
      throw new Error("plugs must be an array of PlugDevice objects");
    }
    patch.plugs = record.plugs.map((item, index) => requirePlugDevice(item, `plugs[${index}]`));
  }
  if ("forecastEnabled" in record) {
    if (typeof record.forecastEnabled !== "boolean") {
      throw new Error("forecastEnabled must be a boolean");
    }
    patch.forecastEnabled = record.forecastEnabled;
  }
  if ("forecastPrearmEnabled" in record) {
    if (typeof record.forecastPrearmEnabled !== "boolean") {
      throw new Error("forecastPrearmEnabled must be a boolean");
    }
    patch.forecastPrearmEnabled = record.forecastPrearmEnabled;
  }
  if ("forecastNudgeRisk" in record) {
    if (typeof record.forecastNudgeRisk !== "number" || !Number.isFinite(record.forecastNudgeRisk)) {
      throw new Error("forecastNudgeRisk must be a finite number");
    }
    patch.forecastNudgeRisk = record.forecastNudgeRisk;
  }
  if ("forecastPrearmRisk" in record) {
    if (
      typeof record.forecastPrearmRisk !== "number" ||
      !Number.isFinite(record.forecastPrearmRisk)
    ) {
      throw new Error("forecastPrearmRisk must be a finite number");
    }
    patch.forecastPrearmRisk = record.forecastPrearmRisk;
  }
  if ("forecastPrearmFuseSec" in record) {
    if (
      typeof record.forecastPrearmFuseSec !== "number" ||
      !Number.isFinite(record.forecastPrearmFuseSec)
    ) {
      throw new Error("forecastPrearmFuseSec must be a finite number");
    }
    patch.forecastPrearmFuseSec = record.forecastPrearmFuseSec;
  }
  if ("focusPlanEnabled" in record) {
    if (typeof record.focusPlanEnabled !== "boolean") {
      throw new Error("focusPlanEnabled must be a boolean");
    }
    patch.focusPlanEnabled = record.focusPlanEnabled;
  }
  if ("focusPlanStretchEnabled" in record) {
    if (typeof record.focusPlanStretchEnabled !== "boolean") {
      throw new Error("focusPlanStretchEnabled must be a boolean");
    }
    patch.focusPlanStretchEnabled = record.focusPlanStretchEnabled;
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
  private readonly forecast: ForecastHook | null;
  private readonly revealWindow: (() => void) | undefined;
  private readonly nudges = new NudgeTracker();

  private policy: PolicyEngineSeam;
  private generation = 0;
  private sessionActive = false;
  private focus: FocusSnapshot | null = null;
  private desk: DeskSnapshot | null = null;
  private state: SessionState = cloneState(DEFAULT_SESSION_STATE);
  private countdownStartedAt: number | null = null;
  private countdownDurationSec = 0;
  private lastLoggedDecision: SessionState["decision"] | null = null;
  /** Demo Kill cut plugs / dropped the engine lock — restore on next on-task. */
  private demoPlugsCut = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly adaptive: AdaptiveFuse;
  /** The composed fuse this evaluate resolved — consumed when a countdown arms. */
  private lastFuse: ResolvedFuse = settingsFuse(0);
  /** Non-null exactly while a countdown burns. THE LATCH — see `resolveFuse`. */
  private fuseLatch: ResolvedFuse | null = null;

  constructor(options: SessionControllerOptions) {
    this.windowMonitor = options.windowMonitor;
    this.deskMonitor = options.deskMonitor;
    this.killer = options.killer;
    this.revealWindow = options.revealWindow;
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
    this.forecast = options.forecast ?? null;
    this.adaptive = new AdaptiveFuse({
      store: options.store,
      random: options.adaptiveRandom,
    });
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
    this.adaptive.startSession(this.now());
    this.clearFuse();
    this.lastLoggedDecision = null;
    this.demoPlugsCut = false;
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
      this.adaptive.noteFocus(snap);
      this.push.focusSnapshot({ ...snap });
      this.enqueueEvaluate();
    });
    this.deskMonitor.start((snap) => {
      if (this.generation !== gen || !this.sessionActive) {
        return;
      }
      this.desk = snap;
      this.push.deskSnapshot({ ...snap });
      const drift = this.nudges.observeDesk(snap, this.loadSettings().deskThreshold, this.now());
      if (drift !== null) {
        void this.nudge(drift);
      }
      this.enqueueEvaluate();
    });
    this.nudges.reset();
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
    this.demoPlugsCut = false;
    // Stopping mid-countdown is not the user recovering — discard, never learn.
    this.adaptive.stopSession();
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
    // The replaced engine may have been `locked`, and the demo cut below is a
    // session-owned path the fresh engine knows nothing about — remember to
    // restore on the next on-task return or the plugs stay stranded OFF.
    this.demoPlugsCut = this.sessionActive;
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
    const fuse = this.resolveFuse(settings);
    this.lastFuse = fuse;
    // The engine checks fuse expiry against the live countdownSec, so the
    // displayed countdown must be retimed to whatever the authority says —
    // which, while a fuse burns, is the latched value.
    if (this.countdownStartedAt !== null) {
      this.countdownDurationSec = fuse.seconds;
    }
    const input = this.buildPolicyInput(true, settings, fuse.seconds);
    const events = this.withDemoRecovery(this.policy.step(input), input);
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

  /**
   * THE ONE FUSE AUTHORITY — the single place `countdownSec` is decided.
   *
   * AdaptiveFuse answers "how long does this person need?" and the Focus
   * Forecast answers "is a drift coming?". They compose rather than compete:
   * the adaptive fuse sets a personalised base length and a pre-arm scales it
   * toward the floor (`fuseAuthority.ts`), so a slow recoverer still gets more
   * time than a fast one under pre-arm.
   *
   * Two invariants live here, and both are about enforcement, not accuracy:
   *
   * 1. THE LATCH. Once a countdown is burning, neither model may change its
   *    length. Both are still *ticked* every evaluate — the adaptive fuse
   *    tracks the moment and `beforeStep` is where the forecast closes its
   *    1 Hz frames, so skipping the calls would silently stop the observer —
   *    but their answers are discarded in favour of the latched value. A
   *    settings change still retimes a plain Settings fuse (today's
   *    behaviour); it cannot stretch one a model chose.
   *
   * 2. NEVER THROW. The whole composed computation sits inside this try. It
   *    is the one place two learned models reach the deterministic kill path:
   *    if either threw, `evaluateOnce` would die before `policy.step` and
   *    enforcement would stop entirely — no status, no countdown, no kill.
   *    Swallowing here makes "exceptions never propagate" a property of the
   *    enforcement core rather than of the current implementations.
   */
  private resolveFuse(settings: AppSettings): ResolvedFuse {
    const latch = this.fuseLatch;
    const fallback: ResolvedFuse =
      latch !== null && latch.modelChosen ? { ...latch } : settingsFuse(settings.countdownSec);
    try {
      const ts = this.now();
      const personalSec = this.adaptive.fuseFor(
        { focus: this.focus, desk: this.desk },
        settings.countdownSec,
        ts,
      );
      // The hook's number is the forecast's own view of the fuse; all this
      // authority takes from it is the pre-arm STATE. A non-null return while
      // a countdown burns is the forecast's own latch, which the controller's
      // latch below already outranks.
      const prearmed = (this.forecast?.beforeStep(ts, personalSec) ?? null) !== null;
      if (latch !== null) {
        return fallback;
      }
      return {
        seconds: composeFuse({ personalSec, prearmed }),
        personalSec,
        prearmed,
        // A model owns this fuse when the forecast shortened it or the
        // adaptive fuse moved it off the Settings value. Only those are
        // frozen mid-burn; a plain Settings fuse still follows Settings.
        modelChosen: prearmed || personalSec !== settings.countdownSec,
      };
    } catch {
      return fallback;
    }
  }

  /**
   * Demo Kill cuts plugs on a session-owned path and replaces the policy
   * engine, discarding any `locked` state — the fresh engine sees an on-task
   * return with nothing to recover, so it would never emit the unlock +
   * plug_on pair and the plugs would stay stranded OFF. Until the engine owns
   * recovery again (its own kill re-locks it, or it emits unlock), inject the
   * standard pair ahead of the ON_TASK status.
   */
  private withDemoRecovery(
    events: PolicyEvent[],
    input: PolicyEngineInput,
  ): PolicyEvent[] {
    if (!this.demoPlugsCut) {
      return events;
    }
    if (events.some((event) => event.type === "unlock" || event.type === "kill")) {
      this.demoPlugsCut = false;
      return events;
    }
    if (!events.some((event) => event.type === "status" && event.decision === "ON_TASK")) {
      return events;
    }
    this.demoPlugsCut = false;
    const injected: PolicyEvent[] = [{ type: "unlock" }];
    const plugOn = plugEventFor("plug_on", input, REASONS.unlock);
    if (plugOn !== null) {
      injected.push(plugOn);
    }
    return [...injected, ...events];
  }

  private async applyPolicyEvent(event: PolicyEvent): Promise<void> {
    switch (event.type) {
      case "start_countdown": {
        const armedAt = this.now();
        const fuse = this.lastFuse;
        this.countdownStartedAt = armedAt;
        this.countdownDurationSec = event.seconds;
        // THE LATCH closes here: from now until clearFuse, `resolveFuse`
        // answers with this value and stops listening to either model.
        this.fuseLatch = { ...fuse, seconds: event.seconds };
        /*
         * THE LEARNING-SIGNAL TRAP.
         *
         * AdaptiveFuse learns cancel = positive, kill = negative. A pre-armed
         * fuse is half the length the learner asked for, so it kills more
         * often through no fault of the user. Left alone the model reads that
         * as "this person needs longer", lengthens the personal fuse, the
         * pre-arm halves the longer fuse, and the two systems ratchet against
         * each other for the rest of the install's life.
         *
         * Of the two fixes in docs/RECONCILIATION.md, RECORDING the granted
         * fuse is already done by `main`: `armed(seconds)` stamps the fuse
         * actually handed out onto the DriftMoment, `fuseLength`/`fuseOverN`
         * are features, and `examplesFor` censors every candidate longer than
         * a kill's fuse. That handles the fuse-length confound — but not the
         * SELECTION one: a pre-arm fires on high-risk moments, and with no
         * pre-arm feature the model charges their low recovery rate to the
         * person. Adding that feature means a new FEATURE_NAMES entry, a new
         * prior weight and a FEATURE_LAYOUT bump across src/shared/adapt,
         * which discards every model already on disk.
         *
         * Excluding is one `if` and touches nothing shared, so we exclude:
         * skip `armed`, and the drift never becomes an ActiveDrift, so the
         * later `recovered`/`killed` are no-ops (see adaptiveFuse.test.ts,
         * "does not learn anything from a countdown that was never armed").
         * The honest statement is that the fuse this drift was given is not
         * the fuse the learner chose, so its outcome does not measure what
         * the learner is trying to measure.
         */
        const choice = fuse.prearmed ? null : this.adaptive.armed(event.seconds, armedAt);
        this.appendLog(
          "countdown",
          `start_countdown · ${event.reason} · ${event.seconds}s`,
        );
        if (choice !== null) {
          this.appendLog("adapt", choice.reason);
        }
        if (fuse.prearmed) {
          this.appendLog(
            "adapt",
            `${event.seconds}s — forecast pre-armed, scaled from your ` +
              `${fuse.personalSec}s · not learned from`,
          );
        }
        if (event.reason === REASONS.blockedFocus) {
          this.nudges.blocked(armedAt);
          await this.nudge("blocked", this.focus?.processName);
        }
        return;
      }
      case "cancel_countdown":
        // They fixed it inside the fuse. This is the positive label, and the
        // gap since arming is the only thing that says *how long* they need.
        this.adaptive.recovered(this.now());
        this.clearFuse();
        this.appendLog("countdown", "cancel_countdown");
        return;
      case "kill": {
        this.adaptive.killed();
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
        // In nudge mode plugs are a lamp that switches on when you drift;
        // cutting it at the kill would undo the nudge.
        if (this.loadSettings().plugMode === "nudge") {
          return;
        }
        await this.applyPlugCommand("off", event.deviceIds, event.reason, {
          emitEvent: false,
        });
        return;
      case "plug_on":
        if (this.loadSettings().plugMode === "nudge") {
          return;
        }
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

  /** Demo trigger, like Demo Kill: the same nudge a real drift would fire. */
  async demoNudge(kind: unknown): Promise<void> {
    if (!isNudgeKind(kind)) {
      throw new Error("nudge kind must be phone, unfocused, or blocked");
    }
    this.appendLog("demo", `Test nudge · ${kind}`);
    await this.nudge(kind);
  }

  /**
   * Pull them back: the window comes to the front with the timer and a
   * motivational line, and in nudge mode the enabled plugs (a lamp) switch on.
   */
  private async nudge(kind: NudgeKind, app?: string): Promise<void> {
    const event: NudgeEvent = { ts: this.now(), kind, ...(app ? { app } : {}) };
    this.push.nudge(event);
    try {
      this.revealWindow?.();
    } catch (error) {
      console.error("Failed to bring FocusPlug to the front:", errorMessage(error));
    }
    this.appendLog("nudge", app ? `${kind} · ${app}` : kind);
    const settings = this.loadSettings();
    const lampIds = settings.plugMode === "nudge" ? enabledFunPlugIds(settings.plugs) : [];
    if (lampIds.length > 0) {
      await this.applyPlugCommand("on", lampIds, `nudge_${kind}`, { emitEvent: false });
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

  private buildPolicyInput(
    sessionActive: boolean,
    settings?: AppSettings,
    fuseSec: number | null = null,
  ): PolicyEngineInput {
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
      // ONE fuse authority. `resolveFuse` composes the adaptive fuse's
      // personalised length with the forecast's pre-arm and hands the answer
      // in; the idle path (session stopping) has no fuse to compose and falls
      // back to the Settings value, exactly as before.
      countdownSec: fuseSec ?? resolved.countdownSec,
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
    // Releasing the latch is part of clearing the fuse: every path that stops
    // a countdown (recovery, kill, Demo Kill, start, stop) goes through here,
    // so the next drift is free to ask both models again.
    this.fuseLatch = null;
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
