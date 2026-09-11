import type { JSX } from "react";
import { cn } from "../../lib/cn";
import { formatClock } from "../../lib/format";
import type { LogEventView } from "./eventModel";
import { formatEventDelta } from "./groupEvents";
import { toneDot, toneText } from "./tone";

export function TimelineEvent(props: {
  view: LogEventView;
  previousTs: number | null;
  first: boolean;
  last: boolean;
}): JSX.Element {
  const { view } = props;
  const delta = formatEventDelta(props.previousTs, view.event.ts);
  const showReason =
    Boolean(view.reason) &&
    view.reason !== view.title &&
    !view.detail.toLowerCase().includes((view.reason ?? "").toLowerCase());
  const showDetail = view.detail.length > 0 && view.detail !== view.title;

  return (
    <li className="grid grid-cols-[72px_16px_minmax(0,1fr)] gap-x-3 px-6 py-1.5">
      <div className="min-w-0 pt-0.5">
        <time
          dateTime={new Date(view.event.ts).toISOString()}
          className="block font-mono text-[11px] tabular text-fp-faint"
        >
          {formatClock(view.event.ts)}
        </time>
        {delta ? (
          <p className="font-mono text-[10px] tabular text-zinc-600">{delta}</p>
        ) : null}
      </div>

      <div className="relative flex justify-center" aria-hidden="true">
        {!props.first ? <span className="absolute top-0 h-2 w-px bg-fp-line" /> : null}
        <span
          className={cn("absolute top-2 bottom-0 w-px bg-fp-line", props.last && "hidden")}
        />
        <span className={cn("relative z-10 mt-1.5 h-2 w-2 rounded-full", toneDot(view.tone))} />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className={cn("text-[13px] font-medium", toneText(view.tone))}>{view.title}</p>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fp-faint">
            {view.event.kind}
          </span>
          {view.status !== "ok" ? (
            <span
              className={cn(
                "rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-[0.12em]",
                view.status === "error"
                  ? "border-fp-red/40 text-fp-red"
                  : "border-fp-line text-fp-mute",
              )}
            >
              {view.statusLabel}
            </span>
          ) : null}
        </div>
        {showReason ? (
          <p className="mt-0.5 text-[12px] text-zinc-300 break-words">{view.reason}</p>
        ) : null}
        {showDetail ? (
          <p className="mt-0.5 text-[12px] text-fp-mute break-words">{view.detail}</p>
        ) : null}
      </div>
    </li>
  );
}
