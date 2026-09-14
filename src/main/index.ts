import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
  IPC_INVOKE,
  IPC_PUSH,
  type AppEntry,
  type AppSettings,
  type DeskModelId,
  type PlugDevice,
  type RecordCorrectionRequest,
} from "@shared/ipc";
import type { ForecastPush } from "@shared/forecast/types";
import type { PlanPush } from "@shared/plan/types";
import {
  applyPersonalAttentionHead,
  createDeskCorrections,
  createPersonalRefit,
  type DeskCorrections,
} from "./desk";
import { assertControllable, type PlugController } from "./plugs";
import {
  createFocusPlugRuntime,
  type FocusPlugRuntime,
  type SessionController,
  type SessionPush,
} from "./session";

let session: SessionController | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;

/** Bound so a hung plug/kill drain cannot hold the quit forever. */
const STOP_ON_QUIT_TIMEOUT_MS = 5000;

/**
 * A nudge brings FocusPlug back to the front. Windows refuses focus() from a
 * background app, so pin the window on top while focusing it, and flash the
 * taskbar button in case focus is still denied.
 */
function revealMainWindow(): void {
  const win = mainWindow;
  if (win === null || win.isDestroyed()) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.setAlwaysOnTop(true);
  win.moveTop();
  win.focus();
  if (!win.isFocused()) {
    win.flashFrame(true);
    win.once("focus", () => win.flashFrame(false));
  }
  setTimeout(() => {
    if (!win.isDestroyed()) {
      win.setAlwaysOnTop(false);
    }
  }, 1500);
}

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
    nudge: (event) => broadcast(IPC_PUSH.NUDGE, event),
  };
}

function createForecastElectronPush(): ForecastPush {
  return {
    snapshot: (snap) => broadcast(IPC_PUSH.FORECAST_SNAPSHOT, snap),
    event: (event) => broadcast(IPC_PUSH.FORECAST_EVENT, event),
  };
}

function createPlanElectronPush(): PlanPush {
  return {
    round: (round) => broadcast(IPC_PUSH.PLAN_ROUND, round),
  };
}

function registerIpc(
  controller: SessionController,
  plugs: PlugController,
  forecast: FocusPlugRuntime["forecast"],
  plan: FocusPlugRuntime["plan"],
  corrections: DeskCorrections,
): void {
  /**
   * SESSION_START carries ONE optional argument: the renderer's arm context
   * (round key, round index, planned focus length, and whether the Focus Plan
   * offer was accepted). It is consumed HERE and never handed to the
   * controller — `declareRound` validates untrusted input, never throws, and
   * runs synchronously immediately before `start()`, so the recorder always
   * has the context before the first `sessionState` push arrives and there is
   * no accept/start race to reason about.
   */
  ipcMain.handle(IPC_INVOKE.SESSION_START, async (_event, context?: unknown) => {
    plan.declareRound(context);
    return controller.start();
  });
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
  ipcMain.handle(IPC_INVOKE.DEMO_NUDGE, async (_event, kind: unknown) =>
    controller.demoNudge(kind),
  );
  ipcMain.handle(IPC_INVOKE.FORECAST_GET_STATE, () => forecast.getSnapshot());
  ipcMain.handle(IPC_INVOKE.PLAN_GET_STATE, () => plan.getState());
  ipcMain.handle(IPC_INVOKE.PLAN_RESET, () => plan.reset());
  /**
   * The correction loop. RECORD writes JPEGs and one JSON record and touches
   * no weights — there is no call path from here to any fitting code, which is
   * what makes "one click never retrains the model" structural rather than a
   * promise. REFIT is the separate, explicit action, and even it installs
   * nothing the gate refuses.
   */
  ipcMain.handle(IPC_INVOKE.CORRECTIONS_GET_STATE, () => corrections.getState());
  ipcMain.handle(IPC_INVOKE.CORRECTIONS_RECORD, (_event, request: RecordCorrectionRequest) =>
    corrections.record(request),
  );
  ipcMain.handle(IPC_INVOKE.CORRECTIONS_DELETE, (_event, id: string) => corrections.delete(id));
  ipcMain.handle(IPC_INVOKE.CORRECTIONS_CLEAR, () => corrections.clear());
  // Being able to open the directory and look at the actual files is a
  // stronger guarantee than any sentence in the docs.
  ipcMain.handle(IPC_INVOKE.CORRECTIONS_REVEAL, async () => {
    await shell.openPath(corrections.revealPath());
  });
  ipcMain.handle(IPC_INVOKE.CORRECTIONS_REFIT, async (_event, options?: { gate?: "off" }) =>
    corrections.refit(options),
  );
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    title: "FocusPlug",
    backgroundColor: "#07080c",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;

  win.on("ready-to-show", () => {
    win.show();
  });

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
    // The hidden desk-camera window counts as an open BrowserWindow, so
    // "window-all-closed" never fires while a webcam session runs — quitting
    // must key off the user-facing window or closing it leaves a headless
    // enforcer with the camera on.
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
}

