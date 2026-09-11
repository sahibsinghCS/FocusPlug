import type { JSX } from "react";
import { IconMark, IconSidebar } from "../lib/icons";
import type { RouteId } from "../lib/routes";
import { ROUTES } from "../lib/routes";
import { useAppState } from "../state/AppState";
import { IconButton } from "./ui";
import { StatusCluster, useClock } from "./StatusCluster";

export function Titlebar(props: {
  route: RouteId;
  collapsed: boolean;
  onToggleSidebar: () => void;
}): JSX.Element {
  const app = useAppState();
  const clock = useClock();
  const current = ROUTES.find((item) => item.id === props.route);
  const pageLabel = current?.label ?? "Session";
  const pageHint = current?.hint ?? "Live enforcement";

  return (
    <header className="fp-titlebar flex items-center gap-3 px-2.5" role="banner">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <IconMark className="h-6 w-6 shrink-0 text-fp-lime" />
        <div className="min-w-0">
          <p className="flex items-baseline gap-2 leading-none">
            <span className="text-[13px] font-semibold tracking-tight">FocusPlug</span>
            {app.usingMock ? (
              <span className="sr-only">Using mock IPC</span>
            ) : null}
          </p>
        </div>
        <span className="hidden text-fp-faint sm:inline" aria-hidden="true">
          /
        </span>
        <p className="hidden min-w-0 sm:block">
          <span className="truncate text-[13px] font-medium text-fp-ink">{pageLabel}</span>
          <span className="ml-2 hidden text-[11px] text-fp-faint lg:inline">{pageHint}</span>
        </p>
      </div>

      <StatusCluster />

      <div className="flex shrink-0 items-center gap-1">
        <time className="hidden px-1 font-mono text-[11px] text-fp-faint tabular lg:inline">
          {clock}
        </time>
        <IconButton
          label={props.collapsed ? "Expand sidebar" : "Collapse sidebar"}
          tip={props.collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
          pressed={!props.collapsed}
          onClick={props.onToggleSidebar}
        >
          <IconSidebar className="h-4 w-4" />
        </IconButton>
      </div>
    </header>
  );
}