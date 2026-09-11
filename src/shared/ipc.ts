import type {
  AppEntry,
  Decision,
  DeskModel,
  DeskModelId,
  DeskSnapshot,
  FocusSnapshot,
  PlugDevice,
  PlugSnapshot,
  PolicyEvent,
  PolicyInput,
  SessionEvent,
} from "./types";

export type {
  AppEntry,
  Decision,
  DeskFrame,
  DeskLabel,
  DeskModel,
  DeskModelId,
  DeskModelOutput,
  DeskSnapshot,
  FocusSnapshot,
  PlugDevice,
  PlugProtocol,
  PlugSnapshot,
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
  DESK_GET_MODEL_ID: "focusplug:desk:getModelId",
  DESK_SET_MODEL_ID: "focusplug:desk:setModelId",
  PLUGS_LIST: "focusplug:plugs:list",
  PLUGS_ADD: "focusplug:plugs:add",
  PLUGS_REMOVE: "focusplug:plugs:remove",
  PLUGS_TEST: "focusplug:plugs:test",
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
  deskModelId: DeskModelId;
  plugs: PlugDevice[];
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
  "focusplug:desk:getModelId": { args: []; result: DeskModelId };
  "focusplug:desk:setModelId": { args: [id: DeskModelId]; result: DeskModelId };
  "focusplug:plugs:list": { args: []; result: PlugDevice[] };
  "focusplug:plugs:add": { args: [device: PlugDevice]; result: PlugDevice[] };
  "focusplug:plugs:remove": { args: [deviceId: string]; result: PlugDevice[] };
  "focusplug:plugs:test": { args: [deviceId: string]; result: PlugSnapshot };
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
  deskGetModelId(): Promise<DeskModelId>;
  deskSetModelId(id: DeskModelId): Promise<DeskModelId>;
  plugsList(): Promise<PlugDevice[]>;
  plugsAdd(device: PlugDevice): Promise<PlugDevice[]>;
  plugsRemove(deviceId: string): Promise<PlugDevice[]>;
  plugsTest(deviceId: string): Promise<PlugSnapshot>;
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

/** Factory seam — pick a DeskModel by id. Do not hard-code BlazeFace. */
export interface DeskModelFactory {
  create(id: DeskModelId): DeskModel;
}

export interface PolicyEngine {
  step(input: PolicyInput): PolicyEvent[];
}

export interface ProcessKiller {
  kill(matchers: string[]): KillResult | Promise<KillResult>;
}

/**
 * Smart-plug seam. Fun/secondary devices only.
 * Never power off the study PC. No protocol driver in this freeze.
 */
export interface PlugController {
  off(ids: string[]): Promise<PlugSnapshot[]>;
  on(ids: string[]): Promise<PlugSnapshot[]>;
  list(): Promise<PlugDevice[]>;
  discover(): Promise<PlugDevice[]>;
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

/** Stub `plugs:test` / driver-not-wired snapshot error. */
export const PLUG_DRIVER_NOT_IMPLEMENTED = "plug driver not implemented";
