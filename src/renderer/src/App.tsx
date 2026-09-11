import { useEffect, useState, type JSX } from "react";
import type { AppLists, KillResult, SessionState } from "@shared/ipc";
import { DEFAULT_SESSION_STATE } from "@shared/defaults";

function formatWindow(state: SessionState): string {
  if (!state.focus) {
    return "Waiting for window monitor";
  }
  const flag = state.focus.matchedBlock
    ? "blocked"
    : state.focus.matchedAllow
      ? "allowlisted"
      : "unmatched";
  return `${state.focus.processName} — ${state.focus.windowTitle} (${flag})`;
}

function formatDesk(state: SessionState): string {
  if (!state.desk) {
    return "Waiting for desk AI";
  }
  const pct = Math.round(state.desk.confidence * 100);
  const cam = state.desk.webcamEnabled ? "cam on" : "cam off";
  return `${state.desk.label} · ${pct}% · ${cam}`;
}

export default function App(): JSX.Element {
  const [state, setState] = useState<SessionState>(DEFAULT_SESSION_STATE);
  const [lists, setLists] = useState<AppLists | null>(null);
  const [killResult, setKillResult] = useState<KillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.focusplug;
    if (!api) {
      setError("Preload API missing — window.focusplug is undefined");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [nextState, nextLists] = await Promise.all([
          api.sessionGetState(),
          api.listsGet(),
        ]);
        if (!cancelled) {
          setState(nextState);
          setLists(nextLists);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Failed to load session state");
        }
      }
    })();

    const unsubscribe = api.onSessionState((next) => {
      setState(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function startSession(): Promise<void> {
    setError(null);
    try {
      setState(await window.focusplug.sessionStart());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to start session");
    }
  }

  async function stopSession(): Promise<void> {
    setError(null);
    try {
      setState(await window.focusplug.sessionStop());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to stop session");
    }
  }

  async function demoKill(): Promise<void> {
    setError(null);
    try {
      setKillResult(await window.focusplug.demoKill());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Demo Kill failed");
    }
  }

  const countdownVisible = state.countdownSec > 0;

  return (
    <div className="flex min-h-full flex-col bg-[#0b0f14] text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
            FocusPlug
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Study session enforcer</h1>
        </div>
        <p className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
          Scaffold placeholder
        </p>
      </header>

      <main className="relative flex-1 px-6 py-6">
        {countdownVisible ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
            <div className="rounded-2xl border border-rose-500 bg-rose-950 px-12 py-10 text-center shadow-2xl">
              <p className="text-sm uppercase tracking-[0.3em] text-rose-300">Countdown</p>
              <p className="mt-3 font-mono text-7xl font-bold text-white">{state.countdownSec}</p>
            </div>
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <StatusCard label="Window status" value={formatWindow(state)} />
          <StatusCard label="Desk AI status" value={formatDesk(state)} />
          <StatusCard label="Decision" value={`${state.decision} — ${state.detail}`} />
        </section>

        <section className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void startSession()}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            Start
          </button>
          <button
            type="button"
            onClick={() => void stopSession()}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={() => void demoKill()}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
          >
            Demo Kill
          </button>
        </section>

        {error ? (
          <p className="mt-4 text-sm text-rose-400" role="alert">
            {error}
          </p>
        ) : null}

        {killResult ? (
          <p className="mt-4 text-sm text-slate-400">
            Demo Kill stub: killed {killResult.killed.length}; {killResult.errors.join("; ")}
          </p>
        ) : null}

        <section className="mt-8 grid gap-4 md:grid-cols-2">
          <ListCard title="Allowlist" entries={lists?.allowlist ?? []} />
          <ListCard title="Blocklist" entries={lists?.blocklist ?? []} />
        </section>
      </main>
    </div>
  );
}

function StatusCard(props: { label: string; value: string }): JSX.Element {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {props.label}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-100">{props.value}</p>
    </article>
  );
}

function ListCard(props: {
  title: string;
  entries: Array<{ id: string; name: string; enabled: boolean }>;
}): JSX.Element {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="text-sm font-semibold text-slate-200">{props.title}</h2>
      <ul className="mt-3 space-y-1 text-sm text-slate-400">
        {props.entries.map((entry) => (
          <li key={entry.id}>
            {entry.name}
            {entry.enabled ? "" : " (off)"}
          </li>
        ))}
      </ul>
    </article>
  );
}
