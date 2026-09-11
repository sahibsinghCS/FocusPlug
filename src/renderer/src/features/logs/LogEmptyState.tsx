import type { JSX } from "react";
import { CAUSAL_CHAIN_LEGEND } from "./goldenPath";

export function LogEmptyState(props: {
  mode: "loading" | "error" | "empty" | "filtered";
  error?: string | null;
  onClearFilters?: () => void;
}): JSX.Element {
  if (props.mode === "loading") {
    return (
      <div className="space-y-2 px-6 py-5" aria-busy="true" aria-live="polite">
        <p className="sr-only">Loading session log</p>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-9 animate-pulse rounded-md bg-white/[0.04]" />
        ))}
      </div>
    );
  }

  if (props.mode === "error") {
    return (
      <div className="px-6 py-8" role="alert">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fp-red">
          Log unavailable
        </p>
        <p className="mt-2 max-w-xl text-[14px] text-zinc-200">
          {props.error && props.error.trim().length > 0
            ? props.error
            : "The session log could not load."}
        </p>
        <p className="mt-2 text-[12px] text-fp-mute">
          Start session still works from Session home when live IPC is up. This page only reads
          existing log events — it does not change enforcement.
        </p>
      </div>
    );
  }

  if (props.mode === "filtered") {
    return (
      <div className="px-6 py-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fp-faint">
          No matches
        </p>
        <p className="mt-2 max-w-xl text-[14px] text-zinc-200">
          No events match these kind, status, or search filters.
        </p>
        {props.onClearFilters ? (
          <button
            type="button"
            onClick={props.onClearFilters}
            className="mt-4 inline-flex h-8 items-center rounded-md border border-fp-line px-3 text-[12px] text-fp-ink hover:bg-fp-hover"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fp-faint">
        No events yet
      </p>
      <h2 className="mt-2 text-[16px] font-semibold tracking-tight">
        Start session to record the enforcement chain
      </h2>
      <p className="mt-2 max-w-xl text-[13px] text-fp-mute">
        Session off is observe only. A live session writes Window, Desk AI, Decision, Countdown,
        Kill, Plug off, Unlock, and Plug on — the same labels as Session home.
      </p>
      <ol className="mt-5 max-w-xl space-y-2">
        {CAUSAL_CHAIN_LEGEND.map((step, index) => (
          <li key={step.stage} className="flex min-w-0 gap-3">
            <span className="w-5 shrink-0 font-mono text-[11px] tabular text-fp-faint">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-zinc-200">{step.label}</span>
              <span className="block text-[12px] text-fp-mute">{step.hint}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
