import type {
  AppEntry,
  Decision,
  DeskSnapshot,
  FocusSnapshot,
  PolicyEvent,
  PolicyInput,
  SessionEvent,
} from "./types";

export type {
  AppEntry,
  Decision,
  DeskLabel,
  DeskSnapshot,
  FocusSnapshot,
  PolicyEvent,
  PolicyInput,
  SessionEvent,
} from "./types";

/** Renderer → main invoke (request/response) channels. */
export const IPC_INVOKE = {
  SESSION_START: "focusplug:session:start",
  SESSION_STOP: "focusplug:session:stop",
  SESSION_GET_STATE: "focusplug:session:getState",
  LISTS_GET: "focusplug:lists:get",
  LISTS_SET_ALLOW: "focusplug:lists:setAllow",
  LISTS_SET_BLOCK: "focusplug:lists:setBlock",
  SETTINGS_GET: "focusplug:settings:get",
  SETTINGS_SET: "focusplug:settings:set",
  LOG_GET: "focusplug:log:get",
  DESK_SET_ENABLED: "focusplug:desk:setEnabled",
  DEMO_KILL: "focusplug:demo:kill",
} as const;

/** Main → renderer push (event) channels. */
export const IPC_PUSH = {
  SESSION_STATE: "focusplug:session:state",
  POLICY_EVENT: "focusplug:policy:event",
  FOCUS_SNAPSHOT: "focusplug:focus:snapshot",
  DESK_SNAPSHOT: "focusplug:desk:snapshot",
  SESSION_EVENT: "focusplug:log:event",
} as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE)[keyof typeof IPC_INVOKE];
export type IpcPushChannel = (typeof IPC_PUSH)[keyof typeof IPC_PUSH];

export interface AppSettings {
  countdownSec: number;
  deskThreshold: number;
  strictMode: boolean;
  webcamEnabled: boolean;
}

export interface SessionState {
  sessionActive: boolean;
  focus: FocusSnapshot | null;
  desk: DeskSnapshot | null;
  decision: Decision;
  countdownSec: number;
  detail: string;
}

export interface AppLists {
  allowlist: AppEntry[];
  blocklist: AppEntry[];
}

export interface KillResult {
  killed: string[];
  errors: string[];
}

export interface IpcInvokeChannelMap {
  "focusplug:session:start": { args: []; result: SessionState };
  "focusplug:session:stop": { args: []; result: SessionState };
  "focusplug:session:getState": { args: []; result: SessionState };
  "focusplug:lists:get": { args: []; result: AppLists };
  "focusplug:lists:setAllow": { args: [allowlist: AppEntry[]]; result: AppLists };
  "focusplug:lists:setBlock": { args: [blocklist: AppEntry[]]; result: AppLists };
  "focusplug:settings:get": { args: []; result: AppSettings };
  "focusplug:settings:set": { args: [patch: Partial<AppSettings>]; result: AppSettings };
  "focusplug:log:get": { args: []; result: SessionEvent[] };
  "focusplug:desk:setEnabled": { args: [enabled: boolean]; result: boolean };
  "focusplug:demo:kill": { args: []; result: KillResult };
}

export interface IpcPushChannelMap {
  "focusplug:session:state": SessionState;
  "focusplug:policy:event": PolicyEvent;
  "focusplug:focus:snapshot": FocusSnapshot;
  "focusplug:desk:snapshot": DeskSnapshot;
  "focusplug:log:event": SessionEvent;
}

/** Preload API exposed on `window.focusplug`. */
export interface FocusPlugApi {
  sessionStart(): Promise<SessionState>;
  sessionStop(): Promise<SessionState>;
  sessionGetState(): Promise<SessionState>;
  listsGet(): Promise<AppLists>;
  listsSetAllow(entries: AppEntry[]): Promise<AppLists>;
  listsSetBlock(entries: AppEntry[]): Promise<AppLists>;
  settingsGet(): Promise<AppSettings>;
  settingsSet(patch: Partial<AppSettings>): Promise<AppSettings>;
  logGet(): Promise<SessionEvent[]>;
  deskSetEnabled(enabled: boolean): Promise<boolean>;
  demoKill(): Promise<KillResult>;
  onSessionState(cb: (state: SessionState) => void): () => void;
  onPolicyEvent(cb: (event: PolicyEvent) => void): () => void;
  onFocusSnapshot(cb: (snap: FocusSnapshot) => void): () => void;
  onDeskSnapshot(cb: (snap: DeskSnapshot) => void): () => void;
  onSessionEvent(cb: (event: SessionEvent) => void): () => void;
}

export interface WindowMonitor {
  start(cb: (snap: FocusSnapshot) => void): void;
  stop(): void;
}

export interface DeskMonitor {
  start(cb: (snap: DeskSnapshot) => void): void;
  stop(): void;
  setEnabled(enabled: boolean): void;
}

export interface PolicyEngine {
  step(input: PolicyInput): PolicyEvent[];
}

export interface ProcessKiller {
  kill(matchers: string[]): KillResult | Promise<KillResult>;
}

export interface Store {
  loadAllowlist(): AppEntry[] | Promise<AppEntry[]>;
  saveAllowlist(entries: AppEntry[]): void | Promise<void>;
  loadBlocklist(): AppEntry[] | Promise<AppEntry[]>;
  saveBlocklist(entries: AppEntry[]): void | Promise<void>;
  loadSettings(): AppSettings | Promise<AppSettings>;
  saveSettings(settings: AppSettings): void | Promise<void>;
  appendSessionLog(event: SessionEvent): void | Promise<void>;
  loadSessionLog(): SessionEvent[] | Promise<SessionEvent[]>;
}
