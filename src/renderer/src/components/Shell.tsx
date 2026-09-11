import { useEffect, useState, type JSX } from "react";
import { parseRoute, routeHash, type RouteId, ROUTES } from "../lib/routes";
import { cn } from "../lib/cn";
import { decisionTone, sessionModeLabel } from "../lib/format";
import { Lamp, PrimaryButton, GhostButton } from "./ui";
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

  const tally =
    tone === "live" ? "bg-fp-live" : tone === "kill" ? "bg-fp-kill" : tone === "warn" ? "bg-fp-warn" : "bg-fp-line";

  return (
    <div className="flex h-full min-h-0 flex-col bg-fp-bg text-fp-ink">
      <header className="flex h-14 shrink-0 items-center gap-8 border-b border-fp-line px-5">
        <a href="#/" className="flex items-center gap-2.5 no-underline">
          <Lamp tone={tone} live={app.state.sessionActive} />
          <span className="font-display text-[17px] font-extrabold tracking-[-0.03em] text-fp-ink">
            FocusPlug
          </span>
        </a>

        <nav className="flex min-w-0 flex-1 items-center gap-0.5">
          {ROUTES.map((item) => {
            const active = route === item.id;
            return (
              <a
                key={item.id}
                href={routeHash(item.id)}
                className={cn(
                  "px-2.5 py-1 text-[13px] transition-colors",
                  active
                    ? "font-medium text-fp-ink"
                    : "text-fp-faint hover:text-fp-ink",
                )}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[11px] tracking-[0.08em] text-fp-faint sm:inline">
            {sessionModeLabel(app.state)}
          </span>
          {app.state.sessionActive ? (
            <GhostButton onClick={() => void app.stopSession()}>Stop</GhostButton>
          ) : (
            <PrimaryButton onClick={() => void app.startSession()}>Start session</PrimaryButton>
          )}
        </div>
      </header>

      <div className={cn("h-[2px] shrink-0", tally)} aria-hidden="true" />

      {app.error ? (
        <div className="border-b border-fp-kill/40 bg-fp-kill/10 px-6 py-2 text-[12px] text-fp-kill" role="alert">
          {app.error}
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-auto chassis-well bg-fp-well">
        {route === "session" ? <SessionPage /> : null}
        {route === "allowlist" ? <ListPage kind="allow" /> : null}
        {route === "blocklist" ? <ListPage kind="block" /> : null}
        {route === "plugs" ? <PlugsPage /> : null}
        {route === "settings" ? <SettingsPage /> : null}
        {route === "log" ? <LogPage /> : null}
      </main>

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
