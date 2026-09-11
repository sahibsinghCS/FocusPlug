import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";
import type { Tone } from "../lib/format";

export function Lamp(props: { tone: Tone; live?: boolean }): JSX.Element {
  const color =
    props.tone === "live"
      ? "bg-fp-live"
      : props.tone === "kill"
        ? "bg-fp-kill"
        : props.tone === "warn"
          ? "bg-fp-warn"
          : "bg-fp-line-strong";
  return (
    <span
      className={cn("inline-block h-1.5 w-1.5", color, props.live && "lamp-live")}
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
        props.checked ? "bg-fp-ivory" : "bg-fp-hover",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 bg-fp-bg transition-all",
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
}): JSX.Element {
  return (
    <button
      type={props.submit ? "submit" : "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      className="inline-flex h-9 items-center justify-center bg-fp-ivory px-4 text-[13px] font-medium text-fp-well transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
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
      className="inline-flex h-9 items-center justify-center border border-fp-line-strong bg-transparent px-3.5 text-[13px] font-medium text-fp-ink transition hover:border-fp-ink hover:bg-fp-elev disabled:cursor-not-allowed disabled:opacity-40"
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
        "inline-flex h-10 items-center justify-center gap-2 bg-fp-kill px-4 text-[13px] font-semibold tracking-[0.04em] text-white transition hover:bg-[#f04a3e] disabled:cursor-not-allowed disabled:opacity-40",
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
      <span className="text-[12px] font-medium text-fp-mute">{props.label}</span>
      {props.hint ? <p className="mt-1 text-[12px] text-fp-faint">{props.hint}</p> : null}
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
        "h-9 w-full border border-fp-line bg-fp-well px-3 text-[13px] text-fp-ink placeholder:text-fp-faint",
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
      className="h-9 w-full border border-fp-line bg-fp-well px-3 text-[13px] text-fp-ink"
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
    props.tone === "live"
      ? "border-fp-live/40 text-fp-live"
      : props.tone === "kill"
        ? "border-fp-kill/45 text-fp-kill"
        : props.tone === "warn"
          ? "border-fp-warn/40 text-fp-warn"
          : "border-fp-line text-fp-mute";
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2 py-0.5 text-[10px] font-medium tracking-[0.08em]",
        palette,
      )}
    >
      {props.children}
    </span>
  );
}

export function PageIntro(props: {
  title: string;
  kicker?: string;
  children?: ReactNode;
  meta?: ReactNode;
}): JSX.Element {
  return (
    <header className="flex items-end justify-between gap-6 border-b border-fp-line px-7 py-6">
      <div className="min-w-0">
        {props.kicker ? (
          <p className="mb-1 text-[12px] text-fp-faint">{props.kicker}</p>
        ) : null}
        <h1 className="font-display text-[28px] font-extrabold leading-[1.05] tracking-[-0.03em]">
          {props.title}
        </h1>
        {props.children ? (
          <p className="mt-2 max-w-[54ch] text-[13px] leading-relaxed text-fp-mute">{props.children}</p>
        ) : null}
      </div>
      {props.meta ? <div className="shrink-0 text-right">{props.meta}</div> : null}
    </header>
  );
}
