import { useRef, type JSX, type KeyboardEvent, type RefObject } from "react";
import { cn } from "../../lib/cn";
import {
  countKindFilter,
  countStatusFilter,
  STATUS_FILTERS,
  visibleKindFilters,
  type KindFilterId,
  type StatusFilterId,
} from "./filters";
import type { LogEventView } from "./eventModel";
import { toneChip } from "./tone";

export function LogFilters(props: {
  views: readonly LogEventView[];
  kind: KindFilterId;
  status: StatusFilterId;
  query: string;
  onKind: (id: KindFilterId) => void;
  onStatus: (id: StatusFilterId) => void;
  onQuery: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}): JSX.Element {
  const kindBar = useRef<HTMLDivElement>(null);
  const statusBar = useRef<HTMLDivElement>(null);
  const kinds = visibleKindFilters(props.views);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-fp-faint">
          Kind
        </p>
        <div
          ref={kindBar}
          role="toolbar"
          aria-label="Filter by kind"
          onKeyDown={(event) => handleToolbarKeys(event, kindBar.current)}
          className="flex min-w-0 flex-1 flex-wrap gap-1"
        >
          {kinds.map((filter) => {
            const count = countKindFilter(props.views, filter);
            const pressed = props.kind === filter.id;
            return (
              <FilterChip
                key={filter.id}
                pressed={pressed}
                count={count}
                onClick={() => props.onKind(filter.id)}
              >
                {filter.label}
              </FilterChip>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-fp-faint">
          Status
        </p>
        <div
          ref={statusBar}
          role="toolbar"
          aria-label="Filter by status"
          onKeyDown={(event) => handleToolbarKeys(event, statusBar.current)}
          className="flex min-w-0 flex-1 flex-wrap gap-1"
        >
          {STATUS_FILTERS.map((filter) => {
            const count = countStatusFilter(props.views, filter.id);
            const pressed = props.status === filter.id;
            const tone = filter.id === "error" ? "red" : filter.id === "cancelled" ? "mute" : "lime";
            return (
              <FilterChip
                key={filter.id}
                pressed={pressed}
                count={count}
                tone={pressed && filter.id !== "all" ? tone : undefined}
                onClick={() => props.onStatus(filter.id)}
              >
                {filter.label}
              </FilterChip>
            );
          })}
        </div>
        <label className="ml-auto w-full min-w-0 sm:w-52">
          <span className="sr-only">Search session events</span>
          <input
            ref={props.searchRef}
            type="search"
            value={props.query}
            placeholder="Search kind or detail"
            aria-keyshortcuts="/"
            onChange={(event) => props.onQuery(event.target.value)}
            className="h-8 w-full rounded-md border border-fp-line bg-fp-elev px-2.5 text-[12px] text-fp-ink placeholder:text-fp-faint"
          />
        </label>
      </div>
    </div>
  );
}

function FilterChip(props: {
  pressed: boolean;
  count: number;
  onClick: () => void;
  children: string;
  tone?: "lime" | "red" | "amber" | "mute";
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      onClick={props.onClick}
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition",
        props.pressed
          ? props.tone
            ? toneChip(props.tone)
            : "border-fp-lime/35 bg-fp-lime/10 text-fp-lime"
          : "border-fp-line bg-transparent text-fp-mute hover:bg-fp-hover hover:text-fp-ink",
      )}
    >
      <span className="truncate">{props.children}</span>
      <span className="font-mono text-[10px] tabular text-fp-faint">{props.count}</span>
    </button>
  );
}

function handleToolbarKeys(event: KeyboardEvent<HTMLDivElement>, root: HTMLDivElement | null): void {
  if (!root) {
    return;
  }
  const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
  if (!keys.includes(event.key)) {
    return;
  }
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
  if (buttons.length === 0) {
    return;
  }
  const current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
  const index = current ? buttons.indexOf(current) : 0;
  event.preventDefault();
  if (event.key === "Home") {
    buttons[0]?.focus();
    return;
  }
  if (event.key === "End") {
    buttons[buttons.length - 1]?.focus();
    return;
  }
  const dir = event.key === "ArrowRight" ? 1 : -1;
  const next = buttons[(index + dir + buttons.length) % buttons.length];
  next?.focus();
}
