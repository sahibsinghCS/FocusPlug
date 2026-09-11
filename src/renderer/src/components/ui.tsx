import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";
import type { Tone } from "../lib/format";

const ease = "duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]";

export function Led(props: { tone: Tone; live?: boolean }): JSX.Element {
  const color =
    props.tone === "lime"
      ? "bg-fp-lime"
      : props.tone === "red"
        ? "bg-fp-red"
        : props.tone === "amber"
          ? "bg-fp-amber"
          : "bg-[#5a584e]";
  return (
    <span
      className={cn("inline-block h-1.5 w-1.5 shrink-0", color, props.live && "led-live")}
      aria-hidden="true"
    />
  );
}

export function Toggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
      className={cn(
        "relative h-5 w-9 transition-colors",
        ease,
        props.checked ? "bg-fp-lime" : "bg-[#3a3b34]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 bg-fp-bg transition-transform",
          ease,
          props.checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function PrimaryButton(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  submit?: boolean;
}): JSX.Element {
  return (
    <button
      type={props.submit ? "submit" : "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center bg-fp-lime px-3.5 text-[13px] font-semibold text-fp-bg transition-colors",
        ease,
        "hover:bg-[#d5e86a] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {props.children}
    </button>
  );
}

export function GhostButton(props: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center border border-fp-line-strong bg-transparent px-3.5 text-[13px] font-medium text-fp-ink transition-colors",
        ease,
        "hover:bg-fp-hover active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {props.children}
    </button>
  );
}

export function DangerButton(props: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 bg-fp-red px-4 text-[13px] font-semibold tracking-wide text-white transition-colors",
        ease,
        "hover:bg-[#ff2a2a] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40",
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

export function TextButton(props: {
  children: ReactNode;
  onClick: () => void;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.ariaLabel}
      className={cn(
        "inline-flex h-9 items-center px-2 text-[12px] font-medium text-fp-faint transition-colors",
        ease,
        "hover:text-fp-red active:translate-y-px",
      )}
    >
      {props.children}
    </button>
  );
}

export function Field(props: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-fp-mute">{props.label}</span>
      {props.hint ? (
        <p className="mt-1 max-w-[65ch] text-[12px] leading-relaxed text-fp-faint">{props.hint}</p>
      ) : null}
      <div className="mt-2">{props.children}</div>
    </label>
  );
}

export function TextInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <input
      value={props.value}
      placeholder={props.placeholder}
      onChange={(event) => props.onChange(event.target.value)}
      className={cn(
        "h-9 w-full border border-fp-line bg-fp-elev px-3 text-[13px] text-fp-ink placeholder:text-fp-faint",
        props.mono && "font-mono text-[12px]",
      )}
    />
  );
}

export function Select<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <select
      value={props.value}
      aria-label={props.ariaLabel}
      onChange={(event) => {
        props.onChange(event.target.value as T);
      }}
      className="h-9 w-full border border-fp-line bg-fp-elev px-3 text-[13px] text-fp-ink"
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Chip(props: { tone: Tone; children: ReactNode }): JSX.Element {
  const palette =
    props.tone === "lime"
      ? "border-fp-lime/30 bg-fp-lime/10 text-fp-lime"
      : props.tone === "red"
        ? "border-fp-red/35 bg-fp-red/10 text-fp-red"
        : props.tone === "amber"
          ? "border-fp-amber/35 bg-fp-amber/10 text-fp-amber"
          : "border-fp-line bg-fp-elev text-fp-mute";
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em]",
        palette,
      )}
    >
      {props.children}
    </span>
  );
}

export function Surface(props: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cn("border border-fp-line bg-fp-panel", props.className)}>{props.children}</div>
  );
}

export function PageChrome(props: {
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  maxWidthClassName?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-6 py-7",
        props.maxWidthClassName ?? "max-w-[880px]",
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-[65ch]">
          <h1 className="text-[28px] font-semibold leading-[1.05] tracking-[-0.04em] text-pretty">
            {props.title}
          </h1>
          {props.description ? (
            <p className="mt-2 text-[14px] leading-relaxed text-fp-mute text-pretty">
              {props.description}
            </p>
          ) : null}
          {props.meta ? (
            <p className="mt-2 font-mono text-[12px] text-fp-faint">{props.meta}</p>
          ) : null}
        </div>
        {props.actions ? <div className="shrink-0">{props.actions}</div> : null}
      </header>
      {props.children}
    </div>
  );
}
