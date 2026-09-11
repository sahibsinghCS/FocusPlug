import type { Decision, DeskModelId, DeskSnapshot, FocusSnapshot, SessionEvent } from "@shared/ipc";
import type { Tone } from "../../lib/format";
import {
  deskLabel,
  deskModelLabel,
  formatConfidence,
  plugStatusLine,
} from "../../lib/format";
import { enabledPlugViews, type PlugView } from "../../lib/plugsUi";

export type TimelineStage = "cause" | "countdown" | "consequence" | "recovery";

export interface DecisionHeroCopy {
  decision: Decision;
  headline: string;
  verb: string;
  tone: Tone;
  explanation: string;
}

export interface SessionClockView {
  elapsedSec: number | null;
  elapsedLabel: string;
  fuseSec: number;
  fuseLive: boolean;
  fuseLabel: string;
  primary: "elapsed" | "fuse";
}

export interface SensorCardView {
  id: "window" | "desk" | "plugs";
  label: string;
  title: string;
  body: string;
  meta: string;
  tone: Tone;
  live: boolean;
  empty: boolean;
}

export interface TimelineEventView {
  ts: number;
  kind: string;
  detail: string;
  stage: TimelineStage;
}

export interface TimelinePreview {
  events: TimelineEventView[];
  reached: Record<TimelineStage, boolean>;
  empty: boolean;
}

const STAGE_ORDER: readonly TimelineStage[] = ["cause", "countdown", "consequence", "recovery"];

export function decisionHeroCopy(decision: Decision, detail: string): DecisionHeroCopy {
  if (decision === "ON_TASK") {
    return {
      decision,
      headline: "ON TASK",
      verb: "Armed",
      tone: "lime",
      explanation: detail.trim().length > 0 ? detail : "Allowlisted focus and desk presence.",
    };
  }
  if (decision === "DISTRACTED") {
    return {
      decision,
      headline: "DISTRACTED",
      verb: "Fuse live",
      tone: "red",
      explanation: detail.trim().length > 0 ? detail : "Blocked app in focus.",
    };
  }
  if (decision === "AWAY") {
    return {
      decision,
      headline: "AWAY",
      verb: "Chair empty",
      tone: "amber",
      explanation: detail.trim().length > 0 ? detail : "High-confidence desk absence.",
    };
  }
  return {
    decision: "IDLE",
    headline: "IDLE",
    verb: "Observe only",
    tone: "mute",
    explanation: detail.trim().length > 0 ? detail : "Session off — observe only.",
  };
}

export function decisionConsequence(decision: Decision): string {
  if (decision === "ON_TASK") {
    return "Leave the assignment and the fuse starts. Blocked apps die; armed plugs cut.";
  }
  if (decision === "DISTRACTED") {
    return "Force-quit blocked apps and cut armed plugs when the fuse hits zero.";
  }
  if (decision === "AWAY") {
    return "High-confidence Away kills running blocklist apps and cuts armed plugs. Uncertain never kills on desk alone.";
  }
  return "Start the session to arm force-quit and plug cut. Watching does not enforce.";
}

export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function sessionClockView(input: {
  sessionActive: boolean;
  elapsedSec: number | null;
  countdownSec: number;
  fuseSec: number;
}): SessionClockView {
  const fuseLive = input.sessionActive && input.countdownSec > 0;
  const fuseSec = fuseLive ? input.countdownSec : input.fuseSec;
  const elapsedSec = input.sessionActive ? (input.elapsedSec ?? 0) : null;
  return {
    elapsedSec,
    elapsedLabel: elapsedSec === null ? "—" : formatElapsed(elapsedSec),
    fuseSec,
    fuseLive,
    fuseLabel: fuseLive ? `${String(Math.max(0, fuseSec)).padStart(2, "0")}s` : `${input.fuseSec}s armed`,
    primary: fuseLive ? "fuse" : "elapsed",
  };
}

