import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";
import type { Tone } from "../lib/format";

export function Led(props: { tone: Tone; live?: boolean }): JSX.Element {
  const color =
    props.tone === "lime"
      ? "bg-fp-lime shadow-[0_0_8px_rgba(212,255,58,0.85)]"
      : props.tone === "red"
        ? "bg-fp-red shadow-[0_0_8px_rgba(255,45,85,0.9)]"
        : props.tone === "amber"
          ? "bg-fp-amber shadow-[0_0_8px_rgba(255,176,32,0.85)]"
          : "bg-zinc-600";
  return (
    <span
      className={cn("inline-block h-1.5 w-1.5 rounded-full", color, props.live && "led-live")}
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
        "relative h-5 w-9 rounded-full transition-colors",
        props.checked ? "bg-fp-lime" : "bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-fp-bg shadow transition-all",
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
      className="inline-flex h-9 items-center justify-center rounded-md bg-fp-lime px-3.5 text-[13px] font-semibold text-fp-bg transition hover:bg-[#e2ff6a] disabled:cursor-not-allowed disabled:opacity-40"
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
      className="inline-flex h-9 items-center justify-center rounded-md border border-fp-line-strong bg-transparent px-3.5 text-[13px] font-medium text-fp-ink transition hover:bg-fp-hover disabled:cursor-not-allowed disabled:opacity-40"
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
        "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-fp-red px-4 text-[13px] font-semibold tracking-wide text-white shadow-[0_0_28px_rgba(255,45,85,0.28)] transition hover:bg-[#ff4d6d] disabled:cursor-not-allowed disabled:opacity-40",
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
        "h-9 w-full rounded-md border border-fp-line bg-fp-elev px-3 text-[13px] text-fp-ink placeholder:text-fp-faint",
        props.mono && "font-mono text-[12px]",
      )}
    />
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
