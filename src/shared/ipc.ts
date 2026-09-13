import type { FaceId } from "./faces";
import type { ForecastEvent, ForecastSnapshot } from "./forecast/types";
import type { NudgeEvent, NudgeKind, PlugMode } from "./nudge";
import type { FocusPlanState, PlanRound, SessionPlanContext } from "./plan/types";
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

export type { FaceId, FacePhase } from "./faces";
export type { ForecastBand, ForecastEvent, ForecastSnapshot } from "./forecast/types";
export type { NudgeEvent, NudgeKind, PlugMode } from "./nudge";
export type {
  FocusPlanLedger,
  FocusPlanState,
  PlanDebrief,
  PlanEstimate,
  PlanRecommendation,
  PlanRevision,
  PlanRound,
  PlanTrend,
  SessionArmContext,
  SessionPlanContext,
} from "./plan/types";
export type {
  AppEntry,
  AttentionLabel,
  Decision,
  DeskAttention,
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
  DEMO_NUDGE: "focusplug:demo:nudge",
  FORECAST_GET_STATE: "focusplug:forecast:getState",
  PLAN_GET_STATE: "focusplug:plan:getState",
  PLAN_RESET: "focusplug:plan:reset",
} as const;

/** Main → renderer push (event) channels. */
export const IPC_PUSH = {
  SESSION_STATE: "focusplug:session:state",
  POLICY_EVENT: "focusplug:policy:event",
  FOCUS_SNAPSHOT: "focusplug:focus:snapshot",
  DESK_SNAPSHOT: "focusplug:desk:snapshot",
  SESSION_EVENT: "focusplug:log:event",
  NUDGE: "focusplug:session:nudge",
  FORECAST_SNAPSHOT: "focusplug:forecast:snapshot",
  FORECAST_EVENT: "focusplug:forecast:event",
  PLAN_ROUND: "focusplug:plan:round",
} as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE)[keyof typeof IPC_INVOKE];
export type IpcPushChannel = (typeof IPC_PUSH)[keyof typeof IPC_PUSH];

export interface AppSettings {
  countdownSec: number;
  deskThreshold: number;
  strictMode: boolean;
  webcamEnabled: boolean;
  deskModelId: DeskModelId;
  /** Immersive session face. Default is flight. */
  faceId: FaceId;
  /** Flight face origin IATA. Default DUB. */
  flightDep: string;
  /** Flight face arrival IATA. Default EDI. */
  flightArr: string;
  /** What enabled plugs do when you drift: `nudge` switches them on, `cut` powers off on kill. Default nudge. */
  plugMode: PlugMode;
  plugs: PlugDevice[];
  /** Focus Forecast master switch. Off reproduces today's behavior exactly. */
  forecastEnabled: boolean;
  /** Allow pre-arm to shorten the fuse. Off is nudge-only, zero enforcement risk. */
  forecastPrearmEnabled: boolean;
  /** Smoothed-risk threshold for the nudge toast. Clamped [0.05, 0.90]. */
  forecastNudgeRisk: number;
  /** Smoothed-risk threshold for pre-arm. Clamped [0.10, 0.95], >= nudge + 0.05. */
  forecastPrearmRisk: number;
  /** Shortened fuse while pre-armed. Clamped [3, 600]; runtime caps at countdownSec. */
  forecastPrearmFuseSec: number;
  /** Focus Plan master switch. Off reproduces today's screens exactly. */
  focusPlanEnabled: boolean;
  /** Let progression raise or lower the target. Off keeps the measurement
   *  and the debrief, and plans to the estimate with no step. */
  focusPlanStretchEnabled: boolean;
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
  /**
   * ONE optional argument, and it never reaches the session controller:
   * `src/main/index.ts` hands it to `FocusPlan.declareRound` and then calls
   * `controller.start()`. Backwards compatible — every existing caller
   * (probe.ts, the smoke script, mockApi) still typechecks and still works.
   */
  "focusplug:session:start": { args: [context?: SessionPlanContext]; result: SessionState };
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
  "focusplug:demo:nudge": { args: [kind: NudgeKind]; result: void };
  "focusplug:forecast:getState": { args: []; result: ForecastSnapshot | null };
  "focusplug:plan:getState": { args: []; result: FocusPlanState };
  "focusplug:plan:reset": { args: []; result: FocusPlanState };
}

export interface IpcPushChannelMap {
  "focusplug:session:state": SessionState;
  "focusplug:policy:event": PolicyEvent;
  "focusplug:focus:snapshot": FocusSnapshot;
  "focusplug:desk:snapshot": DeskSnapshot;
  "focusplug:log:event": SessionEvent;
  "focusplug:session:nudge": NudgeEvent;
  "focusplug:forecast:snapshot": ForecastSnapshot;
  "focusplug:forecast:event": ForecastEvent;
  "focusplug:plan:round": PlanRound;
}

/** Preload API exposed on `window.focusplug`. */
export interface FocusPlugApi {
  sessionStart(context?: SessionPlanContext): Promise<SessionState>;
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
  /** Fire a nudge now (window forward, overlay, lamp in nudge mode) — for demos. */
  demoNudge(kind: NudgeKind): Promise<void>;
  forecastGetState(): Promise<ForecastSnapshot | null>;
  planGetState(): Promise<FocusPlanState>;
  planReset(): Promise<FocusPlanState>;
  onSessionState(cb: (state: SessionState) => void): () => void;
  onPolicyEvent(cb: (event: PolicyEvent) => void): () => void;
  onFocusSnapshot(cb: (snap: FocusSnapshot) => void): () => void;
  onDeskSnapshot(cb: (snap: DeskSnapshot) => void): () => void;
  onSessionEvent(cb: (event: SessionEvent) => void): () => void;
  onNudge(cb: (event: NudgeEvent) => void): () => void;
  onForecastSnapshot(cb: (snap: ForecastSnapshot) => void): () => void;
  onForecastEvent(cb: (event: ForecastEvent) => void): () => void;
  onPlanRound(cb: (round: PlanRound) => void): () => void;
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
