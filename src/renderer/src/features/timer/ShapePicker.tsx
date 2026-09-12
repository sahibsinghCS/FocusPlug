import type { JSX } from "react";
import { cn } from "../../lib/cn";
import { SHAPES, type ShapeId, type TimerPlan } from "./plan";

/** Four ways to cut the same hours. Picking one loads its dials. */
export function ShapePicker(props: {
  plan: TimerPlan;
  onPick: (id: ShapeId) => void;
}): JSX.Element {
  const active = SHAPES.find((shape) => shape.id === props.plan.shape) ?? SHAPES[0];

  return (
    <div>
      <div
        className="grid grid-cols-2 gap-1.5 min-[620px]:grid-cols-4"
        role="group"
        aria-label="Session shape"
      >
        {SHAPES.map((shape) => {
          const selected = props.plan.shape === shape.id;
          const custom = shape.id === "custom";
          return (
            <button
              key={shape.id}
              type="button"
              aria-pressed={selected}
              onClick={() => props.onPick(shape.id)}
              className={cn(
                "fp-btn group relative flex flex-col items-start gap-1 rounded-[var(--radius-fp-sm)] border px-3 py-2.5 text-left",
                selected
                  ? "border-fp-focus/50 bg-fp-focus/10"
                  : "border-fp-line bg-fp-elev/60 hover:border-fp-line-strong hover:bg-fp-hover",
              )}
            >
              <span className="fp-display flex items-center gap-1.5 text-[14px] font-semibold text-fp-ink">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    selected ? "bg-fp-focus shadow-[0_0_8px_rgba(255,176,97,0.9)]" : "bg-fp-line-strong",
                  )}
                />
                {shape.label}
              </span>
              <span className="font-mono text-[11px] text-fp-faint tabular">
                {custom && selected
                  ? `${props.plan.focusMin}/${props.plan.breakMin} ×${props.plan.rounds}`
                  : custom
                    ? "your dials"
                    : `${shape.focusMin}/${shape.breakMin} ×${shape.rounds}`}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-[13px] leading-5 text-fp-mute">{active?.blurb}</p>
    </div>
  );
}
