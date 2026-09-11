import type { JSX } from "react";
import { EmptyState, ErrorBanner, LoadingPulse } from "../../components/page";
import { GhostButton } from "../../components/ui";
import { CAUSAL_CHAIN_LEGEND } from "./goldenPath";

export function LogEmptyState(props: {
  mode: "loading" | "error" | "empty" | "filtered";
  error?: string | null;
  onClearFilters?: () => void;
}): JSX.Element {
  if (props.mode === "loading") {
    return (
      <div className="fp-page-x py-5">
        <LoadingPulse label="Loading session log" rows={6} />
      </div>
    );
  }

  if (props.mode === "error") {
    return (
      <div className="fp-page-x py-6">
        <ErrorBanner
          title="Log unavailable"
          message={
            props.error && props.error.trim().length > 0
              ? props.error
              : "The session log could not load."
          }
          hint="Start session still works from Session home when live IPC is up. This page only reads existing log events — it does not change enforcement."
        />
      </div>
    );
  }

  if (props.mode === "filtered") {
    return (
      <div className="fp-page-x">
        <EmptyState
          kicker="No matches"
          title="No events match these filters"
          action={
            props.onClearFilters ? (
              <GhostButton onClick={props.onClearFilters}>Clear filters</GhostButton>
            ) : undefined
          }
        >
          Kind, status, or search hid every row. Clear filters to see the enforcement chain again.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="fp-page-x">
      <EmptyState kicker="No events yet" title="Start session to record the enforcement chain">
        <p>
          Session off is observe only. A live session writes Window, Desk AI, Decision, Countdown,
          Kill, Plug off, Unlock, and Plug on — the same labels as Session home.
        </p>
        <ol className="mt-4 space-y-2">
          {CAUSAL_CHAIN_LEGEND.map((step, index) => (
            <li key={step.stage} className="flex min-w-0 gap-3">
              <span className="w-5 shrink-0 font-mono text-[11px] tabular text-fp-faint">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-fp-ink">{step.label}</span>
                <span className="block text-[12px] text-fp-mute">{step.hint}</span>
              </span>
            </li>
          ))}
        </ol>
      </EmptyState>
    </div>
  );
}
