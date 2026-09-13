import type { JSX } from "react";
import type { PolicyEvent } from "@shared/ipc";
import { Led } from "@renderer/components/ui";
import { cn } from "@renderer/lib/cn";
import type { Tone } from "@renderer/lib/format";
import { toneText } from "@renderer/lib/tone";
import { describeForecastEvent } from "@renderer/features/forecast/model";
import { eventTone, type StageNote } from "../narrative";
import type { DemoFrame } from "../pipeline";

/** "What you are looking at" — one sentence, recomputed from the live frame. */
export function StageCard(props: { note: StageNote }): JSX.Element {
  return (
    <section className="fp-card h-full min-w-0 px-4 py-3" aria-label="What to watch">
      <div className="flex items-center gap-2">
        <Led tone={props.note.tone} live />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fp-faint">
          What to watch
        </p>
        <p
          className={cn(
            "ml-auto text-[11px] font-semibold uppercase tracking-[0.14em]",
            toneText(props.note.tone),
          )}
        >
          {props.note.kicker}
        </p>
      </div>
      <p className="mt-2 text-[13px] leading-5 text-fp-ink">{props.note.line}</p>
    </section>
  );
}

interface FeedRow {
  ts: number;
  label: string;
  tone: Tone;
  source: "forecast" | "policy";
}

function describePolicyEvent(event: PolicyEvent): FeedRow | null {
  if (event.type === "start_countdown") {
    return {
      ts: 0,
      label: `start_countdown · ${event.reason} · ${event.seconds}s`,
      tone: "red",
      source: "policy",
    };
  }
  if (event.type === "cancel_countdown") {
    return { ts: 0, label: "cancel_countdown · recovered in time", tone: "lime", source: "policy" };
  }
  if (event.type === "kill") {
    return {
      ts: 0,
      label: `kill · ${event.targets.join(", ") || "blocked apps"}`,
      tone: "red",
      source: "policy",
    };
  }
  if (event.type === "unlock") {
    return { ts: 0, label: "unlock · back on task", tone: "lime", source: "policy" };
  }
  return null;
}

/**
 * The causal story so far, forecast and policy interleaved — the same two
 * streams the console threads into its cause → countdown → consequence
 * timeline, here as a flat feed because the demo has no log page.
 */
export function EventFeed(props: {
  frames: readonly DemoFrame[];
  startTs: number;
  limit?: number;
}): JSX.Element {
  const rows: FeedRow[] = [];
  for (const frame of props.frames) {
    for (const event of frame.forecastEvents) {
      rows.push({
        ts: event.ts,
        label: describeForecastEvent(event),
        tone: eventTone(event),
        source: "forecast",
      });
    }
    for (const event of frame.policyEvents) {
      const row = describePolicyEvent(event);
      if (row) {
        rows.push({ ...row, ts: frame.ts });
      }
    }
  }
  const feed = rows.slice(-(props.limit ?? 8)).reverse();

  return (
    <section className="fp-card min-w-0 px-4 py-3" aria-label="Event feed">
      <div className="flex items-baseline gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fp-faint">
          Events
        </p>
        <p className="ml-auto text-[10px] text-fp-faint">forecast · policy</p>
      </div>
      {feed.length === 0 ? (
        <p className="mt-2 text-[12px] text-fp-mute">
          Nothing yet — the model is watching and the policy engine is armed.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {feed.map((row, index) => (
            <li
              key={`${row.ts}-${index}-${row.label}`}
              className="flex items-baseline gap-2 font-mono text-[11px]"
            >
              <span className="w-10 shrink-0 text-right text-fp-faint tabular">
                +{Math.max(0, Math.round((row.ts - props.startTs) / 1000))}s
              </span>
              <span
                className={cn(
                  "w-[52px] shrink-0 text-[9px] uppercase tracking-[0.12em]",
                  row.source === "policy" ? "text-fp-mute" : "text-fp-faint",
                )}
              >
                {row.source}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", toneText(row.tone))} title={row.label}>
                {row.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