export function findSessionStartedAt(
  log: readonly SessionEvent[],
  sessionActive: boolean,
): number | null {
  if (!sessionActive) {
    return null;
  }
  let latest: number | null = null;
  for (const event of log) {
    if (event.kind.toLowerCase() !== "session") {
      continue;
    }
    if (!/started/i.test(event.detail)) {
      continue;
    }
    if (latest === null || event.ts > latest) {
      latest = event.ts;
    }
  }
  return latest;
}

export function elapsedSeconds(startedAt: number | null, now: number): number | null {
  if (startedAt === null) {
    return null;
  }
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function resolveAppName(
  processName: string,
  lists: {
    allowlist: ReadonlyArray<{ name: string; match: string[] }>;
    blocklist: ReadonlyArray<{ name: string; match: string[] }>;
  },
): string {
  const needle = processName.toLowerCase();
  if (needle.length === 0 || needle === "no foreground app") {
    return processName.length > 0 ? processName : "No foreground app";
  }
  const all = [...lists.allowlist, ...lists.blocklist];
  const hit = all.find((entry) =>
    entry.match.some(
      (token) => needle.includes(token.toLowerCase()) || token.toLowerCase().includes(needle),
    ),
  );
  return hit?.name ?? processName;
}

export function windowSensor(
  focus: FocusSnapshot | null,
  lists: {
    allowlist: ReadonlyArray<{ name: string; match: string[] }>;
    blocklist: ReadonlyArray<{ name: string; match: string[] }>;
  },
): SensorCardView {
  if (!focus) {
    return {
      id: "window",
      label: "Foreground app",
      title: "Waiting",
      body: "Window monitor has not reported a process yet.",
      meta: "No snapshot",
      tone: "mute",
      live: false,
      empty: true,
    };
  }
  const title = resolveAppName(focus.processName, lists);
  const body = focus.windowTitle.length > 0 ? focus.windowTitle : "Untitled window";
  if (focus.matchedBlock) {
    return {
      id: "window",
      label: "Foreground app",
      title,
      body,
      meta: "Blocklisted",
      tone: "red",
      live: true,
      empty: false,
    };
  }
  if (focus.matchedAllow) {
    return {
      id: "window",
      label: "Foreground app",
      title,
      body,
      meta: "Allowlisted",
      tone: "lime",
      live: true,
      empty: false,
    };
  }
  return {
    id: "window",
    label: "Foreground app",
    title,
    body,
    meta: "Unmatched",
    tone: "amber",
    live: true,
    empty: false,
  };
}

export function deskSensor(desk: DeskSnapshot | null, modelId: DeskModelId): SensorCardView {
  const model = deskModelLabel(modelId);
  if (!desk) {
    return {
      id: "desk",
      label: "Desk AI",
      title: "Standby",
      body: "Presence model has not reported a label yet.",
      meta: model,
      tone: "mute",
      live: false,
      empty: true,
    };
  }
  const title = deskLabel(desk.label);
  const confidence = formatConfidence(desk.confidence);
  const webcam = desk.webcamEnabled ? "Webcam on" : "Webcam off";
  const tone: Tone = desk.label === "at_desk" ? "lime" : desk.label === "away" ? "amber" : "mute";
  return {
    id: "desk",
    label: "Desk AI",
    title,
    body: `${confidence} confidence · ${webcam}`,
    meta: model,
    tone,
    live: desk.webcamEnabled,
    empty: false,
  };
}

export function plugsSensor(plugs: readonly PlugView[]): SensorCardView {
  if (plugs.length === 0) {
    return {
      id: "plugs",
      label: "Armed plugs",
      title: "None configured",
      body: "No outlets. Kill still force-quits apps; nothing to cut.",
      meta: "Study PC never commanded",
      tone: "mute",
      live: false,
      empty: true,
    };
  }
  const armed = enabledPlugViews(plugs);
  if (armed.length === 0) {
    return {
      id: "plugs",
      label: "Armed plugs",
      title: "None armed",
      body: "Outlets exist but Demo Kill will not cut them.",
      meta: plugStatusLine(plugs),
      tone: "amber",
      live: false,
      empty: false,
    };
  }
  const names = armed.map((plug) => plug.name).join(", ");
  const cut = armed.every((plug) => plug.powerOn === false);
  const on = armed.some((plug) => plug.online && plug.powerOn === true);
  return {
    id: "plugs",
    label: "Armed plugs",
    title: cut ? "Cut" : on ? "Power on" : plugStatusLine(plugs),
    body: `${names} — never the study PC`,
    meta: plugStatusLine(plugs),
    tone: cut ? "red" : on ? "lime" : "amber",
    live: on,
    empty: false,
  };
}

export function classifySessionEvent(event: SessionEvent): TimelineStage {
  const kind = event.kind.toLowerCase();
  const detail = event.detail.toLowerCase();

  if (kind === "kill" || kind === "demo" || kind === "plug_off") {
    return "consequence";
  }
  if (kind === "unlock" || kind === "plug_on") {
    return "recovery";
  }
  if (kind === "countdown" || kind === "policy") {
    if (detail.includes("cancel")) {
      return "recovery";
    }
    if (detail.includes("start_countdown") || detail.includes("fuse")) {
      return "countdown";
    }
  }
  if (kind === "session" && /stopped|observe only/.test(detail)) {
    return "recovery";
  }
  if (kind === "decision") {
    if (detail.includes("on_task")) {
      return "recovery";
    }
    return "cause";
  }
  return "cause";
}

function stageForEvent(event: SessionEvent, sawConsequence: boolean): TimelineStage {
  const kind = event.kind.toLowerCase();
  const detail = event.detail.toLowerCase();
  if (kind === "decision" && detail.includes("on_task")) {
    return sawConsequence ? "recovery" : "cause";
  }
  return classifySessionEvent(event);
}

const PREVIEW_KINDS = new Set([
  "session",
  "focus",
  "desk",
  "decision",
  "countdown",
  "policy",
  "kill",
  "demo",
  "unlock",
  "plug_off",
  "plug_on",
]);

export function isEnforcementEvent(event: SessionEvent): boolean {
  const kind = event.kind.toLowerCase();
  if (!PREVIEW_KINDS.has(kind)) {
    return false;
  }
  if (kind === "settings" || kind === "lists" || kind === "plugs") {
    return false;
  }
  return true;
}

export function buildTimelinePreview(
  log: readonly SessionEvent[],
  limit = 12,
): TimelinePreview {
  const chronological = log
    .filter(isEnforcementEvent)
    .slice()
    .sort((left, right) => left.ts - right.ts);

  const reached: Record<TimelineStage, boolean> = {
    cause: false,
    countdown: false,
    consequence: false,
    recovery: false,
  };

  let sawConsequence = false;
  const tagged: TimelineEventView[] = [];
  for (const event of chronological) {
    const stage = stageForEvent(event, sawConsequence);
    if (stage === "consequence") {
      sawConsequence = true;
    }
    reached[stage] = true;
    tagged.push({
      ts: event.ts,
      kind: event.kind,
      detail: event.detail,
      stage,
    });
  }

  const events = tagged.slice().reverse().slice(0, limit);

  return {
    events,
    reached,
    empty: events.length === 0,
  };
}

export function stageLabel(stage: TimelineStage): string {
  if (stage === "cause") return "Cause";
  if (stage === "countdown") return "Countdown";
  if (stage === "consequence") return "Consequence";
  return "Recovery";
}

export function stageHint(stage: TimelineStage): string {
  if (stage === "cause") return "Blocked focus or desk Away";
  if (stage === "countdown") return "Fuse started";
  if (stage === "consequence") return "App kill + plugs cut";
  return "Unlock when back on task";
}

export function overlayConsequenceLines(plugs: readonly PlugView[]): {
  apps: string;
  plugs: string;
} {
  const armed = enabledPlugViews(plugs);
  return {
    apps: "Blocked apps will be force-quit",
    plugs:
      armed.length > 0
        ? `Armed plugs will be cut (${armed.map((plug) => plug.name).join(", ")})`
        : "No plugs armed — apps still die; study PC is never cut",
  };
}

export { STAGE_ORDER };