// A second FocusPlug instance would enforce concurrently over the same
// settings/log files and the same physical plugs — one instance only.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    revealMainWindow();
  });

  app
    .whenReady()
    .then(() => {
      electronApp.setAppUserModelId("com.focusplug.app");
      const userDataDir = app.getPath("userData");
      const runtime = createFocusPlugRuntime({
        userDataDir,
        push: createElectronPush(),
        forecastPush: createForecastElectronPush(),
        planPush: createPlanElectronPush(),
        revealWindow: revealMainWindow,
      });
      session = runtime.session;
      /**
       * One owner, one directory. The corrections service is built HERE rather
       * than inside the session runtime because what it needs is the user data
       * path and the log, and because the controller only ever sees the narrow
       * `CorrectionsSeam` — it can hold frames and read cooldowns, and it has
       * no way to reach the store, the refit or the gate.
       */
      const corrections = createDeskCorrections({
        userDataDir,
        loadSettings: () => runtime.session.getSettings(),
        appendLog: (detail) => runtime.session.appendCorrectionLog(detail),
        push: (state) => broadcast(IPC_PUSH.CORRECTIONS_STATE, state),
        /**
         * A confirmed `away` the student says was wrong did not just stop the
         * clock — it wrote a drift into their focus history. Focus Plan's
         * command undoes exactly that one onset, and it arrives here as a
         * CALLBACK: the desk stack gains no import of the coaching layer and
         * the coaching layer gains none of the desk stack, which is the seam
         * `integration.test.ts` checks. A retraction that refuses names the
         * gate that refused it, and never costs the resume.
         */
        retractDrift: () => runtime.plan.retractLastAwayDrift(),
        /**
         * …and the deferred half. Injected for the same reason: the refit
         * loads the desk model and TensorFlow, and `CorrectionsStore` must be
         * able to write a JPEG without any of that. Note what is NOT wired —
         * there is no path from `CORRECTIONS_RECORD` to this function. One
         * click stores a photograph and a label; only this button fits
         * anything, and only the gate installs it.
         */
        refit: (options) =>
          createPersonalRefit({
            store: corrections.store(),
            userDataDir,
            deskModelId: () => runtime.session.getSettings().deskModelId,
            sessionActive: () => runtime.session.getState().sessionActive,
            appendLog: (detail: string) => runtime.session.appendCorrectionLog(detail),
          }).run(options),
        applyPersonalHead: applyPersonalAttentionHead,
      });
      // `attachCorrections` runs the controller's settings sync, which asks
      // the service which attention head should be running — so the desk model
      // is pointed at (or away from) the student's 51 numbers from here on,
      // including on every later settings change, without main holding a
      // second copy of that rule.
      runtime.session.attachCorrections(corrections);
      registerIpc(runtime.session, runtime.plugs, runtime.forecast, runtime.plan, corrections);

      app.on("browser-window-created", (_event, window) => {
        optimizer.watchWindowShortcuts(window);
      });

      createWindow();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    })
    .catch((error: unknown) => {
      // A failed startup (e.g. unwritable userData) must not leave a
      // headless, windowless process behind — say why and exit.
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("FocusPlug failed to start", message);
      app.quit();
    });
}

app.on("before-quit", (event) => {
  if (quitting || session === null) {
    return;
  }
  // Hold the quit until the session drains: an in-flight fuse kill and its
  // paired plug_off (Kasa TCP can take seconds), plus the kill/stop log
  // entries, must land before the process exits.
  event.preventDefault();
  quitting = true;
  const stopped = session.stop().then(
    () => undefined,
    () => undefined,
  );
  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, STOP_ON_QUIT_TIMEOUT_MS);
  });
  void Promise.race([stopped, deadline]).then(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
