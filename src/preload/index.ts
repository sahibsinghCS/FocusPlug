import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC_INVOKE,
  IPC_PUSH,
  type AppEntry,
  type AppSettings,
  type DeskModelId,
  type DeskSnapshot,
  type FocusPlugApi,
  type FocusSnapshot,
  type PlugDevice,
  type PolicyEvent,
  type SessionEvent,
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
  sessionStart: () => ipcRenderer.invoke(IPC_INVOKE.SESSION_START),
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
};

contextBridge.exposeInMainWorld("focusplug", api);
