import type { JSX } from "react";
import { cn } from "../../lib/cn";

/** One dial on the panel: a fader you can drag and a pair of nudges. */
export function Dial(props: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  hint?: string;
}): JSX.Element {
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100;
  const id = `fp-dial-${props.label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="fp-stencil cursor-pointer">
        {props.label}
      </label>

      <p className="fp-display mt-1 flex items-baseline gap-1.5 text-fp-ink">
        <span className="text-[26px] font-semibold leading-none tabular">{props.value}</span>
        <span className="text-[12px] font-medium text-fp-faint">{props.unit}</span>
      </p>

      <div className="mt-2 flex items-center gap-2">
        <Nudge
          label={`Decrease ${props.label.toLowerCase()}`}
          glyph="minus"
          disabled={props.value <= props.min}
          onClick={() => props.onChange(props.value - props.step)}
        />
        <input
          id={id}
          type="range"
          className="fp-fader min-w-0 flex-1"
          style={{ ["--fill" as string]: `${fill}%` }}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          aria-valuetext={`${props.value} ${props.unit}`}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
        <Nudge
          label={`Increase ${props.label.toLowerCase()}`}
          glyph="plus"
          disabled={props.value >= props.max}
          onClick={() => props.onChange(props.value + props.step)}
        />
      </div>

      {props.hint ? <p className="mt-1.5 text-[11.5px] text-fp-faint">{props.hint}</p> : null}
    </div>
  );
}

function Nudge(props: {
  label: string;
  glyph: "minus" | "plus";
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "fp-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-fp-line text-fp-mute",
        "hover:border-fp-line-strong hover:bg-fp-hover hover:text-fp-ink",
        "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
      )}
    >
      <svg viewBox="0 0 14 14" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M3 7h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        {props.glyph === "plus" ? (
          <path d="M7 3v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ) : null}
      </svg>
    </button>
  );
}
