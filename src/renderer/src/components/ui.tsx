import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";
import type { Tone } from "../lib/format";

export function Led(props: { tone: Tone; live?: boolean; className?: string }): JSX.Element {
  const color =
    props.tone === "lime"
      ? "bg-fp-lime shadow-[0_0_8px_rgba(212,255,58,0.85)]"
      : props.tone === "red"
        ? "bg-fp-red shadow-[0_0_8px_rgba(255,45,85,0.9)]"
        : props.tone === "amber"
          ? "bg-fp-amber shadow-[0_0_8px_rgba(255,176,32,0.85)]"
          : "bg-[#4b5568]";
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        color,
        props.live && "led-live",
        props.className,
      )}
      aria-hidden="true"
    />
  );
}

export function Toggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className={cn(
        "fp-btn relative h-5 w-9 shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-40",
        props.checked ? "bg-fp-lime" : "bg-[#3f4654]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-fp-bg shadow transition-[left] duration-150",
          props.checked ? "left-[18px]" : "left-0.5",
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
  className?: string;
}): JSX.Element {
  return (
    <button
      type={props.submit ? "submit" : "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "fp-btn inline-flex h-8 items-center justify-center rounded-md bg-fp-lime px-3 text-[13px] font-semibold text-fp-mark-ink shadow-fp-lime hover:bg-[#e2ff6a] disabled:cursor-not-allowed disabled:opacity-40",
        props.className,
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
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "fp-btn inline-flex h-8 items-center justify-center rounded-md border border-fp-line-strong bg-transparent px-3 text-[13px] font-medium text-fp-ink hover:bg-fp-hover disabled:cursor-not-allowed disabled:opacity-40",
        props.className,
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
        "fp-btn inline-flex h-9 items-center justify-center gap-2 rounded-md bg-fp-red px-4 text-[13px] font-semibold tracking-wide text-white shadow-fp-red hover:bg-[#ff4d6d] disabled:cursor-not-allowed disabled:opacity-40",
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

export function IconButton(props: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  pressed?: boolean;
  tip?: string;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.pressed}
      data-tip={props.tip}
      onClick={props.onClick}
      className={cn(
        "fp-btn inline-flex h-7 w-7 items-center justify-center rounded-md text-fp-mute hover:bg-fp-hover hover:text-fp-ink",
        props.pressed && "bg-white/5 text-fp-ink",
        props.className,
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
      <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-fp-faint">
        {props.label}
      </span>
      {props.hint ? <p className="mt-1 text-[12px] text-fp-mute">{props.hint}</p> : null}
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
        "fp-control h-8 w-full px-3 text-[13px] placeholder:text-fp-faint",
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
      className="fp-control h-8 w-full px-3 text-[13px]"
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
      ? "border-fp-lime/25 bg-fp-lime/10 text-fp-lime"
      : props.tone === "red"
        ? "border-fp-red/30 bg-fp-red/10 text-fp-red"
        : props.tone === "amber"
          ? "border-fp-amber/30 bg-fp-amber/10 text-fp-amber"
          : "border-fp-line bg-white/5 text-fp-mute";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
        palette,
      )}
    >
      {props.children}
    </span>
  );
}

export function StatusPill(props: {
  label: string;
  detail: string;
  tone: Tone;
  live?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const body = (
    <>
      <Led tone={props.tone} live={props.live} />
      <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-fp-faint sm:inline">
        {props.label}
      </span>
      <span className="max-w-[9rem] truncate font-mono text-[11px] text-fp-ink tabular">
        {props.detail}
      </span>
    </>
  );
  const shell =
    props.tone === "lime"
      ? "border-fp-lime/30 bg-fp-lime/[0.08]"
      : props.tone === "red"
        ? "border-fp-red/30 bg-fp-red/[0.08]"
        : props.tone === "amber"
          ? "border-fp-amber/30 bg-fp-amber/[0.08]"
          : "border-fp-line bg-fp-elev/80";
  const classes = cn(
    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2",
    shell,
    props.onClick && "fp-btn hover:border-fp-line-strong hover:bg-fp-hover",
  );
  if (props.onClick) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        className={classes}
        aria-label={`${props.label}: ${props.detail}`}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={classes} aria-label={`${props.label}: ${props.detail}`}>
      {body}
    </div>
  );
}