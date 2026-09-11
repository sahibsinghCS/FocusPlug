import type { JSX } from "react";
import type { AppEntry } from "@shared/types";
import { cn } from "../../lib/cn";

export function ArmedLists(props: {
  allowlist: readonly AppEntry[];
  blocklist: readonly AppEntry[];
}): JSX.Element {
  return (
    <section
      className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2"
      aria-label="Armed lists"
    >
      <ListCard
        href="#/allowlist"
        label="Allowlist"
        tone="lime"
        entries={props.allowlist}
      />
      <ListCard
        href="#/blocklist"
        label="Blocklist"
        tone="red"
        entries={props.blocklist}
      />
    </section>
  );
}

function ListCard(props: {
  href: string;
  label: string;
  tone: "lime" | "red";
  entries: readonly AppEntry[];
}): JSX.Element {
  const enabled = props.entries.filter((entry) => entry.enabled);
  const names = enabled.map((entry) => entry.name);
  const preview = names.slice(0, 4).join(" · ");
  const extra = names.length > 4 ? ` +${names.length - 4}` : "";
  return (
    <a
      href={props.href}
      className={cn(
        "fp-card min-w-0 px-4 py-3 transition hover:bg-fp-hover",
        props.tone === "lime" ? "border-fp-lime/25" : "border-fp-red/30",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p
          className={cn(
            "text-[10px] font-semibold uppercase tracking-[0.16em]",
            props.tone === "lime" ? "text-fp-lime" : "text-fp-red",
          )}
        >
          {props.label}
        </p>
        <p className="font-mono text-[11px] text-fp-faint">
          {enabled.length} armed
        </p>
      </div>
      <p className="mt-1.5 truncate text-[13px] text-fp-ink" title={names.join(", ")}>
        {names.length === 0 ? "None enabled" : `${preview}${extra}`}
      </p>
    </a>
  );
}
