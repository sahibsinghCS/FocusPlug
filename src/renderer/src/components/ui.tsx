import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";
import type { Tone } from "../lib/format";

export function Lamp(props: { tone: Tone; live?: boolean }): JSX.Element {
  const color =
    props.tone === "live"
      ? "tone-live"
      : props.tone === "kill"
        ? "tone-kill"
        : props.tone === "warn"
          ? "tone-warn"
          : "tone-mute";
  return <span className={cn("session-chip-dot", color)} aria-hidden="true" />;
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
      className={cn("rocker", props.checked && "is-on")}
    >
      {props.checked ? "On" : "Off"}
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
      className="act act-solid"
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
    <button type="button" disabled={props.disabled} onClick={props.onClick} className="act">
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
      className={cn("kill-plate", props.className)}
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
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.hint ? <span className="setting-copy">{props.hint}</span> : null}
      {props.children}
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
      className={cn("control", props.mono && "font-mono")}
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
      className="control"
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
      ? "tone-live"
      : props.tone === "kill"
        ? "tone-kill"
        : props.tone === "warn"
          ? "tone-warn"
          : "tone-mute";
  return <span className={cn("field-label", palette)}>{props.children}</span>;
}

export function PageIntro(props: {
  title: string;
  kicker?: string;
  children?: ReactNode;
  meta?: ReactNode;
}): JSX.Element {
  return (
    <header className="page-head">
      <div className="min-w-0">
        {props.kicker ? <p className="page-kicker">{props.kicker}</p> : null}
        <h1 className="page-title">{props.title}</h1>
        {props.children ? <p className="page-lede">{props.children}</p> : null}
      </div>
      {props.meta ? <div className="shrink-0 text-right">{props.meta}</div> : null}
    </header>
  );
}
