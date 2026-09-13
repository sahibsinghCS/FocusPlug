import type { JSX } from "react";
import { cn } from "../../lib/cn";
import type { HoldSparklineView } from "./model";
import "./plan.css";

/**
 * Minutes held, one mark per round. Filled dot = a drift at that minute; open
 * circle with an upward tick = the round ran clean, so the true hold is
 * somewhere past the mark. The dashed rule is the current median.
 *
 * There is a line only when the trend cleared all seven gates, and it is the
 * Theil–Sen line the estimator computed — the picture cannot claim a direction
 * the numbers refused to.
 */
export function HoldSparkline(props: {
  view: HoldSparklineView;
  className?: string;
}): JSX.Element | null {
  const { view } = props;
  if (view.empty) {
    return null;
  }
  return (
    <svg
      viewBox={`0 0 ${view.width} ${view.height}`}
      width={view.width}
      height={view.height}
      className={cn("text-fp-mute", props.className)}
      role="img"
      aria-label={view.caption}
    >
      {view.medianY === null ? null : (
        <line
          x1={0}
          y1={view.medianY}
          x2={view.width}
          y2={view.medianY}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.45}
        />
      )}
      {view.line === null ? null : (
        <line
          x1={view.line.x1}
          y1={view.line.y1}
          x2={view.line.x2}
          y2={view.line.y2}
          stroke="currentColor"
          strokeWidth={1.4}
          className="text-fp-focus"
          opacity={0.9}
        />
      )}
      {view.marks.map((mark, index) => (
        <g key={`${mark.x}-${mark.y}-${index}`}>
          {mark.censored ? (
            <>
              <circle cx={mark.x} cy={mark.y} r={2.4} className="fp-plan-spark-censored" />
              <line
                x1={mark.x}
                y1={mark.y - 3.4}
                x2={mark.x}
                y2={mark.y - 6.4}
                stroke="currentColor"
                strokeWidth={1.2}
              />
            </>
          ) : (
            <circle cx={mark.x} cy={mark.y} r={2.2} className="fp-plan-spark-event" />
          )}
        </g>
      ))}
    </svg>
  );
}
