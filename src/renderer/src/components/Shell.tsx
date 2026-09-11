import { useEffect, useState, type JSX } from "react";
import { parseRoute, routeHash, type RouteId, ROUTES } from "../lib/routes";
import {
  IconAllow,
  IconBlock,
  IconLog,
  IconMark,
  IconPlug,
  IconSession,
  IconSettings,
} from "../lib/icons";
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

const ICONS: Record<RouteId, (props: { className?: string }) => JSX.Element> = {
  session: IconSession,
  allowlist: IconAllow,
  blocklist: IconBlock,
  plugs: IconPlug,
  settings: IconSettings,
  log: IconLog,
};

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
    <div className="flex h-full min-h-0 bg-fp-bg text-fp-ink">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-fp-line bg-fp-sidebar">
        <div className="flex items-center gap-2.5 px-4 py-5">
          <IconMark className="h-8 w-8 text-fp-lime" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold tracking-tight">FocusPlug</p>
            <p className="text-[11px] text-fp-faint">Study session enforcer</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {ROUTES.map((item) => {
            const Icon = ICONS[item.id];
            const active = route === item.id;
            return (
              <a
                key={item.id}
                href={routeHash(item.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition",
                  active
                    ? "bg-white/5 text-fp-ink"
                    : "text-fp-mute hover:bg-white/[0.03] hover:text-fp-ink",
                )}
              >
                <span
                  className={cn(
                    "h-4 w-0.5 rounded-full",
                    active ? "bg-fp-lime" : "bg-transparent",
                  )}
                />
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{item.label}</span>
                  <span className={cn("text-[11px]", active ? "text-fp-faint" : "text-zinc-600")}>
                    {item.hint}
                  </span>
                </span>
              </a>
            );
          })}
        </nav>

        <div className="border-t border-fp-line px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] text-fp-faint">
            <Led
              tone={app.state.sessionActive ? decisionTone(app.state.decision) : "mute"}
              live={app.state.sessionActive}
            />
            <span className="uppercase tracking-[0.16em]">
              {sessionModeLabel(app.state)}
            </span>
            <span className="ml-auto font-mono text-[10px] text-fp-faint">
              {app.state.decision}
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {app.error ? (
          <div className="border-b border-fp-red/30 bg-fp-red/10 px-6 py-2 text-[12px] text-fp-red" role="alert">
            {app.error}
          </div>
        ) : null}
        <main className="min-h-0 flex-1 overflow-auto">
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
