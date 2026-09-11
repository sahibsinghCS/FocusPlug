import type { JSX } from "react";
import { ROUTES, routeHash, type RouteId } from "../lib/routes";
import {
  IconAllow,
  IconBlock,
  IconChevron,
  IconLog,
  IconPlug,
  IconSession,
  IconSettings,
} from "../lib/icons";
import { cn } from "../lib/cn";

const ICONS: Record<RouteId, (props: { className?: string }) => JSX.Element> = {
  session: IconSession,
  allowlist: IconAllow,
  blocklist: IconBlock,
  plugs: IconPlug,
  settings: IconSettings,
  log: IconLog,
};

export function Sidebar(props: {
  route: RouteId;
  collapsed: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <aside
      className="fp-shell-nav flex shrink-0 flex-col border-r border-fp-line bg-fp-sidebar"
      data-collapsed={props.collapsed ? "true" : "false"}
      id="fp-sidebar"
    >
      <nav className="flex flex-1 flex-col gap-0.5 p-1.5" aria-label="Primary">
        {ROUTES.map((item) => {
          const Icon = ICONS[item.id];
          const active = props.route === item.id;
          return (
            <a
              key={item.id}
              href={routeHash(item.id)}
              aria-current={active ? "page" : undefined}
              aria-label={`${item.label}: ${item.hint}`}
              data-tip={props.collapsed ? `${item.label} — ${item.hint}` : undefined}
              className={cn(
                "fp-btn group relative flex items-center rounded-md text-[13px]",
                props.collapsed ? "h-9 justify-center" : "h-9 gap-2.5 px-2",
                active
                  ? "bg-white/[0.07] text-fp-ink"
                  : "text-fp-mute hover:bg-fp-hover hover:text-fp-ink",
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-1.5 h-6 w-0.5 rounded-full",
                  active ? "bg-fp-lime" : "bg-transparent",
                )}
                aria-hidden="true"
              />
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-fp-lime" : "text-current")} />
              {props.collapsed ? null : (
                <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="flex justify-center border-t border-fp-line p-1.5">
        <button
          type="button"
          onClick={props.onToggle}
          aria-expanded={!props.collapsed}
          aria-controls="fp-sidebar"
          aria-label={props.collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-tip={props.collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
          className="fp-btn flex h-8 w-full items-center justify-center rounded-md text-fp-faint hover:bg-fp-hover hover:text-fp-ink"
        >
          <IconChevron dir={props.collapsed ? "right" : "left"} className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}