import { useEffect, useState, type JSX } from "react";
import { parseRoute, routeHash, type RouteId, ROUTES } from "../lib/routes";
import { IconMark } from "../lib/icons";
import { cn } from "../lib/cn";
import { decisionTone, sessionModeLabel } from "../lib/format";
import { Led } from "./ui";
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

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-fp-bg text-fp-ink">
      <button
        type="button"
        className="skip-link"
        onClick={() => {
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </button>
      <div className="fp-grain" aria-hidden="true" />

      <header className="flex h-16 shrink-0 items-stretch border-b border-fp-line bg-fp-sidebar">
        <div className="flex w-[200px] shrink-0 items-center gap-2.5 border-r border-fp-line px-4">
          <IconMark className="h-7 w-7 text-fp-lime" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold tracking-tight">FocusPlug</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fp-faint">
              Enforcer
            </p>
          </div>
        </div>

        <nav className="flex min-w-0 flex-1 items-stretch overflow-x-auto" aria-label="Primary">
          {ROUTES.map((item) => {
            const active = route === item.id;
            return (
              <a
                key={item.id}
                href={routeHash(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex shrink-0 items-center px-4 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  active ? "text-fp-ink" : "text-fp-mute hover:bg-fp-hover hover:text-fp-ink",
                )}
              >
                {item.label}
                {active ? (
                  <span className="absolute inset-x-3 bottom-0 h-0.5 bg-fp-lime" aria-hidden="true" />
                ) : null}
              </a>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2.5 border-l border-fp-line px-4">
          <Led
            tone={app.state.sessionActive ? decisionTone(app.state.decision) : "mute"}
            live={app.state.sessionActive}
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fp-faint">
            {sessionModeLabel(app.state)}
          </span>
          <span className="font-mono text-[11px] text-fp-mute">{app.state.decision}</span>
        </div>
      </header>

      {app.error ? (
        <div
          className="flex items-center justify-between gap-4 border-b border-fp-red/40 bg-fp-red/10 px-6 py-2 text-[12px] text-fp-red"
          role="alert"
        >
          <p>{app.error}</p>
          <button
            type="button"
            onClick={() => app.clearError()}
            className="text-[12px] font-medium text-fp-ink hover:text-fp-red"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <main
        id="main"
        tabIndex={-1}
        className="relative z-0 min-h-0 flex-1 overflow-auto outline-none"
      >
        {!app.ready ? <ShellSkeleton /> : null}
        {app.ready && route === "session" ? <SessionPage /> : null}
        {app.ready && route === "allowlist" ? <ListPage kind="allow" /> : null}
        {app.ready && route === "blocklist" ? <ListPage kind="block" /> : null}
        {app.ready && route === "plugs" ? <PlugsPage /> : null}
        {app.ready && route === "settings" ? <SettingsPage /> : null}
        {app.ready && route === "log" ? <LogPage /> : null}
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

function ShellSkeleton(): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading FocusPlug">
      <div className="grid grid-cols-1 gap-px border-b border-fp-line bg-fp-line lg:grid-cols-[1.4fr_0.8fr]">
        <div className="bg-fp-bg p-6">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton mt-4 h-14 w-64" />
          <div className="skeleton mt-3 h-3 w-80" />
        </div>
        <div className="bg-fp-bg p-6">
          <div className="skeleton ml-auto h-3 w-20" />
          <div className="skeleton ml-auto mt-4 h-14 w-24" />
        </div>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-px bg-fp-line lg:grid-cols-3">
        <div className="skeleton min-h-[120px] bg-fp-bg" />
        <div className="skeleton min-h-[120px] bg-fp-bg" />
        <div className="skeleton min-h-[120px] bg-fp-bg" />
      </div>
    </div>
  );
}
