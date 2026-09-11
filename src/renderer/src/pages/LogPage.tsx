import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { GhostButton } from "../components/ui";
import { ErrorBanner, PageHeader } from "../components/page";
import { formatClock, formatRelative } from "../lib/format";
import { pageCopy } from "../lib/routes";
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
  const copy = pageCopy("log");

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
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
      <header className="fp-page-x shrink-0 border-b border-fp-line py-3">
        <PageHeader
          kicker={copy.kicker}
          title={copy.title}
          description={
            newest
              ? `Causal timeline of real session events · cause → countdown → consequence → recovery · latest ${formatClock(newest.event.ts)} · ${formatRelative(newest.event.ts, now)}`
              : "Causal timeline of real session events · cause → countdown → consequence → recovery · empty until Start session"
          }
          meta={
            filtered.length === views.length
              ? `${views.length}`
              : `${filtered.length}/${views.length}`
          }
          actions={
            <>
              {copySupported ? (
                <GhostButton
                  onClick={() => {
                    void onCopy();
                  }}
                >
                  {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
                </GhostButton>
              ) : null}
              <GhostButton
                expanded={helpOpen}
                controls="golden-path-panel"
                onClick={() => setHelpOpen((open) => !open)}
              >
                {helpOpen ? "Hide path" : "90s path"}
              </GhostButton>
            </>
          }
        />
      </header>

      <div className="fp-page-x shrink-0 border-b border-fp-line py-2.5">
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

      {app.error && emptyMode !== "error" ? (
        <div className="fp-page-x pt-3">
          <ErrorBanner message={app.error} onDismiss={app.clearError} />
        </div>
      ) : null}

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
