import { useCallback, useEffect, useState, type JSX } from "react";
import { parseRoute, type RouteId, ROUTES, navigate } from "../lib/routes";
import { useAppState } from "../state/AppState";
import { useSessionTimer } from "../features/timer/useSessionTimer";
import { ErrorBanner } from "./page";
import { KillOverlay } from "../features/kill/KillOverlay";
import { TopRail } from "./TopRail";
import { SetupPage } from "../pages/SetupPage";
import { LockPage } from "../pages/LockPage";
import { ListPage } from "../pages/ListPage";
import { SettingsPage } from "../pages/SettingsPage";
import { PlugsPage } from "../pages/PlugsPage";
import { LogPage } from "../pages/LogPage";

function useHashRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHash = (): void => {
      setRoute(parseRoute(window.location.hash));
    };
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) {
      window.location.hash = "#/";
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return route;
}

export function Shell(): JSX.Element {
  const app = useAppState();
  const route = useHashRoute();
  const { startSession, stopSession } = app;

  // The plan is what arms enforcement: focus blocks start a real session,
  // breaks and pauses stop it, so a break genuinely hands Discord back.
  const onEnforce = useCallback(
    (armed: boolean): void => {
      if (armed) {
        void startSession();
      } else {
        void stopSession();
      }
    },
    [startSession, stopSession],
  );

  const timer = useSessionTimer({ onEnforce });
  const locked = timer.status !== "setup";

  useEffect(() => {
    if (locked) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey && event.key >= "1" && event.key <= "6") {
        const target = ROUTES[Number(event.key) - 1];
        if (target) {
          event.preventDefault();
          navigate(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-fp-bg text-fp-ink">
      {locked ? (
        <LockPage timer={timer} />
      ) : (
        <>
          <a href="#fp-main" className="fp-skip">
            Skip to main
          </a>
          <TopRail route={route} showStatus={route !== "session"} />
          {app.error && route !== "session" && route !== "log" ? (
            <div className="fp-page-x py-2">
              <ErrorBanner message={app.error} onDismiss={app.clearError} />
            </div>
          ) : null}
          <main id="fp-main" className="min-h-0 min-w-0 flex-1 overflow-auto" tabIndex={-1}>
            {route === "session" ? <SetupPage timer={timer} /> : null}
            {route === "allowlist" ? <ListPage kind="allow" /> : null}
            {route === "blocklist" ? <ListPage kind="block" /> : null}
            {route === "plugs" ? <PlugsPage /> : null}
            {route === "settings" ? <SettingsPage /> : null}
            {route === "log" ? <LogPage /> : null}
          </main>
        </>
      )}

      {app.countdown ? (
        <KillOverlay
          seconds={app.countdown.seconds}
          total={app.countdown.total}
          reason={app.countdown.reason}
          state={app.state}
          plugs={app.plugs}
          onDemoKill={() => {
            void app.demoKill();
          }}
        />
      ) : null}
    </div>
  );
}
