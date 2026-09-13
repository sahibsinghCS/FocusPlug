import type { JSX, ReactNode } from "react";
import { cn } from "../../../lib/cn";

export function Notice(props: {
  tone: "warn" | "red" | "focus" | "mute";
  title?: string;
  children: ReactNode;
  role?: "note" | "alert" | "status";
}): JSX.Element {
  const palette =
    props.tone === "warn"
      ? "border-fp-warn/40 bg-fp-warn/[0.08]"
      : props.tone === "red"
        ? "border-fp-red/35 bg-fp-red/[0.08]"
        : props.tone === "focus"
          ? "border-fp-focus/30 bg-fp-focus/[0.06]"
          : "border-fp-line bg-fp-panel";
  const titleColor =
    props.tone === "warn"
      ? "text-fp-warn"
      : props.tone === "red"
        ? "text-fp-red"
        : props.tone === "focus"
          ? "text-fp-focus"
          : "text-fp-faint";
  return (
    <aside className={cn("rounded-lg border px-3 py-2.5", palette)} role={props.role ?? "note"}>
      {props.title ? (
        <p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", titleColor)}>
          {props.title}
        </p>
      ) : null}
      <div className={cn(props.title ? "mt-1" : null, "text-[12px] leading-snug text-fp-ink")}>
        {props.children}
      </div>
    </aside>
  );
}
