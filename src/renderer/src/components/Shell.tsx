import { useCallback, useEffect, useState, type JSX } from "react";
import { parseRoute, type RouteId, ROUTES, navigate } from "../lib/routes";
import { loadCollapsedPref, persistCollapsedPref, resolveSidebarCollapsed } from "../lib/shellPref";
import { useAppState } from "../state/AppState";
import { CountdownOverlay } from "./CountdownOverlay";
import { Titlebar } from "./Titlebar";
import { Sidebar } from "./Sidebar";
import { SessionPage } from "../pages/SessionPage";
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

function useSidebarCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [pref, setPref] = useState<boolean | null>(() => loadCollapsedPref());
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = (): void => {
      setWidth(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const collapsed = resolveSidebarCollapsed(pref, width);

  const toggle = useCallback((): void => {
    const next = !resolveSidebarCollapsed(pref, window.innerWidth);
    setPref(next);
    persistCollapsedPref(next);
  }, [pref]);

  return { collapsed, toggle };
}

export function Shell(): JSX.Element {
  const app = useAppState();
  const route = useHashRoute();
  const sidebar = useSidebarCollapsed();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "b") {
        event.preventDefault();
        sidebar.toggle();
        return;
      }
      if (event.altKey && event.key >= "1" && event.key <= "6") {
        const index = Number(event.key) - 1;
        const target = ROUTES[index];
        if (target) {
          event.preventDefault();
          navigate(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebar.toggle]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-fp-bg text-fp-ink">
      <a href="#fp-main" className="fp-skip">
        Skip to main
      </a>
      <Titlebar
        route={route}
        collapsed={sidebar.collapsed}
        onToggleSidebar={sidebar.toggle}
      />
      {app.error ? (
        <div
          className="flex items-center justify-between gap-3 border-b border-fp-red/30 bg-fp-red/10 px-4 py-1.5 text-[12px] text-fp-red"
          role="alert"
        >
          <p className="min-w-0 truncate">{app.error}</p>
          <button
            type="button"
            className="fp-btn shrink-0 rounded px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] hover:bg-fp-red/15"
            onClick={() => app.clearError()}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        <Sidebar
          route={route}
          collapsed={sidebar.collapsed}
          onToggle={sidebar.toggle}
        />
        <main
          id="fp-main"
          className="min-h-0 min-w-0 flex-1 overflow-auto"
          tabIndex={-1}
        >
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