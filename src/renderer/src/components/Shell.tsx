import { useEffect, useState, type JSX } from "react";
import { parseRoute, routeHash, type RouteId, ROUTES } from "../lib/routes";
import { cn } from "../lib/cn";
import { atmosphereFromSession, decisionTone, sessionModeLabel } from "../lib/format";
import { GhostButton, PrimaryButton } from "./ui";
import { useAppState } from "../state/AppState";
import { CountdownOverlay } from "./CountdownOverlay";
import { SessionPage } from "../pages/SessionPage";
import { ListPage } from "../pages/ListPage";
import { SettingsPage } from "../pages/SettingsPage";
import { PlugsPage } from "../pages/PlugsPage";
import { LogPage } from "../pages/LogPage";

export function Shell(): JSX.Element {
  const app = useAppState();
  const [route, setRoute] = useState<RouteId>(() => parseRoute(window.location.hash));
  const tone = app.state.sessionActive ? decisionTone(app.state.decision) : "mute";
  const atmosphere = atmosphereFromSession(
    app.state.sessionActive,
    app.state.decision,
    Boolean(app.countdown),
  );

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

  const chipClass =
    tone === "live" ? "tone-live" : tone === "kill" ? "tone-kill" : tone === "warn" ? "tone-warn" : "tone-mute";

  return (
    <div className="app-root" data-decision={atmosphere}>
      <div className="chassis">
        <header className="bezel">
          <a href="#/" className="mark">
            <span className="mark-word">FocusPlug</span>
            <span className="mark-tag">local</span>
          </a>

          <nav className="seg" aria-label="Primary">
            <div className="seg-track">
              {ROUTES.map((item) => {
                const active = route === item.id;
                return (
                  <a
                    key={item.id}
                    href={routeHash(item.id)}
                    className={cn("seg-link", active && "is-on")}
                  >
                    {item.label}
                  </a>
                );
              })}
            </div>
          </nav>

          <div className="session-actions">
            <span className={cn("session-chip", chipClass)}>
              <span className="session-chip-dot" />
              {sessionModeLabel(app.state)}
            </span>
            {app.state.sessionActive ? (
              <GhostButton onClick={() => void app.stopSession()}>Stop</GhostButton>
            ) : (
              <PrimaryButton onClick={() => void app.startSession()}>Start session</PrimaryButton>
            )}
          </div>
        </header>

        <div className="tally" aria-hidden="true" />

        {app.error ? (
          <div className="alert" role="alert">
            {app.error}
          </div>
        ) : null}

        <main className="deck">
          {route === "session" ? <SessionPage /> : null}
          {route === "allowlist" ? <ListPage kind="allow" /> : null}
          {route === "blocklist" ? <ListPage kind="block" /> : null}
          {route === "plugs" ? <PlugsPage /> : null}
          {route === "settings" ? <SettingsPage /> : null}
          {route === "log" ? <LogPage /> : null}
        </main>
      </div>

      {app.countdown ? (
        <CountdownOverlay
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
