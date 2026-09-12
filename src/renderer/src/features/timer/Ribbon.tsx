import type { JSX } from "react";
import { cn } from "../../lib/cn";
import type { PlanSegment } from "./plan";

/**
 * The session, drawn to scale — lit tungsten bars for the work, dark notches
 * for the breaks. It is the same object in both places: on the panel you are
 * shaping it, in lock mode it is filling up. Nothing else shows you the shape
 * of the next three hours before you agree to it.
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
                  ? "self-stretch bg-fp-break/12"
                  : "my-[14px] self-auto border border-fp-break/55 bg-fp-break/28",
              )}
            >
              {running ? (
                <span
                  className="absolute inset-y-0 left-0 bg-fp-break/80 transition-[width] duration-300 ease-linear"
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
              running
                ? "bg-fp-focus/22"
                : "bg-[linear-gradient(180deg,#ffc183_0%,#ffa653_52%,#f3903f_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]",
              current && "ring-1 ring-inset ring-fp-focus/70",
              spent && "opacity-70",
            )}
          >
            {running ? (
              <span
                className="absolute inset-y-0 left-0 bg-fp-focus transition-[width] duration-300 ease-linear"
                style={{ width: `${fill * 100}%` }}
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center overflow-hidden">
                <span className="fp-display text-[13px] font-bold text-[#2a1405] tabular">
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
