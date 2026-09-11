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
  KillResult,
  PolicyEvent,
  SessionEvent,
  SessionState,
} from "@shared/ipc";
import type { AppEntry } from "@shared/types";
import { DEFAULT_SESSION_STATE, DEFAULT_SETTINGS } from "@shared/defaults";
import { getApi } from "../lib/api";
import { readUrlScene } from "../lib/urlScene";

export interface LocalCountdown {
  seconds: number;
  reason: string;
  total: number;
}

interface AppStateValue {
  ready: boolean;
  usingMock: boolean;
  state: SessionState;
  lists: AppLists;
  settings: AppSettings;
  log: SessionEvent[];
  error: string | null;
  killResult: KillResult | null;
  countdown: LocalCountdown | null;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  demoKill: () => Promise<void>;
  setAllowlist: (entries: AppEntry[]) => Promise<void>;
  setBlocklist: (entries: AppEntry[]) => Promise<void>;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setDeskEnabled: (enabled: boolean) => Promise<void>;
  previewCountdown: (seconds: number, reason: string) => void;
  clearError: () => void;
}

const EMPTY_LISTS: AppLists = { allowlist: [], blocklist: [] };

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider(props: { children: ReactNode }): JSX.Element {
  const { api, usingMock } = useMemo(() => getApi(), []);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SessionState>(DEFAULT_SESSION_STATE);
  const [lists, setLists] = useState<AppLists>(EMPTY_LISTS);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [log, setLog] = useState<SessionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [killResult, setKillResult] = useState<KillResult | null>(null);
  const [localCountdown, setLocalCountdown] = useState<LocalCountdown | null>(null);
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
        const [nextState, nextLists, nextSettings, nextLog] = await Promise.all([
          api.sessionGetState(),
          api.listsGet(),
          api.settingsGet(),
          api.logGet(),
        ]);
        if (cancelled) {
          return;
        }
        setState(nextState);
        setLists(nextLists);
        setSettings(nextSettings);
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
    });

    const scene = readUrlScene();
    if (!usingMock && scene.countdown !== null) {
      previewCountdown(scene.countdown, "Distracted: Discord");
    }

    return () => {
      cancelled = true;
      unsubState();
      unsubFocus();
      unsubDesk();
      unsubLog();
      unsubPolicy();
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
    async (entries: AppEntry[]): Promise<void> => {
      await run(async () => {
        setLists(await api.listsSetAllow(entries));
      }, "Failed to save allowlist");
    },
    [api, run],
  );

  const setBlocklist = useCallback(
    async (entries: AppEntry[]): Promise<void> => {
      await run(async () => {
        setLists(await api.listsSetBlock(entries));
      }, "Failed to save blocklist");
    },
    [api, run],
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

  const value = useMemo(
    (): AppStateValue => ({
      ready,
      usingMock,
      state,
      lists,
      settings,
      log,
      error,
      killResult,
      countdown,
      startSession,
      stopSession,
      demoKill,
      setAllowlist,
      setBlocklist,
      patchSettings,
      setDeskEnabled,
      previewCountdown,
      clearError: () => setError(null),
    }),
    [
      countdown,
      demoKill,
      error,
      killResult,
      lists,
      log,
      patchSettings,
      previewCountdown,
      ready,
      setAllowlist,
      setBlocklist,
      setDeskEnabled,
      settings,
      startSession,
      state,
      stopSession,
      usingMock,
    ],
  );

  return <AppStateContext.Provider value={value}>{props.children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return value;
}
