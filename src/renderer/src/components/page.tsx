import type { JSX, ReactNode } from "react";
import type { Tone } from "../lib/format";
import { cn } from "../lib/cn";
import { toneText } from "../lib/tone";

export function PageFrame(props: {
  children: ReactNode;
  width?: "full" | "narrow";
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        "fp-page",
        props.width === "narrow" ? "fp-page-narrow" : "flex h-full min-h-0 min-w-0 flex-col",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

export function PageHeader(props: {
  kicker: string;
  title?: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="fp-section-label">{props.kicker}</p>
        {props.title ? (
          <h1 className="mt-0.5 text-[18px] font-semibold tracking-tight">{props.title}</h1>
        ) : null}
        {props.description ? (
          <p className="mt-1 text-[13px] text-fp-mute">{props.description}</p>
        ) : null}
      </div>
      {props.meta || props.actions ? (
        <div className="flex shrink-0 items-center gap-2 self-center">
          {props.meta ? (
            <p className="font-mono text-[11px] text-fp-faint tabular">{props.meta}</p>
          ) : null}
          {props.actions}
        </div>
      ) : null}
    </header>
  );
}

export function PagePanel(props: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}): JSX.Element {
  return (
    <div className={cn("fp-card", props.padded !== false && "p-4", props.className)}>
      {props.children}
    </div>
  );
}

export function EmptyState(props: {
  kicker: string;
  title: string;
  children?: ReactNode;
  tone?: Tone;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="px-1 py-6">
      <p className={cn("fp-section-label", props.tone ? toneText(props.tone) : null)}>
        {props.kicker}
      </p>
      <h2 className="mt-2 text-[16px] font-semibold tracking-tight text-fp-ink">{props.title}</h2>
      {props.children ? (
        <div className="mt-2 max-w-xl text-[13px] leading-5 text-fp-mute">{props.children}</div>
      ) : null}
      {props.action ? <div className="mt-4">{props.action}</div> : null}
    </div>
  );
}

export function ErrorBanner(props: {
  title?: string;
  message: string;
  hint?: string;
  onDismiss?: () => void;
}): JSX.Element {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border border-fp-red/40 bg-fp-red/10 px-4 py-3"
      role="alert"
    >
      <div className="min-w-0">
        <p className="fp-section-label text-fp-red">{props.title ?? "Error"}</p>
        <p className="mt-1 text-[13px] text-fp-ink">{props.message}</p>
        {props.hint ? <p className="mt-1 text-[12px] text-fp-mute">{props.hint}</p> : null}
      </div>
      {props.onDismiss ? (
        <button
          type="button"
          onClick={props.onDismiss}
          className="fp-btn shrink-0 rounded-md border border-fp-red/40 px-2.5 py-1 text-[12px] text-fp-red hover:bg-fp-red/15"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function LoadingPulse(props: { label: string; rows?: number }): JSX.Element {
  const rows = props.rows ?? 5;
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <p className="sr-only">{props.label}</p>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-9 animate-pulse rounded-md bg-white/[0.04]" />
      ))}
    </div>
  );
}
