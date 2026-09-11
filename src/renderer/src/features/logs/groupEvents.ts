import type { LogEventView } from "./eventModel";

const CLUSTER_GAP_MS = 45_000;

export interface TimelineGroup {
  id: string;
  summary: string;
  events: LogEventView[];
  startedAt: number;
  endedAt: number;
}

export function groupLogEvents(views: readonly LogEventView[]): TimelineGroup[] {
  if (views.length === 0) {
    return [];
  }

  const chronological = [...views].sort((left, right) => {
    if (left.event.ts !== right.event.ts) {
      return left.event.ts - right.event.ts;
    }
    return left.key.localeCompare(right.key);
  });

  const clusters: LogEventView[][] = [];
  for (const view of chronological) {
    const current = clusters[clusters.length - 1];
    if (!current || shouldStartGroup(current, view)) {
      clusters.push([view]);
      continue;
    }
    current.push(view);
  }

  return clusters
    .slice()
    .reverse()
    .map((events, index) => {
      const first = events[0];
      const last = events[events.length - 1];
      if (!first || !last) {
        return {
          id: `empty-${index}`,
          summary: "Events",
          events,
          startedAt: 0,
          endedAt: 0,
        };
      }
      return {
        id: `${first.key}:${last.key}:${index}`,
        summary: summarizeGroup(events),
        events,
        startedAt: first.event.ts,
        endedAt: last.event.ts,
      };
    });
}

export function formatGroupSpan(startedAt: number, endedAt: number): string | null {
  const span = Math.max(0, endedAt - startedAt);
  if (span < 1000) {
    return null;
  }
  if (span < 60_000) {
    return `${Math.round(span / 1000)}s span`;
  }
  return `${Math.round(span / 60_000)}m span`;
}

export function formatEventDelta(previousTs: number | null, ts: number): string | null {
  if (previousTs === null) {
    return null;
  }
  const delta = ts - previousTs;
  if (delta < 100) {
    return null;
  }
  if (delta < 60_000) {
    const seconds = delta / 1000;
    const rounded = seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds));
    return `+${rounded}s`;
  }
  return `+${Math.round(delta / 60_000)}m`;
}

function shouldStartGroup(current: readonly LogEventView[], next: LogEventView): boolean {
  const previous = current[current.length - 1];
  if (!previous) {
    return true;
  }
  if (isSessionStart(next)) {
    return true;
  }
  const prevConfig = previous.stage === "config";
  const nextConfig = next.stage === "config";
  if (prevConfig !== nextConfig) {
    return true;
  }
  if (next.event.ts - previous.event.ts > CLUSTER_GAP_MS) {
    return true;
  }
  if (isDemoKill(next) && current.some((event) => event.kind === "kill" || event.kind === "unlock")) {
    return true;
  }
  if (episodeClosed(current) && opensNewEpisode(next)) {
    return true;
  }
  return false;
}

function isSessionStart(view: LogEventView): boolean {
  return view.kind === "session" && view.event.detail.toLowerCase().includes("started");
}

function isDemoKill(view: LogEventView): boolean {
  return view.kind === "demo" || (view.kind === "kill" && /demo/i.test(view.event.detail));
}

function episodeClosed(events: readonly LogEventView[]): boolean {
  const hasConsequence = events.some(
    (event) => event.kind === "kill" || event.kind === "demo" || event.kind === "plug_off",
  );
  const hasRecovery = events.some((event) => event.kind === "unlock" || event.kind === "plug_on");
  return hasConsequence && hasRecovery;
}

function opensNewEpisode(view: LogEventView): boolean {
  if (view.kind === "countdown" || view.kind === "policy") {
    return view.status !== "cancelled";
  }
  if (view.kind === "kill" || view.kind === "demo" || view.kind === "plug_off") {
    return true;
  }
  if (view.kind === "decision") {
    return view.title === "Distracted" || view.title === "Away";
  }
  return false;
}

function summarizeGroup(events: readonly LogEventView[]): string {
  const tokens: string[] = [];
  for (const event of events) {
    const token = flowToken(event);
    if (token && tokens[tokens.length - 1] !== token) {
      tokens.push(token);
    }
  }
  if (tokens.length === 0) {
    return events[0]?.kindLabel ?? "Events";
  }
  return tokens.join(" → ");
}

function flowToken(event: LogEventView): string | null {
  if (event.kind === "focus") {
    return "Window";
  }
  if (event.kind === "desk") {
    return event.title;
  }
  if (event.kind === "decision") {
    return event.title;
  }
  if (event.kind === "session") {
    return event.title;
  }
  if (event.stage === "countdown") {
    return event.status === "cancelled" ? "Cancelled" : "Countdown";
  }
  if (event.kind === "kill") {
    return "Kill";
  }
  if (event.kind === "demo") {
    return "Demo Kill";
  }
  if (event.kind === "plug_off") {
    return "Plug off";
  }
  if (event.kind === "unlock") {
    return "Unlock";
  }
  if (event.kind === "plug_on") {
    return "Plug on";
  }
  if (event.stage === "config") {
    return event.kindLabel;
  }
  return event.kindLabel;
}
