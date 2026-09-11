import { DEFAULT_SESSION_STATE } from "../../shared/defaults.ts";
import type {
  AppLists,
  AppSettings,
  DeskMonitor,
  KillResult,
  ProcessKiller,
  SessionState,
  WindowMonitor,
} from "../../shared/ipc.ts";
import { IPC_PUSH, type IpcPushChannelMap } from "../../shared/ipc.ts";
import { ALL_BLOCKLIST_TARGET, PolicyEngine } from "../../shared/policy/index.ts";
import { parseAppSettings } from "../store/persist.ts";
import type {
  AppEntry,
  Decision,
  DeskSnapshot,
  FocusSnapshot,
  PolicyEvent,
  PolicyInput,
  SessionEvent,
} from "../../shared/types.ts";
import {
  enabledBlocklistMatchers,
  expandKillTargets,
  flattenEnabledMatchers,
} from "./targets.ts";

export type SessionPush = {
  <K extends keyof IpcPushChannelMap>(channel: K, payload: IpcPushChannelMap[K]): void;
};

/** Sync store surface used by the session runtime (FocusPlugStore). */
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

export interface SessionRuntimeDeps {
  store: SessionStore;
  windowMonitor: WindowMonitor;
  deskMonitor: DeskMonitor;
  killer: ProcessKiller;
  policy?: PolicyEngine;
  now?: () => number;
  push?: SessionPush;
  tickIntervalMs?: number;
}

export interface SessionInspect {
  state: SessionState;
  log: SessionEvent[];
  policyEvents: PolicyEvent[];
  killResults: KillResult[];
  demoKills: KillResult[];
  ipcChannels: string[];
  allowlistMatchers: string[];
}

const DEFAULT_TICK_INTERVAL_MS = 250;

function cloneFocus(snap: FocusSnapshot): FocusSnapshot {
  return { ...snap };
}

function cloneDesk(snap: DeskSnapshot): DeskSnapshot {
  return { ...snap };
}

function cloneSettings(settings: AppSettings): AppSettings {
  return { ...settings };
}

function cloneLists(lists: AppLists): AppLists {
  return {
    allowlist: lists.allowlist.map((entry) => ({ ...entry, match: [...entry.match] })),
    blocklist: lists.blocklist.map((entry) => ({ ...entry, match: [...entry.match] })),
  };
}

function cloneKill(result: KillResult): KillResult {
  return { killed: [...result.killed], errors: [...result.errors] };
}

function formatKillDetail(label: string, result: KillResult, reason: string): string {
  const killed = result.killed.length > 0 ? result.killed.join(", ") : "nothing";
  const errors = result.errors.length > 0 ? ` · errors: ${result.errors.join("; ")}` : "";
  return `${label} · ${reason} · killed ${killed}${errors}`;
}

function focusKey(snap: FocusSnapshot | null): string {
  if (snap === null) {
    return "";
  }
  return `${snap.processName}|${snap.windowTitle}|${snap.matchedAllow}|${snap.matchedBlock}`;
}

function deskKey(snap: DeskSnapshot | null): string {
  if (snap === null) {
    return "";
  }
  return `${snap.label}|${snap.webcamEnabled}`;
}

/**
 * Session lifecycle glue: monitors → PolicyEngine → countdown IPC → ProcessKiller.
 */
export class SessionRuntime {
  private readonly store: SessionStore;
  private readonly windowMonitor: WindowMonitor;
  private readonly deskMonitor: DeskMonitor;
  private readonly killer: ProcessKiller;
  private readonly policy: PolicyEngine;
  private readonly now: () => number;
  private readonly pushFn: SessionPush | undefined;
  private readonly tickIntervalMs: number;

  private sessionActive = false;
  private focus: FocusSnapshot | null = null;
  private desk: DeskSnapshot | null = null;
  private decision: Decision = DEFAULT_SESSION_STATE.decision;
  private detail = DEFAULT_SESSION_STATE.detail;
  private settings: AppSettings;
  private countdown: { startedAt: number } | null = null;
  private lastFocusKey = "";
  private lastDeskKey = "";
  private lastDecisionKey = "";

