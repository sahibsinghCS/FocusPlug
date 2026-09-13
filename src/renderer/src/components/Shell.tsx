import { useCallback, useEffect, useState, type JSX } from "react";
import { parseRoute, type RouteId, ROUTES, navigate } from "../lib/routes";
import { countdownIsPreview } from "../features/session/model";
import { useAppState } from "../state/AppState";
import { useSessionTimer } from "../features/timer/useSessionTimer";
import { shellView, viewIsLocked } from "../features/timer/view";
import { ErrorBanner } from "./page";
import { KillOverlay } from "../features/kill/KillOverlay";
import { NudgeOverlay } from "../features/nudge/NudgeOverlay";
import { TopRail } from "./TopRail";
import { SetupPage } from "../pages/SetupPage";
import { SessionPage } from "../pages/SessionPage";
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
  // Lock is a *view* of a live session, not the session itself. Enforcement is
  // armed exactly while the plan runs, so deriving the lock from the lifecycle
  // alone is what would make the live console unreachable in the shipped app.
  const view = shellView({
    status: timer.status,
    consoleOpen: timer.consoleOpen,
    sessionActive: app.state.sessionActive,
  });
  const locked = viewIsLocked(view);

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
            {/* One route, two states. The plan is what you edit before the
                lock goes on; a live session you have stepped out of lock mode
                to see becomes the console — decision, forecast, sensors,
                timeline. Lock mode itself is the full-screen LockPage above,
                and `Console` there is the door between them. */}
            {route === "session" ? (
              view === "console" ? (
                <SessionPage onLock={timer.status === "setup" ? undefined : timer.closeConsole} />
              ) : (
                <SetupPage timer={timer} />
              )
            ) : null}
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
          preview={countdownIsPreview(app.state.countdownSec)}
          onDemoKill={() => {
            void app.demoKill();
          }}
          onDismiss={app.dismissPreview}
        />
      ) : null}

      {app.nudge ? (
        <NudgeOverlay nudge={app.nudge} position={timer.position} onDismiss={app.dismissNudge} />
      ) : null}
    </div>
  );
}
