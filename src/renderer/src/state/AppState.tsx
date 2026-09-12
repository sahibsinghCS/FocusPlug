import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import type {
  AppLists,
  AppSettings,
  DeskModelId,
  KillResult,
  NudgeEvent,
  NudgeKind,
  PlugDevice,
  PlugProtocol,
  PlugSnapshot,
  PolicyEvent,
  SessionEvent,
  SessionState,
} from "@shared/ipc";
import type { AppEntry } from "@shared/types";
import { DEFAULT_SESSION_STATE, DEFAULT_SETTINGS } from "@shared/defaults";
import { getApi } from "../lib/api";
import { newEntryId } from "../lib/ids";
import {
  looksLikeStudyPc,
  mergePlugViews,
  STUDY_PC_WARNING,
  type PlugView,
} from "../lib/plugsUi";
import { readUrlScene } from "../lib/urlScene";

export interface LocalCountdown {
  seconds: number;
  reason: string;
  total: number;
}

export interface PlugDraft {
  name: string;
  address: string;
  protocol: PlugProtocol;
}

interface AppStateValue {
  ready: boolean;
  usingMock: boolean;
  state: SessionState;
  lists: AppLists;
  settings: AppSettings;
  plugs: PlugView[];
  log: SessionEvent[];
  error: string | null;
  killResult: KillResult | null;
  countdown: LocalCountdown | null;
  /** The latest drift nudge from main, until dismissed. */
  nudge: NudgeEvent | null;
  dismissNudge: () => void;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  demoKill: () => Promise<void>;
  demoNudge: (kind: NudgeKind) => Promise<void>;
  setAllowlist: (entries: AppEntry[]) => Promise<AppLists>;
  setBlocklist: (entries: AppEntry[]) => Promise<AppLists>;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setDeskEnabled: (enabled: boolean) => Promise<void>;
  setDeskModelId: (id: DeskModelId) => Promise<DeskModelId>;
  addPlug: (draft: PlugDraft) => Promise<PlugDevice[]>;
  removePlug: (deviceId: string) => Promise<PlugDevice[]>;
  setPlugEnabled: (deviceId: string, enabled: boolean) => Promise<PlugDevice[]>;
  testPlug: (deviceId: string, powerOn: boolean) => Promise<PlugSnapshot>;
  previewCountdown: (seconds: number, reason: string) => void;
  clearError: () => void;
}

const EMPTY_LISTS: AppLists = { allowlist: [], blocklist: [] };

const AppStateContext = createContext<AppStateValue | null>(null);

function applyPlugPower(
  current: Record<string, PlugSnapshot>,
  deviceIds: readonly string[],
  powerOn: boolean,
): Record<string, PlugSnapshot> {
  const next = { ...current };
  const ts = Date.now();
  for (const deviceId of deviceIds) {
    const existing = next[deviceId];
    next[deviceId] = {
      ts,
      deviceId,
      online: true,
      powerOn,
      error: existing?.error,
    };
  }
  return next;
}

