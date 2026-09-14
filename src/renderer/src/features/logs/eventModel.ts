import type { Decision, SessionEvent } from "@shared/ipc";
import { decisionLabel, type Tone } from "../../lib/format";

export type CausalStage =
  | "sensor"
  | "decision"
  | "countdown"
  | "consequence"
  | "recovery"
  | "config";

export type EventStatus = "ok" | "error" | "cancelled";

export interface LogEventView {
  key: string;
  event: SessionEvent;
  kind: string;
  kindLabel: string;
  stage: CausalStage;
  stageLabel: string;
  status: EventStatus;
  statusLabel: string;
  title: string;
  reason: string | null;
  detail: string;
  tone: Tone;
}

const DECISIONS: readonly Decision[] = ["ON_TASK", "DISTRACTED", "AWAY", "IDLE"];

const REASON_LABELS: Record<string, string> = {
  blocked_focus: "Blocked focus",
  desk_away: "Desk AI Away",
  unlock: "Unlock",
  demo: "Demo Kill",
};

const KIND_LABELS: Record<string, string> = {
  focus: "Window",
  desk: "Desk AI",
  decision: "Decision",
  countdown: "Countdown",
  policy: "Countdown",
  kill: "Kill",
  demo: "Demo Kill",
  plug_off: "Plug off",
  plug_on: "Plug on",
  unlock: "Unlock",
  session: "Session",
  plan: "Focus Plan",
  correction: "Correction",
  settings: "Settings",
  lists: "Lists",
  plugs: "Plugs",
};

const STAGE_LABELS: Record<CausalStage, string> = {
  sensor: "Sensor",
  decision: "Decision",
  countdown: "Countdown",
  consequence: "Kill / plug off",
  recovery: "Unlock / plug on",
  config: "Setup",
};

const STATUS_LABELS: Record<EventStatus, string> = {
  ok: "OK",
  error: "Error",
  cancelled: "Cancelled",
};

export function isSessionEventShape(value: unknown): value is SessionEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.ts === "number" &&
    Number.isFinite(record.ts) &&
    typeof record.kind === "string" &&
    record.kind.trim().length > 0 &&
    typeof record.detail === "string"
  );
}

export function normalizeKind(kind: string): string {
  return kind.trim().toLowerCase();
}

export function stageForKind(kind: string): CausalStage {
  const key = normalizeKind(kind);
  if (key === "focus" || key === "desk") {
    return "sensor";
  }
  if (key === "decision" || key === "session") {
    return "decision";
  }
  if (key === "countdown" || key === "policy") {
    return "countdown";
  }
  if (key === "kill" || key === "demo" || key === "plug_off") {
    return "consequence";
  }
  if (key === "unlock" || key === "plug_on") {
    return "recovery";
  }
  return "config";
}

export function kindLabelFor(kind: string): string {
  const key = normalizeKind(kind);
  return KIND_LABELS[key] ?? kind.trim();
}

export function reasonLabelFor(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  const mapped = REASON_LABELS[normalizeKind(trimmed)];
  if (mapped) {
    return mapped;
  }
  if (trimmed === "Demo Kill") {
    return "Demo Kill";
  }
  return trimmed;
}

export function presentLog(events: readonly unknown[]): LogEventView[] {
  if (!Array.isArray(events)) {
    return [];
  }
  const views: LogEventView[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const item = events[index];
    if (!isSessionEventShape(item)) {
      continue;
    }
    views.push(presentEvent(item, index));
  }
  return views;
}

export function presentEvent(event: SessionEvent, index: number): LogEventView {
  const kind = normalizeKind(event.kind);
  const stage = stageForKind(kind);
  const status = statusFor(kind, event.detail);
  const parsed = parseHeadline(kind, event.detail);
  return {
    key: `${event.ts}:${kind}:${index}`,
    event,
    kind,
    kindLabel: kindLabelFor(kind),
    stage,
    stageLabel: STAGE_LABELS[stage],
    status,
    statusLabel: STATUS_LABELS[status],
    title: parsed.title,
    reason: parsed.reason,
    detail: event.detail,
    tone: toneFor(kind, status, parsed.decision, parsed.title),
  };
}

function statusFor(kind: string, detail: string): EventStatus {
  const lower = detail.toLowerCase();
  if (lower.includes("cancel_countdown") || /\bcancelled\b/.test(lower)) {
    return "cancelled";
  }
  if (/;\s*errors?:/i.test(detail) || /(?:^|\s)errors?:\s+\S/i.test(detail)) {
    return "error";
  }
  if (kind === "kill" && /killed nothing/i.test(detail) && /error/i.test(detail)) {
    return "error";
  }
  return "ok";
}

