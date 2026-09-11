import type { JSX } from "react";
import { formatClock } from "../../lib/format";
import type { TimelineGroup } from "./groupEvents";
import { formatGroupSpan } from "./groupEvents";
import { TimelineEvent } from "./TimelineEvent";

export function EventTimeline(props: { groups: readonly TimelineGroup[] }): JSX.Element {
  return (
    <div className="min-w-0" role="feed" aria-label="Session event timeline" aria-busy="false">
      {props.groups.map((group) => {
        const span = formatGroupSpan(group.startedAt, group.endedAt);
        const start = formatClock(group.startedAt);
        const end = formatClock(group.endedAt);
        const range = start === end ? start : `${start}–${end}`;
        return (
          <section key={group.id} className="border-b border-fp-line" aria-label={group.summary}>
            <header className="sticky top-0 z-10 flex items-baseline gap-3 bg-fp-bg/95 px-[var(--fp-page-x)] py-2 backdrop-blur-sm">
              <h2 className="min-w-0 flex-1 truncate text-[12px] font-medium leading-snug text-fp-ink" title={group.summary}>
                {group.summary}
              </h2>
              <p className="shrink-0 font-mono text-[10px] tabular text-fp-faint">
                {range}
                {span ? ` · ${span}` : ""}
                {` · ${group.events.length}`}
              </p>
            </header>
            <ol>
              {group.events.map((view, index) => {
                const previous = index > 0 ? group.events[index - 1] : undefined;
                return (
                  <TimelineEvent
                    key={view.key}
                    view={view}
                    previousTs={previous ? previous.event.ts : null}
                    first={index === 0}
                    last={index === group.events.length - 1}
                  />
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
