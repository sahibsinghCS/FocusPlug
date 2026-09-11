import type { JSX, ReactNode } from "react";
import { cn } from "../../../lib/cn";

export function Notice(props: {
  tone: "amber" | "red" | "lime" | "mute";
  title?: string;
  children: ReactNode;
  role?: "note" | "alert" | "status";
}): JSX.Element {
  const palette =
    props.tone === "amber"
      ? "border-fp-amber/40 bg-fp-amber/[0.08]"
      : props.tone === "red"
        ? "border-fp-red/35 bg-fp-red/[0.08]"
        : props.tone === "lime"
          ? "border-fp-lime/30 bg-fp-lime/[0.06]"
          : "border-fp-line bg-fp-panel";
  const titleColor =
    props.tone === "amber"
      ? "text-fp-amber"
      : props.tone === "red"
        ? "text-fp-red"
        : props.tone === "lime"
          ? "text-fp-lime"
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
