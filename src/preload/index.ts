import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC_INVOKE,
  IPC_PUSH,
  type AppEntry,
  type AppSettings,
  type DeskCorrectionsState,
  type DeskModelId,
  type DeskSnapshot,
  type FocusPlanState,
  type FocusPlugApi,
  type FocusSnapshot,
  type ForecastEvent,
  type ForecastSnapshot,
  type NudgeEvent,
  type NudgeKind,
  type PlanRound,
  type PlugDevice,
  type PolicyEvent,
  type RecordCorrectionRequest,
  type RefitReport,
  type SessionEvent,
  type SessionPlanContext,
  type SessionState,
} from "@shared/ipc";

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: FocusPlugApi = {
  // One optional argument: the Focus Plan arm context. `undefined` is the
  // pre-Focus-Plan call and still works exactly as before.
  sessionStart: (context?: SessionPlanContext) =>
    ipcRenderer.invoke(IPC_INVOKE.SESSION_START, context),
  sessionStop: () => ipcRenderer.invoke(IPC_INVOKE.SESSION_STOP),
  sessionGetState: () => ipcRenderer.invoke(IPC_INVOKE.SESSION_GET_STATE),
  listsGet: () => ipcRenderer.invoke(IPC_INVOKE.LISTS_GET),
  listsSetAllow: (entries: AppEntry[]) =>
    ipcRenderer.invoke(IPC_INVOKE.LISTS_SET_ALLOW, entries),
  listsSetBlock: (entries: AppEntry[]) =>
    ipcRenderer.invoke(IPC_INVOKE.LISTS_SET_BLOCK, entries),
  settingsGet: () => ipcRenderer.invoke(IPC_INVOKE.SETTINGS_GET),
  settingsSet: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_INVOKE.SETTINGS_SET, patch),
  logGet: () => ipcRenderer.invoke(IPC_INVOKE.LOG_GET),
  deskSetEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_INVOKE.DESK_SET_ENABLED, enabled),
  deskGetModelId: () => ipcRenderer.invoke(IPC_INVOKE.DESK_GET_MODEL_ID),
  deskSetModelId: (id: DeskModelId) =>
    ipcRenderer.invoke(IPC_INVOKE.DESK_SET_MODEL_ID, id),
  plugsList: () => ipcRenderer.invoke(IPC_INVOKE.PLUGS_LIST),
  plugsAdd: (device: PlugDevice) => ipcRenderer.invoke(IPC_INVOKE.PLUGS_ADD, device),
  plugsRemove: (deviceId: string) =>
    ipcRenderer.invoke(IPC_INVOKE.PLUGS_REMOVE, deviceId),
  plugsTest: (deviceId: string) => ipcRenderer.invoke(IPC_INVOKE.PLUGS_TEST, deviceId),
  demoKill: () => ipcRenderer.invoke(IPC_INVOKE.DEMO_KILL),
  demoNudge: (kind: NudgeKind) => ipcRenderer.invoke(IPC_INVOKE.DEMO_NUDGE, kind),
  forecastGetState: () => ipcRenderer.invoke(IPC_INVOKE.FORECAST_GET_STATE),
  planGetState: (): Promise<FocusPlanState> => ipcRenderer.invoke(IPC_INVOKE.PLAN_GET_STATE),
  planReset: (): Promise<FocusPlanState> => ipcRenderer.invoke(IPC_INVOKE.PLAN_RESET),
  correctionsGetState: (): Promise<DeskCorrectionsState> =>
    ipcRenderer.invoke(IPC_INVOKE.CORRECTIONS_GET_STATE),
  correctionsRecord: (request: RecordCorrectionRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.CORRECTIONS_RECORD, request),
  correctionsDelete: (id: string) => ipcRenderer.invoke(IPC_INVOKE.CORRECTIONS_DELETE, id),
  correctionsClear: (): Promise<DeskCorrectionsState> =>
    ipcRenderer.invoke(IPC_INVOKE.CORRECTIONS_CLEAR),
  correctionsReveal: (): Promise<void> => ipcRenderer.invoke(IPC_INVOKE.CORRECTIONS_REVEAL),
  correctionsRefit: (options?: { gate?: "off" }): Promise<RefitReport> =>
    ipcRenderer.invoke(IPC_INVOKE.CORRECTIONS_REFIT, options),
  onSessionState: (cb: (state: SessionState) => void) =>
    subscribe(IPC_PUSH.SESSION_STATE, cb),
  onPolicyEvent: (cb: (event: PolicyEvent) => void) =>
    subscribe(IPC_PUSH.POLICY_EVENT, cb),
  onFocusSnapshot: (cb: (snap: FocusSnapshot) => void) =>
    subscribe(IPC_PUSH.FOCUS_SNAPSHOT, cb),
  onDeskSnapshot: (cb: (snap: DeskSnapshot) => void) =>
    subscribe(IPC_PUSH.DESK_SNAPSHOT, cb),
  onSessionEvent: (cb: (event: SessionEvent) => void) =>
    subscribe(IPC_PUSH.SESSION_EVENT, cb),
  onNudge: (cb: (event: NudgeEvent) => void) => subscribe(IPC_PUSH.NUDGE, cb),
  onForecastSnapshot: (cb: (snap: ForecastSnapshot) => void) =>
    subscribe(IPC_PUSH.FORECAST_SNAPSHOT, cb),
  onForecastEvent: (cb: (event: ForecastEvent) => void) =>
    subscribe(IPC_PUSH.FORECAST_EVENT, cb),
  onPlanRound: (cb: (round: PlanRound) => void) => subscribe(IPC_PUSH.PLAN_ROUND, cb),
  onCorrectionsState: (cb: (state: DeskCorrectionsState) => void) =>
    subscribe(IPC_PUSH.CORRECTIONS_STATE, cb),
};

contextBridge.exposeInMainWorld("focusplug", api);
