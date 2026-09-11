import type { JSX } from "react";
import { EmptyState, PageFrame } from "../../components/page";

export function SessionLoading(): JSX.Element {
  return (
    <PageFrame>
      <EmptyState kicker="Session" title="Loading command center…">
        Waiting for session state, lists, settings, and the event log. No placeholder sensor
        readings.
      </EmptyState>
      <div className="mt-2 grid flex-1 grid-rows-[auto_auto_1fr] gap-3">
        <div className="fp-card h-36" />
        <div className="grid grid-cols-3 gap-3">
          <div className="fp-card h-24" />
          <div className="fp-card h-24" />
          <div className="fp-card h-24" />
        </div>
        <div className="fp-card min-h-[8rem]" />
      </div>
    </PageFrame>
  );
}

export function SessionErrorBanner(props: {
  message: string;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border border-fp-red/40 bg-fp-red/10 px-4 py-3"
      role="alert"
    >
      <div className="min-w-0">
        <p className="fp-section-label text-fp-red">Session error</p>
        <p className="mt-1 text-[13px] text-fp-ink">{props.message}</p>
        <p className="mt-1 text-[12px] text-fp-mute">
          Existing Start / Stop / Demo Kill still call the same IPC. Fix the fault and retry.
        </p>
      </div>
      <button
        type="button"
        onClick={props.onDismiss}
        className="fp-btn shrink-0 rounded-md border border-fp-red/40 px-2.5 py-1 text-[12px] text-fp-red hover:bg-fp-red/15"
      >
        Dismiss
      </button>
    </div>
  );
}