export function AppStateProvider(props: { children: ReactNode }): JSX.Element {
  const { api, usingMock } = useMemo(() => getApi(), []);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SessionState>(DEFAULT_SESSION_STATE);
  const [lists, setLists] = useState<AppLists>(EMPTY_LISTS);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [plugSnapshots, setPlugSnapshots] = useState<Record<string, PlugSnapshot>>({});
  const [log, setLog] = useState<SessionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [killResult, setKillResult] = useState<KillResult | null>(null);
  const [localCountdown, setLocalCountdown] = useState<LocalCountdown | null>(null);
  const [nudge, setNudge] = useState<NudgeEvent | null>(null);
  const localTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearLocalTimer = useCallback((): void => {
    if (localTimer.current !== null) {
      clearInterval(localTimer.current);
      localTimer.current = null;
    }
  }, []);

  const previewCountdown = useCallback(
    (seconds: number, reason: string): void => {
      if (seconds <= 0) {
        throw new Error("Countdown preview requires a positive duration");
      }
      clearLocalTimer();
      setLocalCountdown({ seconds, reason, total: seconds });
      localTimer.current = setInterval(() => {
        setLocalCountdown((current) => {
          if (!current) {
            return null;
          }
          if (current.seconds <= 1) {
            clearLocalTimer();
            return null;
          }
          return { ...current, seconds: current.seconds - 1 };
        });
      }, 1000);
    },
    [clearLocalTimer],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [nextState, nextLists, nextSettings, nextLog, listedPlugs] = await Promise.all([
          api.sessionGetState(),
          api.listsGet(),
          api.settingsGet(),
          api.logGet(),
          api.plugsList(),
        ]);
        if (cancelled) {
          return;
        }
        setState(nextState);
        setLists(nextLists);
        setSettings({
          ...nextSettings,
          plugs: listedPlugs,
        });
        setLog(nextLog);
        setReady(true);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Failed to load FocusPlug state");
          setReady(true);
        }
      }
    })();

    const unsubState = api.onSessionState(setState);
    const unsubFocus = api.onFocusSnapshot((focus) => {
      setState((current) => ({ ...current, focus }));
    });
    const unsubDesk = api.onDeskSnapshot((desk) => {
      setState((current) => ({ ...current, desk }));
    });
    const unsubLog = api.onSessionEvent((event) => {
      setLog((current) => [event, ...current].slice(0, 400));
    });
    const unsubPolicy = api.onPolicyEvent((event: PolicyEvent) => {
      if (event.type === "start_countdown") {
        clearLocalTimer();
        setLocalCountdown(null);
      }
      if (event.type === "cancel_countdown" || event.type === "kill" || event.type === "unlock") {
        clearLocalTimer();
        setLocalCountdown(null);
      }
      if (event.type === "plug_off") {
        setPlugSnapshots((current) => applyPlugPower(current, event.deviceIds, false));
      }
      if (event.type === "plug_on") {
        setPlugSnapshots((current) => applyPlugPower(current, event.deviceIds, true));
      }
    });

    const unsubNudge = api.onNudge(setNudge);

    const scene = readUrlScene();
    if (!usingMock && scene.countdown !== null) {
      if (scene.freeze) {
        setLocalCountdown({
          seconds: scene.countdown,
          reason: "Distracted: Discord",
          total: scene.countdown,
        });
      } else {
        previewCountdown(scene.countdown, "Distracted: Discord");
      }
    }

    return () => {
      cancelled = true;
      unsubState();
      unsubFocus();
      unsubDesk();
      unsubLog();
      unsubPolicy();
      unsubNudge();
      clearLocalTimer();
    };
  }, [api, clearLocalTimer, previewCountdown, usingMock]);

  const run = useCallback(async (task: () => Promise<void>, fallback: string): Promise<void> => {
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    }
  }, []);

  const runWithResult = useCallback(
    async <T,>(task: () => Promise<T>, fallback: string): Promise<T> => {
      setError(null);
      try {
        return await task();
      } catch (caught) {
        const message = caught instanceof Error && caught.message.trim().length > 0
          ? caught.message
          : fallback;
        setError(message);
        throw caught instanceof Error ? caught : new Error(message);
      }
    },
    [],
  );

  const startSession = useCallback(async (): Promise<void> => {
    await run(async () => {
      setState(await api.sessionStart());
    }, "Failed to start session");
  }, [api, run]);

  const stopSession = useCallback(async (): Promise<void> => {
    await run(async () => {
      clearLocalTimer();
      setLocalCountdown(null);
      setState(await api.sessionStop());
    }, "Failed to stop session");
  }, [api, clearLocalTimer, run]);

  const demoKill = useCallback(async (): Promise<void> => {
    await run(async () => {
      const result = await api.demoKill();
      setKillResult(result);
      clearLocalTimer();
      setLocalCountdown(null);
    }, "Demo Kill failed");
  }, [api, clearLocalTimer, run]);

  const setAllowlist = useCallback(
    async (entries: AppEntry[]): Promise<AppLists> => {
      return await runWithResult(async () => {
        const next = await api.listsSetAllow(entries);
        setLists(next);
        return next;
      }, "Failed to save allowlist");
    },
    [api, runWithResult],
  );

  const setBlocklist = useCallback(
    async (entries: AppEntry[]): Promise<AppLists> => {
      return await runWithResult(async () => {
        const next = await api.listsSetBlock(entries);
        setLists(next);
        return next;
      }, "Failed to save blocklist");
    },
    [api, runWithResult],
  );

  const patchSettings = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      await run(async () => {
        setSettings(await api.settingsSet(patch));
      }, "Failed to save settings");
    },
    [api, run],
  );

  const setDeskEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      await run(async () => {
        const webcamEnabled = await api.deskSetEnabled(enabled);
        setSettings((current) => ({ ...current, webcamEnabled }));
        setState((current) =>
          current.desk
            ? { ...current, desk: { ...current.desk, webcamEnabled } }
            : current,
        );
      }, "Failed to update desk AI");
    },
    [api, run],
  );

  const setDeskModelId = useCallback(
    async (id: DeskModelId): Promise<DeskModelId> => {
      return await runWithResult(async () => {
        const deskModelId = await api.deskSetModelId(id);
        setSettings((current) => ({ ...current, deskModelId }));
        return deskModelId;
      }, "Failed to save desk model");
    },
    [api, runWithResult],
  );

  const addPlug = useCallback(
    async (draft: PlugDraft): Promise<PlugDevice[]> => {
      return await runWithResult(async () => {
        if (looksLikeStudyPc(draft.name)) {
          throw new Error(STUDY_PC_WARNING);
        }
        const device: PlugDevice = {
          id: newEntryId("plug"),
          name: draft.name.trim(),
          address: draft.address.trim(),
          protocol: draft.protocol,
          enabled: true,
          isStudyPc: false,
        };
        const plugs = await api.plugsAdd(device);
        setSettings((current) => ({ ...current, plugs }));
        return plugs;
      }, "Failed to add plug");
    },
    [api, runWithResult],
  );

  const removePlug = useCallback(
    async (deviceId: string): Promise<PlugDevice[]> => {
      return await runWithResult(async () => {
        const plugs = await api.plugsRemove(deviceId);
        setSettings((current) => ({ ...current, plugs }));
        setPlugSnapshots((current) => {
          const next = { ...current };
          delete next[deviceId];
          return next;
        });
        return plugs;
      }, "Failed to remove plug");
    },
    [api, runWithResult],
  );

  const setPlugEnabled = useCallback(
    async (deviceId: string, enabled: boolean): Promise<PlugDevice[]> => {
      return await runWithResult(async () => {
        const plugs = settings.plugs.map((plug) =>
          plug.id === deviceId ? { ...plug, enabled, isStudyPc: false as const } : plug,
        );
        const next = await api.settingsSet({ plugs });
        setSettings(next);
        return next.plugs;
      }, "Failed to update plug");
    },
    [api, runWithResult, settings.plugs],
  );

  const testPlug = useCallback(
    async (deviceId: string, powerOn: boolean): Promise<PlugSnapshot> => {
      return await runWithResult(async () => {
        const snap = await api.plugsTest(deviceId);
        setPlugSnapshots((current) => ({
          ...current,
          [deviceId]: snap,
        }));
        return snap;
      }, powerOn ? "Failed to test plug on" : "Failed to test plug off");
    },
    [api, runWithResult],
  );

  const dismissNudge = useCallback((): void => setNudge(null), []);

  const demoNudge = useCallback(
    async (kind: NudgeKind): Promise<void> => {
      await run(async () => {
        await api.demoNudge(kind);
      }, "Failed to test the nudge");
    },
    [api, run],
  );

  const countdown = useMemo((): LocalCountdown | null => {
    if (state.countdownSec > 0) {
      return {
        seconds: state.countdownSec,
        reason: state.detail,
        total: Math.max(state.countdownSec, settings.countdownSec),
      };
    }
    return localCountdown;
  }, [localCountdown, settings.countdownSec, state.countdownSec, state.detail]);

  const plugs = useMemo(
    (): PlugView[] => mergePlugViews(settings.plugs, plugSnapshots),
    [plugSnapshots, settings.plugs],
  );

  const value = useMemo(
    (): AppStateValue => ({
      ready,
      usingMock,
      state,
      lists,
      settings,
      plugs,
      log,
      error,
      killResult,
      countdown,
      nudge,
      dismissNudge,
      demoNudge,
      startSession,
      stopSession,
      demoKill,
      setAllowlist,
      setBlocklist,
      patchSettings,
      setDeskEnabled,
      setDeskModelId,
      addPlug,
      removePlug,
      setPlugEnabled,
      testPlug,
      previewCountdown,
      clearError: () => setError(null),
    }),
    [
      addPlug,
      countdown,
      demoKill,
      error,
      killResult,
      lists,
      log,
      nudge,
      dismissNudge,
      demoNudge,
      patchSettings,
      plugs,
      previewCountdown,
      ready,
      removePlug,
      setAllowlist,
      setBlocklist,
      setDeskEnabled,
      setDeskModelId,
      setPlugEnabled,
      settings,
      startSession,
      state,
      stopSession,
      testPlug,
      usingMock,
    ],
  );

  return <AppStateContext.Provider value={value}>{props.children}</AppStateContext.Provider>;
}

export function useOptionalAppState(): AppStateValue | null {
  return useContext(AppStateContext);
}

export function useAppState(): AppStateValue {
  const value = useOptionalAppState();
  if (!value) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return value;
}
