import type { LogEventView } from "./eventModel";

const CLUSTER_GAP_MS = 45_000;

const STAGE_RANK: Record<LogEventView["stage"], number> = {
  sensor: 0,
  decision: 1,
  countdown: 2,
  consequence: 3,
  recovery: 4,
  config: 5,
};

function compareCausal(left: LogEventView, right: LogEventView): number {
  const delta = left.event.ts - right.event.ts;
  if (Math.abs(delta) >= 500) {
    return delta;
  }
  const rank = STAGE_RANK[left.stage] - STAGE_RANK[right.stage];
  if (rank !== 0) {
    return rank;
  }
  if (delta !== 0) {
    return delta;
  }
  return left.key.localeCompare(right.key);
}

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

  const chronological = [...views].sort(compareCausal);

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
  if (shouldSplitArmedFromFuse(current, next)) {
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

function shouldSplitArmedFromFuse(current: readonly LogEventView[], next: LogEventView): boolean {
  if (!armedQuietCluster(current)) {
    return false;
  }
  const lastOnTask = [...current].reverse().find((event) => event.title === "On task");
  if (!lastOnTask || next.event.ts - lastOnTask.event.ts < 5_000) {
    return false;
  }
  return opensNewEpisode(next) || next.kind === "focus";
}

function armedQuietCluster(events: readonly LogEventView[]): boolean {
  const armed = events.some((event) => event.title === "On task" || isSessionStart(event));
  const alreadyFusing = events.some(
    (event) =>
      event.stage === "countdown" ||
      event.kind === "kill" ||
      event.kind === "demo" ||
      event.title === "Distracted" ||
      event.title === "Away",
  );
  return armed && !alreadyFusing;
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
  const spine = tokens.filter((token) => SPINE_HEADLINE.has(token));
  if (spine.length >= 2) {
    return spine.join(" → ");
  }
  return tokens.join(" → ");
}

const SPINE_HEADLINE = new Set([
  "Distracted",
  "Away",
  "Countdown",
  "Cancelled",
  "Kill",
  "Demo Kill",
  "Plug off",
  "Unlock",
  "Plug on",
]);

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
