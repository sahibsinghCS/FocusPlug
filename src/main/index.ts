import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
  DEFAULT_ALLOWLIST,
  DEFAULT_BLOCKLIST,
  DEFAULT_SESSION_STATE,
  DEFAULT_SETTINGS,
} from "@shared/defaults";
import {
  IPC_INVOKE,
  type AppLists,
  type AppSettings,
  type KillResult,
  type SessionState,
} from "@shared/ipc";
import type { AppEntry, SessionEvent } from "@shared/types";

let sessionState: SessionState = { ...DEFAULT_SESSION_STATE };
let allowlist: AppEntry[] = cloneEntries(DEFAULT_ALLOWLIST);
let blocklist: AppEntry[] = cloneEntries(DEFAULT_BLOCKLIST);
let settings: AppSettings = { ...DEFAULT_SETTINGS };
const sessionLog: SessionEvent[] = [];

function cloneEntries(entries: AppEntry[]): AppEntry[] {
  return entries.map((entry) => ({
    ...entry,
    match: [...entry.match],
  }));
}

function lists(): AppLists {
  return {
    allowlist: cloneEntries(allowlist),
    blocklist: cloneEntries(blocklist),
  };
}

function registerIpc(): void {
  ipcMain.handle(IPC_INVOKE.SESSION_START, (): SessionState => {
    sessionState = {
      ...sessionState,
      sessionActive: true,
      decision: "IDLE",
      countdownSec: 0,
      detail: "Session started (scaffold stub — monitors not wired)",
    };
    return sessionState;
  });

  ipcMain.handle(IPC_INVOKE.SESSION_STOP, (): SessionState => {
    sessionState = {
      ...DEFAULT_SESSION_STATE,
      focus: sessionState.focus,
      desk: sessionState.desk,
    };
    return sessionState;
  });

  ipcMain.handle(IPC_INVOKE.SESSION_GET_STATE, (): SessionState => sessionState);

  ipcMain.handle(IPC_INVOKE.LISTS_GET, (): AppLists => lists());

  ipcMain.handle(
    IPC_INVOKE.LISTS_SET_ALLOW,
    (_event, next: AppEntry[]): AppLists => {
      allowlist = cloneEntries(next);
      return lists();
    },
  );

  ipcMain.handle(
    IPC_INVOKE.LISTS_SET_BLOCK,
    (_event, next: AppEntry[]): AppLists => {
      blocklist = cloneEntries(next);
      return lists();
    },
  );

  ipcMain.handle(IPC_INVOKE.SETTINGS_GET, (): AppSettings => ({ ...settings }));

  ipcMain.handle(
    IPC_INVOKE.SETTINGS_SET,
    (_event, patch: Partial<AppSettings>): AppSettings => {
      settings = { ...settings, ...patch };
      return { ...settings };
    },
  );

  ipcMain.handle(IPC_INVOKE.LOG_GET, (): SessionEvent[] => [...sessionLog]);

  ipcMain.handle(IPC_INVOKE.DESK_SET_ENABLED, (_event, enabled: boolean): boolean => {
    settings = { ...settings, webcamEnabled: enabled };
    return settings.webcamEnabled;
  });

  ipcMain.handle(IPC_INVOKE.DEMO_KILL, (): KillResult => {
    return {
      killed: [],
      errors: ["Process killer not wired yet (foundation scaffold)"],
    };
  });
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: "FocusPlug",
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.focusplug.app");
  registerIpc();

  app.on("browser-window-created", (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
