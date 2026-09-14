import type {
  DeskCorrectionsState,
  RecordCorrectionRequest,
  RecordCorrectionResult,
  RefitReport,
} from "./correction/types";
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

export type {
  ActiveAttentionHead,
  AttentionAnchorRow,
  AttentionAnchors,
  CorrectionCooldown,
  CorrectionHead,
  CorrectionLabel,
  CorrectionListItem,
  CorrectionMeaning,
  CorrectionVerdict,
  DeskCorrection,
  DeskCorrectionFrame,
  DeskCorrectionsFile,
  DeskCorrectionsState,
  PendingCorrection,
  PersonalAttentionHead,
  PlanRetraction,
  PlanRetractionRefusal,
  RecordCorrectionRequest,
  RecordCorrectionResult,
  RefitGateId,
  RefitGateResult,
  RefitReport,
  RefitScores,
} from "./correction/types";
export type { FaceId, FacePhase } from "./faces";
export type { ForecastBand, ForecastEvent, ForecastSnapshot } from "./forecast/types";
export type { DeskDrift, NudgeEvent, NudgeKind, PauseKind, PlugMode } from "./nudge";
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
  CORRECTIONS_GET_STATE: "focusplug:corrections:getState",
  CORRECTIONS_RECORD: "focusplug:corrections:record",
  CORRECTIONS_DELETE: "focusplug:corrections:delete",
  CORRECTIONS_CLEAR: "focusplug:corrections:clear",
  CORRECTIONS_REVEAL: "focusplug:corrections:reveal",
  CORRECTIONS_REFIT: "focusplug:corrections:refit",
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
  CORRECTIONS_STATE: "focusplug:corrections:state",
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
  /**
   * Stop the study clock when the presence head confirms they walked off.
   *
   * On by default, because time out of the room is not study time and the
   * presence head trained in this repo is right on 92.5% of the frames it
   * calls `away` (89.44% 3-way on the diverse-stock slice).
   *
   * A preference, NOT a capability. It can only act on a presence model whose
   * `away` has earned a stopped clock — `deskModelMayPauseOnAway`, which today
   * means `deskModelId: "custom"` alone. The shipped `blazeface` default is a
   * face detector with no `away` class: it answers `away` for any frame with
   * no usable face, is right on 42.1% of those calls and does it to 66.7% of
   * the at-desk frames in the repo's own held-out eval. There an `away`
   * nudges and never stops the clock, whatever this is set to.
   */
  pauseOnAwayEnabled: boolean;
  /**
   * Stop the study clock when the attention head confirms a phone. OFF by
   * default, and switchable on its own, because that head is the weak one
   * (50-69% phone recall, ~17% of non-phone photos called "phone") and pausing
   * a student who is working is the worst failure this feature has.
   */
  pauseOnPhoneEnabled: boolean;
  /**
   * Presence-head floor for an away pause. Clamped [0.50, 0.95].
   *
   * A floor is a guard only where confidence is a score. It is one on the
   * trained head; it is not one on `blazeface`, whose `away` confidence is the
   * constant 0.90/0.92 — which is why the model gate above, and not this
   * number, is what keeps a default install's clock running.
   */
  pauseAwayConfidence: number;
  /** Attention-head floor for a phone pause. Clamped [0.50, 0.99], >= away + 0.05. */
  pausePhoneConfidence: number;
  /** Focus Plan master switch. Off reproduces today's screens exactly. */
  focusPlanEnabled: boolean;
  /** Let progression raise or lower the target. Off keeps the measurement
   *  and the debrief, and plans to the estimate with no step. */
  focusPlanStretchEnabled: boolean;
  /**
   * Keep the frames that caused a pause so the student can correct it.
   *
   * On by default, and on a default install it still does nothing at all: a
   * correction can only come from a pause, and only `deskModelId: "custom"`
   * can pause. Off reproduces today's behaviour exactly — the ring retains
   * nothing, no `correctionId` is ever issued, the paused screen shows no
   * verdict row, and nothing is written. It does NOT delete anything already
   * stored: an off switch is not an erase button, and the erase button is in
   * the review card.
   */
  deskCorrectionsEnabled: boolean;
  /**
   * Run a personal attention head when one has passed the gate.
   *
   * A PREFERENCE, not a capability: it can only ever turn OFF a head the gate
   * already let in, never let one in. On by default because a head that got
   * past the gate is one that did not regress the held-out eval and newly
   * agrees with the student at least once.
   */
  personalAttentionHeadEnabled: boolean;
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
  "focusplug:corrections:getState": { args: []; result: DeskCorrectionsState };
  "focusplug:corrections:record": {
    args: [request: RecordCorrectionRequest];
    result: RecordCorrectionResult;
  };
  "focusplug:corrections:delete": { args: [id: string]; result: DeskCorrectionsState };
  "focusplug:corrections:clear": { args: []; result: DeskCorrectionsState };
  "focusplug:corrections:reveal": { args: []; result: void };
  "focusplug:corrections:refit": { args: [options?: { gate?: "off" }]; result: RefitReport };
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
  "focusplug:corrections:state": DeskCorrectionsState;
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
  correctionsGetState(): Promise<DeskCorrectionsState>;
  /** Records a verdict. Writes JPEGs and one JSON record, and NO weights. */
  correctionsRecord(request: RecordCorrectionRequest): Promise<RecordCorrectionResult>;
  correctionsDelete(id: string): Promise<DeskCorrectionsState>;
  correctionsClear(): Promise<DeskCorrectionsState>;
  /** Opens `<userData>/desk-corrections/` in the OS file manager. */
  correctionsReveal(): Promise<void>;
  /** The separate, explicit refit. One click never retrains; this is the click
   *  that does, and even it installs nothing the gate refuses. */
  correctionsRefit(options?: { gate?: "off" }): Promise<RefitReport>;
  onSessionState(cb: (state: SessionState) => void): () => void;
  onPolicyEvent(cb: (event: PolicyEvent) => void): () => void;
  onFocusSnapshot(cb: (snap: FocusSnapshot) => void): () => void;
  onDeskSnapshot(cb: (snap: DeskSnapshot) => void): () => void;
  onSessionEvent(cb: (event: SessionEvent) => void): () => void;
  onNudge(cb: (event: NudgeEvent) => void): () => void;
  onForecastSnapshot(cb: (snap: ForecastSnapshot) => void): () => void;
  onForecastEvent(cb: (event: ForecastEvent) => void): () => void;
  onPlanRound(cb: (round: PlanRound) => void): () => void;
  onCorrectionsState(cb: (state: DeskCorrectionsState) => void): () => void;
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
