import type { JSX } from "react";

export function SessionLoading(): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-6" role="status" aria-live="polite">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">Session</p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Loading command center…</h1>
      <p className="mt-2 max-w-xl text-[13px] text-fp-mute">
        Waiting for session state, lists, settings, and the event log. No placeholder sensor
        readings.
      </p>
      <div className="mt-6 grid flex-1 grid-rows-[auto_auto_1fr] gap-3">
        <div className="h-36 rounded-xl border border-fp-line bg-fp-panel" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-24 rounded-xl border border-fp-line bg-fp-panel" />
          <div className="h-24 rounded-xl border border-fp-line bg-fp-panel" />
          <div className="h-24 rounded-xl border border-fp-line bg-fp-panel" />
        </div>
        <div className="min-h-[8rem] rounded-xl border border-fp-line bg-fp-panel" />
      </div>
    </div>
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fp-red">
          Session error
        </p>
        <p className="mt-1 text-[13px] text-zinc-200">{props.message}</p>
        <p className="mt-1 text-[12px] text-fp-mute">
          Existing Start / Stop / Demo Kill still call the same IPC. Fix the fault and retry.
        </p>
      </div>
      <button
        type="button"
        onClick={props.onDismiss}
        className="shrink-0 rounded-md border border-fp-red/40 px-2.5 py-1 text-[12px] text-fp-red hover:bg-fp-red/15"
      >
        Dismiss
      </button>
    </div>
  );
}
