import { BrowserWindow, ipcMain } from "electron";
import {
  IPC_INVOKE,
  type AppEntry,
  type AppSettings,
  type IpcPushChannelMap,
} from "../../shared/ipc.ts";
import type { SessionRuntime } from "./runtime.ts";

export function pushToRenderers<K extends keyof IpcPushChannelMap>(
  channel: K,
  payload: IpcPushChannelMap[K],
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function registerSessionIpc(runtime: SessionRuntime): void {
  ipcMain.handle(IPC_INVOKE.SESSION_START, () => runtime.sessionStart());
  ipcMain.handle(IPC_INVOKE.SESSION_STOP, () => runtime.sessionStop());
  ipcMain.handle(IPC_INVOKE.SESSION_GET_STATE, () =>
    runtime.flush().then(() => runtime.getState()),
  );
  ipcMain.handle(IPC_INVOKE.LISTS_GET, () => runtime.getLists());
  ipcMain.handle(IPC_INVOKE.LISTS_SET_ALLOW, (_event, entries: AppEntry[]) =>
    runtime.setAllowlist(entries),
  );
  ipcMain.handle(IPC_INVOKE.LISTS_SET_BLOCK, (_event, entries: AppEntry[]) =>
    runtime.setBlocklist(entries),
  );
  ipcMain.handle(IPC_INVOKE.SETTINGS_GET, () => runtime.getSettings());
  ipcMain.handle(IPC_INVOKE.SETTINGS_SET, (_event, patch: Partial<AppSettings>) =>
    runtime.setSettings(patch),
  );
  ipcMain.handle(IPC_INVOKE.LOG_GET, () => runtime.getLog());
  ipcMain.handle(IPC_INVOKE.DESK_SET_ENABLED, (_event, enabled: boolean) =>
    runtime.setDeskEnabled(enabled),
  );
  ipcMain.handle(IPC_INVOKE.DEMO_KILL, () => runtime.demoKill());
}
