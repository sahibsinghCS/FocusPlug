import type { SessionEvent } from "@shared/ipc";
import type { FaceEvent, FaceEventKind, FaceEventSeverity } from "./types";

export function clamp01(value: number, allowOver = false): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const max = allowOver ? 4 : 1;
  if (value < 0) {
    return 0;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function severityWeight(severity: FaceEventSeverity): number {
  if (severity === "high") {
    return 1;
  }
  if (severity === "medium") {
    return 0.58;
  }
  return 0.28;
}

function classify(event: SessionEvent): {
  kind: FaceEventKind;
  severity: FaceEventSeverity;
} | null {
  const kind = event.kind.trim().toLowerCase();
  const detail = event.detail.toLowerCase();

  if (kind === "settings" || kind === "lists" || kind === "plugs") {
    return null;
  }

  if (kind === "countdown" || kind === "policy") {
    if (detail.includes("cancel")) {
      return { kind: "unlock", severity: "low" };
    }
    return { kind: "countdown", severity: "medium" };
  }

  if (kind === "kill" || kind === "demo") {
    return { kind: "kill", severity: "high" };
  }

  if (kind === "plug_off") {
    return { kind: "kill", severity: "high" };
  }

  if (kind === "unlock" || kind === "plug_on") {
    return { kind: "unlock", severity: "low" };
  }

  if (kind === "session") {
    if (detail.includes("started")) {
      return { kind: "start", severity: "low" };
    }
    if (detail.includes("stopped")) {
      return { kind: "stop", severity: "low" };
    }
    return null;
  }

  if (kind === "decision") {
    if (detail.includes("distracted") || detail.includes("away")) {
      return { kind: "drift", severity: "medium" };
    }
    if (detail.includes("on_task")) {
      return { kind: "unlock", severity: "low" };
    }
    return null;
  }

  if (kind === "desk") {
    if (detail.includes("away")) {
      return { kind: "drift", severity: "medium" };
    }
    return null;
  }

  if (kind === "focus") {
    if (
      detail.includes("discord") ||
      detail.includes("blocked") ||
      detail.includes("steam") ||
      detail.includes("game")
    ) {
      return { kind: "drift", severity: "low" };
    }
    return null;
  }

  return null;
}

export function faceEventFromLog(
  event: SessionEvent,
  startedAt: number,
  durationMs: number,
): FaceEvent | null {
  const mapped = classify(event);
  if (!mapped) {
    return null;
  }
  const span = durationMs > 0 ? durationMs : 1;
  const at = clamp01((event.ts - startedAt) / span, true);
  return {
    ts: event.ts,
    kind: mapped.kind,
    sourceKind: event.kind,
    detail: event.detail,
    severity: mapped.severity,
    at,
  };
}

export function faceEventsFromLog(
  log: readonly SessionEvent[],
  startedAt: number,
  durationMs: number,
): FaceEvent[] {
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs)) {
    return [];
  }
  const out: FaceEvent[] = [];
  const chronological = [...log].sort((left, right) => left.ts - right.ts);
  for (const event of chronological) {
    const mapped = faceEventFromLog(event, startedAt, durationMs);
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

export function isBurstKind(kind: FaceEventKind): boolean {
  return kind === "countdown" || kind === "kill" || kind === "drift";
}
