import { useMemo, useState, type JSX } from "react";
import { formatClock } from "../lib/format";
import { cn } from "../lib/cn";
import { useAppState } from "../state/AppState";
import { TextInput } from "../components/ui";

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
      <header className="flex items-end justify-between gap-4 border-b border-fp-line px-6 py-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">
            Timeline
          </p>
          <h1 className="mt-1 text-[17px] font-semibold tracking-tight">Session log</h1>
        </div>
        <div className="w-56">
          <TextInput value={query} onChange={setQuery} placeholder="Filter events" />
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="px-6 py-8 text-[13px] text-fp-mute">
          No events yet. Start a session to record window, desk, and kill activity.
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-auto">
          {rows.map((event, index) => (
            <li
              key={`${event.ts}-${event.kind}-${index}`}
              className="grid grid-cols-[88px_92px_1fr] gap-3 border-b border-fp-line px-6 py-2"
            >
              <time className="font-mono text-[11px] text-fp-faint tabular">
                {formatClock(event.ts)}
              </time>
              <span
                className={cn(
                  "font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
                  event.kind.toLowerCase().includes("kill") ? "text-fp-red" : "text-fp-mute",
                )}
              >
                {event.kind}
              </span>
              <span className="truncate text-[13px] text-fp-ink/80" title={event.detail}>
                {event.detail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
