import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
  IPC_INVOKE,
  IPC_PUSH,
  type AppEntry,
  type AppSettings,
  type DeskModelId,
  type PlugDevice,
} from "@shared/ipc";
import { assertControllable, type PlugController } from "./plugs";
import { createFocusPlugRuntime, type SessionController, type SessionPush } from "./session";

let session: SessionController | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function createElectronPush(): SessionPush {
  return {
    sessionState: (state) => broadcast(IPC_PUSH.SESSION_STATE, state),
    policyEvent: (event) => broadcast(IPC_PUSH.POLICY_EVENT, event),
    focusSnapshot: (snap) => broadcast(IPC_PUSH.FOCUS_SNAPSHOT, snap),
    deskSnapshot: (snap) => broadcast(IPC_PUSH.DESK_SNAPSHOT, snap),
    sessionEvent: (event) => broadcast(IPC_PUSH.SESSION_EVENT, event),
  };
}

function registerIpc(controller: SessionController, plugs: PlugController): void {
  ipcMain.handle(IPC_INVOKE.SESSION_START, async () => controller.start());
  ipcMain.handle(IPC_INVOKE.SESSION_STOP, async () => controller.stop());
  ipcMain.handle(IPC_INVOKE.SESSION_GET_STATE, () => controller.getState());
  ipcMain.handle(IPC_INVOKE.LISTS_GET, () => controller.getLists());
  ipcMain.handle(IPC_INVOKE.LISTS_SET_ALLOW, (_event, entries: AppEntry[]) =>
    controller.setAllowlist(entries),
  );
  ipcMain.handle(IPC_INVOKE.LISTS_SET_BLOCK, (_event, entries: AppEntry[]) =>
    controller.setBlocklist(entries),
  );
  ipcMain.handle(IPC_INVOKE.SETTINGS_GET, () => controller.getSettings());
  ipcMain.handle(IPC_INVOKE.SETTINGS_SET, (_event, patch: Partial<AppSettings>) =>
    controller.setSettings(patch),
  );
  ipcMain.handle(IPC_INVOKE.LOG_GET, () => controller.getLog());
  ipcMain.handle(IPC_INVOKE.DESK_SET_ENABLED, (_event, enabled: boolean) =>
    controller.setDeskEnabled(enabled),
  );
  ipcMain.handle(IPC_INVOKE.DESK_GET_MODEL_ID, () => controller.getDeskModelId());
  ipcMain.handle(IPC_INVOKE.DESK_SET_MODEL_ID, (_event, id: DeskModelId) =>
    controller.setDeskModelId(id),
  );
  ipcMain.handle(IPC_INVOKE.PLUGS_LIST, () => controller.listPlugs());
  ipcMain.handle(IPC_INVOKE.PLUGS_ADD, (_event, device: PlugDevice) => {
    assertControllable(device);
    return controller.addPlug(device);
  });
  ipcMain.handle(IPC_INVOKE.PLUGS_REMOVE, (_event, deviceId: string) =>
    controller.removePlug(deviceId),
  );
  ipcMain.handle(IPC_INVOKE.PLUGS_TEST, async (_event, deviceId: string) => {
    controller.testPlug(deviceId);
    const snaps = await plugs.snapshot([deviceId]);
    const snap = snaps[0];
    if (!snap) {
      throw new Error("Plug not found");
    }
    return snap;
  });
  ipcMain.handle(IPC_INVOKE.DEMO_KILL, async () => controller.demoKill());
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
  const runtime = createFocusPlugRuntime({
    userDataDir: app.getPath("userData"),
    push: createElectronPush(),
  });
  session = runtime.session;
  registerIpc(runtime.session, runtime.plugs);

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

app.on("before-quit", () => {
  if (session !== null) {
    void session.stop();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
