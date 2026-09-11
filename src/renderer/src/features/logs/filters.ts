import type { EventStatus, LogEventView } from "./eventModel";
import { normalizeKind } from "./eventModel";

export type KindFilterId =
  | "all"
  | "focus"
  | "desk"
  | "decision"
  | "countdown"
  | "kill"
  | "demo"
  | "plug_off"
  | "unlock"
  | "plug_on"
  | "session"
  | "config"
  | "other";

export type StatusFilterId = "all" | EventStatus;

export interface KindFilter {
  id: KindFilterId;
  label: string;
  kinds: readonly string[] | null;
  always: boolean;
}

export const KIND_FILTERS: readonly KindFilter[] = [
  { id: "all", label: "All", kinds: null, always: true },
  { id: "focus", label: "Window", kinds: ["focus"], always: true },
  { id: "desk", label: "Desk AI", kinds: ["desk"], always: true },
  { id: "decision", label: "Decision", kinds: ["decision"], always: true },
  { id: "countdown", label: "Countdown", kinds: ["countdown", "policy"], always: true },
  { id: "kill", label: "Kill", kinds: ["kill"], always: true },
  { id: "plug_off", label: "Plug off", kinds: ["plug_off"], always: true },
  { id: "unlock", label: "Unlock", kinds: ["unlock"], always: true },
  { id: "plug_on", label: "Plug on", kinds: ["plug_on"], always: true },
  { id: "demo", label: "Demo Kill", kinds: ["demo"], always: true },
  { id: "session", label: "Session", kinds: ["session"], always: false },
  { id: "config", label: "Settings", kinds: ["settings", "lists", "plugs"], always: false },
  { id: "other", label: "Other", kinds: [], always: false },
];

export const STATUS_FILTERS: ReadonlyArray<{ id: StatusFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "ok", label: "OK" },
  { id: "error", label: "Error" },
  { id: "cancelled", label: "Cancelled" },
];

const CLASSIFIED_KINDS: ReadonlySet<string> = new Set(
  KIND_FILTERS.flatMap((filter) => (filter.kinds ? [...filter.kinds] : [])),
);

export function isKindFilterId(value: string): value is KindFilterId {
  return KIND_FILTERS.some((filter) => filter.id === value);
}

export function isStatusFilterId(value: string): value is StatusFilterId {
  return STATUS_FILTERS.some((filter) => filter.id === value);
}

export function kindMatchesFilter(kind: string, filter: KindFilter): boolean {
  const key = normalizeKind(kind);
  if (filter.id === "all" || filter.kinds === null) {
    return true;
  }
  if (filter.id === "other") {
    return !CLASSIFIED_KINDS.has(key);
  }
  return filter.kinds.includes(key);
}

export function visibleKindFilters(views: readonly LogEventView[]): KindFilter[] {
  return KIND_FILTERS.filter((filter) => {
    if (filter.always) {
      return true;
    }
    return views.some((view) => kindMatchesFilter(view.kind, filter));
  });
}

export function countKindFilter(views: readonly LogEventView[], filter: KindFilter): number {
  if (filter.id === "all") {
    return views.length;
  }
  return views.filter((view) => kindMatchesFilter(view.kind, filter)).length;
}

export function countStatusFilter(views: readonly LogEventView[], status: StatusFilterId): number {
  if (status === "all") {
    return views.length;
  }
  return views.filter((view) => view.status === status).length;
}

export function filterLogEvents(
  views: readonly LogEventView[],
  options: {
    kind: string;
    status: string;
    query: string;
  },
): LogEventView[] {
  const kindId = isKindFilterId(options.kind) ? options.kind : "all";
  const statusId = isStatusFilterId(options.status) ? options.status : "all";
  const kindFilter = KIND_FILTERS.find((filter) => filter.id === kindId) ?? KIND_FILTERS[0];
  const needle = options.query.trim().toLowerCase();

  return views.filter((view) => {
    if (!kindFilter || !kindMatchesFilter(view.kind, kindFilter)) {
      return false;
    }
    if (statusId !== "all" && view.status !== statusId) {
      return false;
    }
    if (needle.length === 0) {
      return true;
    }
    return eventMatchesQuery(view, needle);
  });
}

export function eventMatchesQuery(view: LogEventView, needle: string): boolean {
  const haystacks = [
    view.kind,
    view.kindLabel,
    view.stageLabel,
    view.statusLabel,
    view.title,
    view.reason ?? "",
    view.detail,
    view.event.kind,
    view.event.detail,
  ];
  return haystacks.some((text) => text.toLowerCase().includes(needle));
}
