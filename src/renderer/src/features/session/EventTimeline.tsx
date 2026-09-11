import type { JSX } from "react";
import { EmptyState } from "../../components/page";
import { formatClock } from "../../lib/format";
import { cn } from "../../lib/cn";
import { routeHash } from "../../lib/routes";
import { toneText } from "../../lib/tone";
import {
  STAGE_ORDER,
  stageHint,
  stageLabel,
  type TimelinePreview,
  type TimelineStage,
} from "./model";

export function EventTimeline(props: { preview: TimelinePreview }): JSX.Element {
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Enforcement timeline">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="fp-section-label">Event timeline</p>
        <div className="flex items-center gap-3">
          <p className="hidden text-[11px] text-fp-faint sm:block">
            Cause → countdown → consequence → recovery
          </p>
          <a
            href={routeHash("log")}
            className="text-[11px] font-medium text-fp-mute hover:text-fp-ink"
          >
            Open log
          </a>
        </div>
      </div>

      <ol className="grid grid-cols-2 gap-2 min-[900px]:grid-cols-4">
        {STAGE_ORDER.map((stage) => (
          <li
            key={stage}
            className={cn(
              "rounded-lg border px-3 py-2",
              props.preview.reached[stage]
                ? stageTone(stage)
                : "border-fp-line bg-fp-panel text-fp-faint",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
              {stageLabel(stage)}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-fp-mute">{stageHint(stage)}</p>
          </li>
        ))}
      </ol>

      <div className="fp-card mt-3 min-h-0 flex-1 overflow-auto">
        {props.preview.empty ? (
          <div className="flex h-full min-h-[9rem] flex-col justify-center px-5">
            <EmptyState
              kicker="Waiting"
              title="Start session to record the enforcement chain"
            >
              Blocked focus or desk Away (cause), the fuse (countdown), app kill + plug cut
              (consequence), then unlock (recovery). List-editor noise stays on the Log page.
            </EmptyState>
          </div>
        ) : (
          <ol>
            {props.preview.events.map((event, index) => (
              <li
                key={`${event.ts}-${event.kind}-${index}`}
                className="grid grid-cols-[72px_88px_72px_minmax(0,1fr)] items-center gap-2 border-b border-fp-line px-4 py-1.5 last:border-b-0"
              >
                <time className="font-mono text-[11px] text-fp-faint tabular">
                  {formatClock(event.ts)}
                </time>
                <span className={cn("text-[10px] font-semibold uppercase tracking-[0.12em]", stageText(event.stage))}>
                  {stageLabel(event.stage)}
                </span>
                <span className="truncate font-mono text-[11px] uppercase tracking-[0.08em] text-fp-mute">
                  {event.kind}
                </span>
                <span className="truncate text-[13px] text-fp-ink" title={event.detail}>
                  {event.detail}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function stageTone(stage: TimelineStage): string {
  if (stage === "cause") return "border-fp-amber/30 bg-fp-amber/[0.07] text-fp-amber";
  if (stage === "countdown") return "border-fp-line-strong bg-white/5 text-fp-ink";
  if (stage === "consequence") return "border-fp-red/35 bg-fp-red/[0.08] text-fp-red";
  return "border-fp-lime/25 bg-fp-lime/[0.07] text-fp-lime";
}

function stageText(stage: TimelineStage): string {
  if (stage === "countdown") return "text-fp-ink";
  return toneText(stage === "cause" ? "amber" : stage === "consequence" ? "red" : "lime");
}
