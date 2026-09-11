import { useMemo, useState, type JSX } from "react";
import { formatClock } from "../lib/format";
import { cn } from "../lib/cn";
import { useAppState } from "../state/AppState";
import { PageIntro, TextInput } from "../components/ui";

export function LogPage(): JSX.Element {
  const app = useAppState();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return app.log;
    }
    return app.log.filter(
      (event) =>
        event.kind.toLowerCase().includes(needle) ||
        event.detail.toLowerCase().includes(needle),
    );
  }, [app.log, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageIntro
        kicker="Timeline"
        title="Session log"
        meta={
          <div className="w-56">
            <TextInput value={query} onChange={setQuery} placeholder="Filter events" />
          </div>
        }
      />

      {rows.length === 0 ? (
        <p className="px-7 py-8 text-[13px] text-fp-mute">
          No events yet. Start a session to record window, desk, and kill activity.
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-auto">
          {rows.map((event, index) => (
            <li
              key={`${event.ts}-${event.kind}-${index}`}
              className={cn(
                "grid grid-cols-[88px_92px_1fr] gap-3 px-7 py-2",
                index % 2 === 1 && "bg-white/[0.015]",
              )}
            >
              <time className="font-mono text-[11px] text-fp-faint tabular">
                {formatClock(event.ts)}
              </time>
              <span
                className={cn(
                  "font-mono text-[11px] font-medium",
                  event.kind.toLowerCase().includes("kill") ? "text-fp-kill" : "text-fp-mute",
                )}
              >
                {event.kind}
              </span>
              <span className="truncate text-[13px] text-fp-ink" title={event.detail}>
                {event.detail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
