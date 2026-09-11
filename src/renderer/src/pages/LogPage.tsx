import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { formatClock, formatRelative } from "../lib/format";
import { useAppState } from "../state/AppState";
import { canCopyTimeline, copyTimeline } from "../features/logs/copyTimeline";
import { presentLog } from "../features/logs/eventModel";
import { filterLogEvents, type KindFilterId, type StatusFilterId } from "../features/logs/filters";
import { groupLogEvents } from "../features/logs/groupEvents";
import { resolveEmptyMode } from "../features/logs/emptyMode";
import { DemoHelpPanel } from "../features/logs/DemoHelpPanel";
import { EventTimeline } from "../features/logs/EventTimeline";
import { LogEmptyState } from "../features/logs/LogEmptyState";
import { LogFilters } from "../features/logs/LogFilters";

export function LogPage(): JSX.Element {
  const app = useAppState();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilterId>("all");
  const [status, setStatus] = useState<StatusFilterId>("all");
  const [helpOpen, setHelpOpen] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [now, setNow] = useState(() => Date.now());
  const copySupported = canCopyTimeline();

  const views = useMemo(() => presentLog(app.log), [app.log]);
  const filtered = useMemo(
    () => filterLogEvents(views, { kind, status, query }),
    [views, kind, status, query],
  );
  const groups = useMemo(() => groupLogEvents(filtered), [filtered]);
  const newest = views[0];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (query.length > 0) {
          event.preventDefault();
          setQuery("");
          return;
        }
        if (helpOpen && !isTypingTarget(event.target)) {
          event.preventDefault();
          setHelpOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, query]);

  useEffect(() => {
    if (copyState === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const emptyMode = resolveEmptyMode({
    ready: app.ready,
    error: app.error,
    logCount: views.length,
    filteredCount: filtered.length,
  });

  function clearFilters(): void {
    setKind("all");
    setStatus("all");
    setQuery("");
  }

  async function onCopy(): Promise<void> {
    try {
      const ok = await copyTimeline(filtered.map((view) => view.event));
      setCopyState(ok ? "copied" : "failed");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="flex h-full min-h-0 max-w-full flex-col overflow-x-hidden">
      <header className="flex shrink-0 items-end justify-between gap-3 border-b border-fp-line px-6 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">
            Timeline
          </p>
          <h1 className="mt-0.5 text-[17px] font-semibold tracking-tight">Session log</h1>
          <p className="mt-1 text-[12px] text-fp-mute">
            Sensor → Decision → Countdown → Kill / Plug off → Unlock / Plug on
            {newest ? (
              <span className="text-fp-faint">
                {` · ${formatClock(newest.event.ts)} · ${formatRelative(newest.event.ts, now)}`}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <p className="font-mono text-[11px] tabular text-fp-faint" aria-live="polite">
            {filtered.length === views.length
              ? `${views.length}`
              : `${filtered.length}/${views.length}`}
          </p>
          {copySupported ? (
            <button
              type="button"
              onClick={() => {
                void onCopy();
              }}
              className="inline-flex h-8 items-center rounded-md border border-fp-line px-2.5 text-[12px] text-fp-ink hover:bg-fp-hover"
            >
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
            </button>
          ) : null}
          <button
            type="button"
            aria-expanded={helpOpen}
            aria-controls="golden-path-panel"
            onClick={() => setHelpOpen((open) => !open)}
            className="inline-flex h-8 items-center rounded-md border border-fp-line px-2.5 text-[12px] text-fp-ink hover:bg-fp-hover"
          >
            {helpOpen ? "Hide path" : "90s path"}
          </button>
        </div>
      </header>

      <div className="shrink-0 border-b border-fp-line px-6 py-2.5">
        <LogFilters
          views={views}
          kind={kind}
          status={status}
          query={query}
          onKind={setKind}
          onStatus={setStatus}
          onQuery={setQuery}
          searchRef={searchRef}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto overflow-x-hidden">
          {emptyMode ? (
            <LogEmptyState
              mode={emptyMode}
              error={app.error}
              onClearFilters={emptyMode === "filtered" ? clearFilters : undefined}
            />
          ) : (
            <EventTimeline groups={groups} />
          )}
        </div>
        {helpOpen ? (
          <div id="golden-path-panel" className="min-h-0 shrink-0 lg:h-full">
            <DemoHelpPanel events={app.log} onClose={() => setHelpOpen(false)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
