import { useEffect, useState, type JSX } from "react";
import { IconMark } from "../lib/icons";
import { formatHmClock } from "../lib/format";
import { ROUTES, routeHash, type RouteId } from "../lib/routes";
import { cn } from "../lib/cn";
import { StatusCluster } from "./StatusCluster";

/**
 * The only chrome the app keeps. It holds the window drag region, so it stays
 * even in lock mode — but the live status readouts only appear on the pages
 * where they are the point, never over the session plan.
 */
export function TopRail(props: { route: RouteId; showStatus: boolean }): JSX.Element {
  const clock = useClock();

  return (
    <header className="fp-rail flex items-center gap-4 px-3" role="banner">
      <a
        href={routeHash("session")}
        className="fp-btn flex shrink-0 items-center gap-2 rounded-md px-1 py-1 text-fp-ink hover:text-fp-focus"
        aria-label="FocusPlug — session plan"
      >
        <IconMark className="h-[22px] w-[22px] text-fp-focus" />
        <span className="fp-display hidden text-[14px] font-semibold tracking-[-0.01em] sm:inline">
          FocusPlug
        </span>
      </a>

      <nav className="flex min-w-0 flex-1 items-center gap-0.5" aria-label="Primary">
        {ROUTES.map((item) => {
          const active = props.route === item.id;
          return (
            <a
              key={item.id}
              href={routeHash(item.id)}
              aria-current={active ? "page" : undefined}
              data-tip={item.hint}
              className={cn(
                "fp-btn relative shrink-0 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium",
                active ? "text-fp-ink" : "text-fp-faint hover:bg-fp-hover hover:text-fp-mute",
              )}
            >
              {item.label}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-2.5 -bottom-px h-px rounded-full",
                  active ? "bg-fp-focus" : "bg-transparent",
                )}
              />
            </a>
          );
        })}
      </nav>

      {props.showStatus ? <StatusCluster /> : null}

      <time className="hidden shrink-0 font-mono text-[11px] text-fp-faint tabular md:inline">
        {clock}
      </time>
    </header>
  );
}

export function useClock(): string {
  const [now, setNow] = useState(() => formatHmClock(Date.now()));

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(formatHmClock(Date.now()));
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  return now;
}
