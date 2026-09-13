import type { JSX } from "react";
import { cn } from "../../lib/cn";
import type { PlanSegment } from "./plan";

/**
 * A multi-round session drawn to scale — solid bars for the work, hollow
 * notches for the breaks. It is the same object in both places: on the panel
 * you are shaping it, in lock mode it is filling up. Only appears when there
 * is more than one round, because otherwise it has nothing to say.
 */
export function Ribbon(props: {
  segments: readonly PlanSegment[];
  /** Seconds completed. Omit on the setup panel. */
  elapsedSec?: number;
  variant?: "plan" | "run";
  className?: string;
}): JSX.Element {
  const variant = props.variant ?? "plan";
  const elapsed = props.elapsedSec ?? 0;
  const running = variant === "run";

  return (
    <div
      className={cn(
        "flex w-full items-stretch gap-[5px]",
        running ? "h-[12px]" : "h-[52px]",
        props.className,
      )}
      role="img"
      aria-label={ribbonLabel(props.segments)}
    >
      {props.segments.map((segment) => {
        const focus = segment.kind === "focus";
        const into = Math.min(Math.max(elapsed - segment.startSec, 0), segment.seconds);
        const fill = segment.seconds === 0 ? 0 : into / segment.seconds;
        const spent = running && elapsed >= segment.endSec;
        const current = running && elapsed >= segment.startSec && elapsed < segment.endSec;

        if (!focus) {
          return (
            <span
              key={segment.index}
              style={{ flexGrow: segment.seconds, flexBasis: 0 }}
              className={cn(
                "relative min-w-[5px] overflow-hidden rounded-[3px] transition-[flex-grow] duration-500",
                running
                  ? "self-stretch bg-current/10"
                  : "my-[14px] self-auto border border-dashed border-current/40",
              )}
            >
              {running ? (
                <span
                  className="absolute inset-y-0 left-0 bg-current/45 transition-[width] duration-300 ease-linear"
                  style={{ width: `${fill * 100}%` }}
                />
              ) : null}
            </span>
          );
        }

        return (
          <span
            key={segment.index}
            style={{ flexGrow: segment.seconds, flexBasis: 0 }}
            className={cn(
              "relative min-w-[6px] overflow-hidden rounded-[4px] transition-[flex-grow] duration-500",
              running ? "bg-current/15" : "bg-current",
              current && "ring-1 ring-inset ring-current/70",
              spent && "opacity-70",
            )}
          >
            {running ? (
              <span
                className="absolute inset-y-0 left-0 bg-current transition-[width] duration-300 ease-linear"
                style={{ width: `${fill * 100}%` }}
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center overflow-hidden">
                <span className="fp-display text-[13px] font-bold text-[color:var(--ground)] tabular">
                  {Math.round(segment.seconds / 60)}
                </span>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function ribbonLabel(segments: readonly PlanSegment[]): string {
  const focus = segments.filter((segment) => segment.kind === "focus");
  const breaks = segments.filter((segment) => segment.kind === "break");
  const focusMin = Math.round((focus[0]?.seconds ?? 0) / 60);
  const breakMin = Math.round((breaks[0]?.seconds ?? 0) / 60);
  if (breaks.length === 0) {
    return `Session shape: one round of ${focusMin} minutes`;
  }
  return `Session shape: ${focus.length} rounds of ${focusMin} minutes, separated by ${breaks.length} breaks of ${breakMin} minutes`;
}