function parseHeadline(
  kind: string,
  detail: string,
): { title: string; reason: string | null; decision: Decision | null } {
  const parts = splitDetail(detail);
  const first = parts[0] ?? detail;
  const decision = parseDecision(first);

  if (kind === "decision" && decision) {
    return {
      title: decisionLabel(decision),
      reason: parts.length > 1 ? parts.slice(1).join(" · ") : null,
      decision,
    };
  }

  if (kind === "countdown" || kind === "policy") {
    if (detail.toLowerCase().includes("cancel_countdown")) {
      return { title: "Countdown cancelled", reason: null, decision: null };
    }
    if (detail.toLowerCase().includes("start_countdown")) {
      const reasonPart = parts.find(
        (part, index) => index > 0 && !/^\d+s$/i.test(part) && part !== "start_countdown",
      );
      return {
        title: "Countdown started",
        reason: reasonPart ? reasonLabelFor(reasonPart) : null,
        decision: null,
      };
    }
    return { title: "Countdown", reason: first || null, decision: null };
  }

  if (kind === "kill") {
    const reasonPart = parts[0] && !parts[0].toLowerCase().startsWith("killed") ? parts[0] : null;
    return {
      title: "App kill",
      reason: reasonPart ? reasonLabelFor(reasonPart) : null,
      decision: null,
    };
  }

  if (kind === "demo") {
    return { title: "Demo Kill", reason: null, decision: null };
  }

  if (kind === "unlock") {
    return { title: "Unlocked", reason: null, decision: null };
  }

  if (kind === "plug_off") {
    return { title: "Plug off", reason: plugTargetReason(parts), decision: null };
  }

  if (kind === "plug_on") {
    return { title: "Plug on", reason: plugTargetReason(parts), decision: null };
  }

  if (kind === "session") {
    if (detail.toLowerCase().includes("started")) {
      return { title: "Session started", reason: null, decision: null };
    }
    if (detail.toLowerCase().includes("stopped")) {
      return { title: "Session stopped", reason: "Observe only", decision: null };
    }
    return { title: "Session", reason: null, decision: null };
  }

  if (kind === "focus") {
    return { title: "Window", reason: detail.length > 0 ? detail : null, decision: null };
  }

  if (kind === "desk") {
    return parseDeskHeadline(detail);
  }

  if (kind === "lists") {
    return { title: first || "Lists", reason: parts[1] ?? null, decision: null };
  }

  if (kind === "settings") {
    return { title: "Settings saved", reason: null, decision: null };
  }

  if (kind === "plugs") {
    return { title: first || "Plugs", reason: parts[1] ?? null, decision: null };
  }

  return {
    title: kindLabelFor(kind),
    reason: detail.length > 0 ? detail : null,
    decision: null,
  };
}

function parseDeskHeadline(detail: string): {
  title: string;
  reason: string | null;
  decision: Decision | null;
} {
  const parts = splitDetail(detail);
  const first = (parts[0] ?? detail).trim();
  const key = first.toLowerCase();
  if (key === "at_desk" || key.startsWith("at_desk")) {
    return { title: "At desk", reason: parts.slice(1).join(" · ") || null, decision: null };
  }
  if (key === "away") {
    return { title: "Away", reason: parts.slice(1).join(" · ") || null, decision: null };
  }
  if (key === "uncertain") {
    return { title: "Uncertain", reason: parts.slice(1).join(" · ") || null, decision: null };
  }
  if (/webcam enabled/i.test(detail)) {
    return { title: "Webcam enabled", reason: null, decision: null };
  }
  if (/webcam disabled/i.test(detail)) {
    return { title: "Webcam disabled", reason: null, decision: null };
  }
  if (/desk model set to/i.test(detail)) {
    return { title: "Desk model", reason: detail, decision: null };
  }
  return { title: "Desk AI", reason: detail, decision: null };
}

function plugTargetReason(parts: string[]): string | null {
  const target = parts.find((part) => part !== "off" && part !== "on" && !/^errors?:/i.test(part));
  if (!target || target === "none") {
    return null;
  }
  return target;
}

function parseDecision(value: string): Decision | null {
  const token = value.trim().toUpperCase();
  for (const decision of DECISIONS) {
    if (token === decision || token.startsWith(`${decision} `)) {
      return decision;
    }
  }
  return null;
}

function splitDetail(detail: string): string[] {
  return detail
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function toneFor(
  kind: string,
  status: EventStatus,
  decision: Decision | null,
  title: string,
): Tone {
  if (status === "error") {
    return "red";
  }
  if (status === "cancelled") {
    return "mute";
  }
  if (kind === "kill" || kind === "demo" || kind === "plug_off" || decision === "DISTRACTED") {
    return "red";
  }
  if (kind === "unlock" || kind === "plug_on" || decision === "ON_TASK" || title === "At desk") {
    return "focus";
  }
  if (kind === "countdown" || kind === "policy" || decision === "AWAY" || title === "Away") {
    return "warn";
  }
  return "mute";
}
