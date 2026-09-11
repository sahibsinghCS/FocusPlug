import { useMemo, useState, type JSX } from "react";
import { formatClock } from "../lib/format";
import { cn } from "../lib/cn";
import { useAppState } from "../state/AppState";
import { TextInput } from "../components/ui";

function kindTone(kind: string): string {
  const key = kind.toLowerCase();
  if (key.includes("kill") || key === "demo") return "text-fp-red";
  if (key.includes("decision") || key === "session") return "text-fp-lime";
  if (key.includes("desk")) return "text-fp-amber";
  if (key.includes("focus") || key.includes("policy")) return "text-fp-blue";
  return "text-fp-mute";
}

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
    <div className="mx-auto flex max-w-[860px] flex-col gap-5 px-7 py-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">
            Timeline
          </p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Session log</h1>
          <p className="mt-1 text-[13px] text-fp-mute">
            Starts, decisions, countdowns, kills, unlocks.
          </p>
        </div>
        <div className="w-56">
          <TextInput value={query} onChange={setQuery} placeholder="Filter events" />
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-fp-line px-6 py-16 text-center">
          <p className="text-[14px] font-medium">No events yet</p>
          <p className="mt-1 text-[13px] text-fp-mute">
            Start a session to record window, desk, and kill activity.
          </p>
        </div>
      ) : (
        <ol className="overflow-hidden rounded-lg border border-fp-line bg-fp-panel">
          {rows.map((event, index) => (
            <li
              key={`${event.ts}-${event.kind}-${index}`}
              className="grid grid-cols-[88px_92px_1fr] gap-3 border-b border-fp-line px-4 py-2.5 last:border-b-0"
            >
              <time className="font-mono text-[11px] text-fp-faint tabular">
                {formatClock(event.ts)}
              </time>
              <span
                className={cn(
                  "font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
                  kindTone(event.kind),
                )}
              >
                {event.kind}
              </span>
              <span className="truncate text-[13px] text-zinc-300" title={event.detail}>
                {event.detail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
