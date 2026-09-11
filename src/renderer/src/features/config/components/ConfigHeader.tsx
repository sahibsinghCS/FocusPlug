import type { JSX, ReactNode } from "react";

export function ConfigPage(props: { children: ReactNode }): JSX.Element {
  return (
    <div className="mx-auto flex max-w-[920px] flex-col gap-4 px-6 py-5">{props.children}</div>
  );
}

export function ConfigHeader(props: {
  kicker: string;
  title: string;
  description: string;
  meta?: string;
}): JSX.Element {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">
          {props.kicker}
        </p>
        <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight">{props.title}</h1>
        <p className="mt-1 text-[13px] text-fp-mute">{props.description}</p>
      </div>
      {props.meta ? (
        <p className="shrink-0 pt-6 font-mono text-[11px] text-fp-faint">{props.meta}</p>
      ) : null}
    </header>
  );
}