  private running = false;
  private disposed = false;
  private inTask = false;
  private tail: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly policyEvents: PolicyEvent[] = [];
  readonly killResults: KillResult[] = [];
  readonly demoKills: KillResult[] = [];
  readonly ipcTrace: Array<{ channel: string }> = [];

  constructor(deps: SessionRuntimeDeps) {
    this.store = deps.store;
    this.windowMonitor = deps.windowMonitor;
    this.deskMonitor = deps.deskMonitor;
    this.killer = deps.killer;
    this.policy = deps.policy ?? new PolicyEngine();
    this.now = deps.now ?? Date.now;
    this.pushFn = deps.push;
    this.tickIntervalMs = deps.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.settings = this.store.loadSettings();
  }

  start(): void {
    if (this.running || this.disposed) {
      return;
    }
    this.running = true;
    this.windowMonitor.start((snap) => {
      void this.enqueue(async () => {
        await this.onFocus(snap);
      });
    });
    this.deskMonitor.start((snap) => {
      void this.enqueue(async () => {
        await this.onDesk(snap);
      });
    });
    this.deskMonitor.setEnabled(this.settings.webcamEnabled);
    if (this.tickIntervalMs > 0) {
      this.timer = setInterval(() => {
        if (this.disposed || !this.running) {
          return;
        }
        void this.enqueue(async () => {
          await this.stepPolicy();
        });
      }, this.tickIntervalMs);
    }
    void this.enqueue(async () => {
      await this.stepPolicy();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.windowMonitor.stop();
    this.deskMonitor.stop();
  }

  flush(): Promise<void> {
    return this.tail;
  }

  async tick(): Promise<SessionState> {
    await this.enqueue(async () => {
      await this.stepPolicy();
    });
    return this.getState();
  }

  async sessionStart(): Promise<SessionState> {
    await this.enqueue(async () => {
      this.sessionActive = true;
      this.appendLog("session", "Session started");
      await this.stepPolicy();
    });
    return this.getState();
  }

  async sessionStop(): Promise<SessionState> {
    await this.enqueue(async () => {
      this.sessionActive = false;
      this.countdown = null;
      this.appendLog("session", "Session stopped — observe only");
      await this.stepPolicy();
    });
    return this.getState();
  }

  async demoKill(): Promise<KillResult> {
    let result: KillResult = { killed: [], errors: [] };
    await this.enqueue(async () => {
      const matchers = enabledBlocklistMatchers(this.store.loadBlocklist());
      result = await this.runKill(matchers);
      this.demoKills.push(cloneKill(result));
      this.appendLog("kill", formatKillDetail("Demo Kill", result, "demo_kill"));
      this.emit(IPC_PUSH.POLICY_EVENT, {
        type: "kill",
        targets: matchers,
        reason: "demo_kill",
      });
      this.countdown = null;
      if (this.sessionActive) {
        const now = this.now();
        const events = this.policy.step({
          ...this.buildInput(now),
          countdownSec: 0,
        });
        await this.applyEvents(events, { skipKill: true });
      }
      this.emitState();
    });
    return cloneKill(result);
  }

  getState(): SessionState {
    return {
      sessionActive: this.sessionActive,
      focus: this.focus ? cloneFocus(this.focus) : null,
      desk: this.desk ? cloneDesk(this.desk) : null,
      decision: this.decision,
      countdownSec: this.remainingCountdown(this.now()),
      detail: this.detail,
    };
  }

  getLists(): AppLists {
    return cloneLists({
      allowlist: this.store.loadAllowlist(),
      blocklist: this.store.loadBlocklist(),
    });
  }

  getSettings(): AppSettings {
    return cloneSettings(this.settings);
  }

  getLog(): SessionEvent[] {
    return this.store.loadSessionLog().map((event) => ({ ...event }));
  }

  async setAllowlist(entries: AppEntry[]): Promise<AppLists> {
    await this.enqueue(async () => {
      await Promise.resolve(this.store.saveAllowlist(entries));
      this.appendLog("lists", `Allowlist updated (${entries.length} apps)`);
      await this.stepPolicy();
    });
    return this.getLists();
  }

  async setBlocklist(entries: AppEntry[]): Promise<AppLists> {
    await this.enqueue(async () => {
      await Promise.resolve(this.store.saveBlocklist(entries));
      this.appendLog("lists", `Blocklist updated (${entries.length} apps)`);
      await this.stepPolicy();
    });
    return this.getLists();
  }

  async setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    await this.enqueue(async () => {
      await this.applySettingsPatch(patch);
      await this.stepPolicy();
    });
    return this.getSettings();
  }

  async setDeskEnabled(enabled: boolean): Promise<boolean> {
    await this.enqueue(async () => {
      await this.applySettingsPatch({ webcamEnabled: enabled });
      this.appendLog("desk", enabled ? "Webcam enabled" : "Webcam disabled");
      await this.stepPolicy();
    });
    return this.settings.webcamEnabled;
  }

  inspect(): SessionInspect {
    return {
      state: this.getState(),
      log: this.getLog(),
      policyEvents: this.policyEvents.map((event) => ({ ...event })),
      killResults: this.killResults.map(cloneKill),
      demoKills: this.demoKills.map(cloneKill),
      ipcChannels: [...new Set(this.ipcTrace.map((item) => item.channel))],
      allowlistMatchers: flattenEnabledMatchers(this.store.loadAllowlist()),
    };
  }

  private async applySettingsPatch(patch: Partial<AppSettings>): Promise<void> {
    const merged: AppSettings = { ...this.settings, ...patch };
    const parsed = parseAppSettings(merged);
    if (parsed === null) {
      throw new Error("Invalid settings patch");
    }
    const webcamChanged = parsed.webcamEnabled !== this.settings.webcamEnabled;
    this.settings = parsed;
    await Promise.resolve(this.store.saveSettings(this.settings));
    if (webcamChanged) {
      this.deskMonitor.setEnabled(this.settings.webcamEnabled);
      if (this.desk !== null) {
        this.desk = { ...this.desk, webcamEnabled: this.settings.webcamEnabled, ts: this.now() };
        this.emit(IPC_PUSH.DESK_SNAPSHOT, cloneDesk(this.desk));
      }
    }
    if (patch.countdownSec !== undefined || patch.deskThreshold !== undefined || patch.strictMode !== undefined) {
      this.appendLog(
        "settings",
        `Settings saved · countdown ${this.settings.countdownSec}s · desk ${this.settings.deskThreshold} · strict ${this.settings.strictMode}`,
      );
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    if (this.inTask) {
      return task();
    }
    const run = async (): Promise<void> => {
      if (this.disposed) {
        return;
      }
      this.inTask = true;
      try {
        await task();
      } finally {
        this.inTask = false;
      }
    };
    const wrapped = this.tail.then(run, run);
    this.tail = wrapped.then(
      () => undefined,
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("SessionRuntime task failed:", message);
      },
    );
    return wrapped;
  }

  private async onFocus(snap: FocusSnapshot): Promise<void> {
    this.focus = cloneFocus(snap);
    this.emit(IPC_PUSH.FOCUS_SNAPSHOT, cloneFocus(snap));
    const key = focusKey(snap);
    if (key !== this.lastFocusKey) {
      this.lastFocusKey = key;
      const match = snap.matchedBlock ? "block" : snap.matchedAllow ? "allow" : "other";
      this.appendLog("focus", `${snap.processName || "(none)"} — ${snap.windowTitle || "(no title)"} · ${match}`);
    }
    await this.stepPolicy();
  }

  private async onDesk(snap: DeskSnapshot): Promise<void> {
    this.desk = cloneDesk(snap);
    this.emit(IPC_PUSH.DESK_SNAPSHOT, cloneDesk(snap));
    const key = deskKey(snap);
    if (key !== this.lastDeskKey) {
      this.lastDeskKey = key;
      this.appendLog(
        "desk",
        `${snap.label} · ${Math.round(snap.confidence * 100)}% · webcam ${snap.webcamEnabled ? "on" : "off"}`,
      );
    }
    await this.stepPolicy();
  }

  private buildInput(now: number): PolicyInput {
    return {
      sessionActive: this.sessionActive,
      focus: this.focus ? { ...this.focus, ts: now } : null,
      desk: this.desk ? { ...this.desk, ts: now } : null,
      countdownSec: this.settings.countdownSec,
      deskThreshold: this.settings.deskThreshold,
      strictMode: this.settings.strictMode,
    };
  }

  private async stepPolicy(): Promise<void> {
    const now = this.now();
    const events = this.policy.step(this.buildInput(now));
    await this.applyEvents(events, { skipKill: false });
    this.emitState();
  }

  private async applyEvents(
    events: PolicyEvent[],
    options: { skipKill: boolean },
  ): Promise<void> {
    for (const event of events) {
      this.policyEvents.push(event);
      this.emit(IPC_PUSH.POLICY_EVENT, event);
      switch (event.type) {
        case "start_countdown":
          this.countdown = { startedAt: this.now() };
          this.appendLog("policy", `start_countdown · ${event.reason} · ${event.seconds}s`);
          break;
        case "cancel_countdown":
          this.countdown = null;
          this.appendLog("policy", "cancel_countdown");
          break;
        case "kill": {
          this.countdown = null;
          if (!options.skipKill) {
            const matchers = expandKillTargets(event.targets, this.store.loadBlocklist());
            const result = await this.runKill(matchers);
            this.appendLog("kill", formatKillDetail("Kill", result, event.reason));
          }
          break;
        }
        case "unlock":
          this.countdown = null;
          this.appendLog("policy", "unlock");
          break;
        case "status": {
          this.decision = event.decision;
          this.detail = event.detail;
          const key = `${event.decision}|${event.detail}`;
          if (key !== this.lastDecisionKey) {
            this.lastDecisionKey = key;
            this.appendLog("decision", `${event.decision} · ${event.detail}`);
          }
          break;
        }
        default: {
          const _exhaustive: never = event;
          void _exhaustive;
          break;
        }
      }
    }
  }

  private async runKill(matchers: string[]): Promise<KillResult> {
    const safe = matchers.filter((matcher) => matcher !== ALL_BLOCKLIST_TARGET);
    if (safe.length === 0) {
      const empty: KillResult = { killed: [], errors: ["No process matchers provided"] };
      this.killResults.push(cloneKill(empty));
      return empty;
    }
    const result = await Promise.resolve(this.killer.kill(safe));
    this.killResults.push(cloneKill(result));
    return result;
  }

  private remainingCountdown(now: number): number {
    if (this.countdown === null) {
      return 0;
    }
    const durationMs = Math.max(0, this.settings.countdownSec) * 1000;
    const endsAt = this.countdown.startedAt + durationMs;
    return Math.max(0, Math.ceil((endsAt - now) / 1000));
  }

  private emitState(): void {
    this.emit(IPC_PUSH.SESSION_STATE, this.getState());
  }

  private appendLog(kind: string, detail: string): void {
    const event: SessionEvent = { ts: this.now(), kind, detail };
    this.store.appendSessionLog(event);
    this.emit(IPC_PUSH.SESSION_EVENT, event);
  }

  private emit<K extends keyof IpcPushChannelMap>(
    channel: K,
    payload: IpcPushChannelMap[K],
  ): void {
    this.ipcTrace.push({ channel });
    this.pushFn?.(channel, payload);
  }
}
