import type { JSX, KeyboardEvent, ReactNode } from "react";
import { cn } from "../../../lib/cn";

export function LabeledInput(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <label className="block min-w-0" htmlFor={props.id}>
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-fp-faint">
        {props.label}
      </span>
      <input
        id={props.id}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        aria-invalid={props.invalid ?? false}
        aria-describedby={props.describedBy}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={props.onKeyDown}
        className={cn(
          "mt-1 h-8 w-full rounded-md border bg-fp-elev px-2.5 text-[13px] text-fp-ink placeholder:text-fp-faint disabled:opacity-40",
          props.mono && "font-mono text-[12px]",
          props.invalid ? "border-fp-red/60" : "border-fp-line",
        )}
      />
    </label>
  );
}

export function FieldMessage(props: { id: string; children: ReactNode; tone?: "red" | "mute" }): JSX.Element {
  return (
    <p
      id={props.id}
      className={cn("mt-1 text-[11px]", props.tone === "red" ? "text-fp-red" : "text-fp-faint")}
      role={props.tone === "red" ? "alert" : undefined}
    >
      {props.children}
    </p>
  );
}
