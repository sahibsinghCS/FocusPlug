import type { JSX } from "react";
import type { SessionEvent } from "@shared/ipc";
import { cn } from "../../lib/cn";
import {
  GOLDEN_PATH_DURATION,
  PRODUCT_LABELS,
  goldenPathProgress,
} from "./goldenPath";

export function DemoHelpPanel(props: {
  events: readonly SessionEvent[];
  onClose: () => void;
}): JSX.Element {
  const progress = goldenPathProgress(props.events);

  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-auto overflow-x-hidden border-fp-line bg-fp-panel lg:w-[296px] lg:border-l"
      aria-label="90-second golden path"
    >
      <div className="flex items-start justify-between gap-2 border-b border-fp-line px-4 py-3">
        <div className="min-w-0">
          <p className="fp-section-label">Demo path</p>
          <h2 className="mt-0.5 text-[13px] font-semibold tracking-tight">
            {GOLDEN_PATH_DURATION} golden path
          </h2>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="fp-btn inline-flex h-7 shrink-0 items-center rounded-md border border-fp-line px-2 text-[11px] text-fp-mute hover:bg-fp-hover hover:text-fp-ink"
        >
          Hide
        </button>
      </div>

      <p className="border-b border-fp-line px-4 py-3 text-[12px] leading-relaxed text-fp-mute">
        Film the kill, not a timer. Checks mark events already in this session log — not simulated
        stats.
      </p>

      <p className="px-4 pt-3 font-mono text-[11px] tabular text-fp-faint">
        {progress.seen} of {progress.total} beats in this log
      </p>

      <ol className="flex flex-col gap-3 px-4 py-3">
        {progress.steps.map((step, index) => (
          <li key={step.id} className="flex min-w-0 gap-2.5">
            <span
              className={cn(
                "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px]",
                step.seen
                  ? "border-fp-lime/40 bg-fp-lime/15 text-fp-lime"
                  : "border-fp-line text-fp-faint",
              )}
              aria-hidden="true"
            >
              {step.seen ? "✓" : index + 1}
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[10px] tabular text-fp-faint">{step.beat}</span>
                <span className="text-[13px] font-medium text-fp-ink">{step.label}</span>
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-fp-mute break-words">{step.cue}</p>
              <span className="sr-only">
                {step.seen ? "Present in this log" : "Not yet in this log"}
              </span>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-auto border-t border-fp-line px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fp-faint">
          Product labels
        </p>
        <ul className="mt-2 flex flex-wrap gap-1">
          {PRODUCT_LABELS.map((label) => (
            <li
              key={label}
              className="rounded border border-fp-line px-1.5 py-0.5 text-[10px] text-fp-mute"
            >
              {label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-fp-faint">
          Same words as Session, overlay, and Demo Kill. Cause → countdown → consequence →
          recovery. No fake runtime metrics.
        </p>
      </div>
    </aside>
  );
}
