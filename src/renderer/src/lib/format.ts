import type {
  Decision,
  DeskLabel,
  DeskModelId,
  DeskSnapshot,
  FocusSnapshot,
  SessionState,
} from "@shared/ipc";
import type { PlugView } from "./plugsUi";
import { plugKillNote as plugKillNoteFromViews, summarizePlugs } from "./plugsUi";

export type Tone = "lime" | "red" | "amber" | "mute";

export function decisionLabel(decision: Decision): string {
  if (decision === "ON_TASK") return "On task";
  if (decision === "DISTRACTED") return "Distracted";
  if (decision === "AWAY") return "Away";
  return "Idle";
}

export function decisionTone(decision: Decision): Tone {
  if (decision === "ON_TASK") return "lime";
  if (decision === "DISTRACTED") return "red";
  if (decision === "AWAY") return "amber";
  return "mute";
}

export function deskLabel(label: DeskLabel): string {
  if (label === "at_desk") return "At desk";
  if (label === "away") return "Away";
  return "Uncertain";
}

export function deskTone(label: DeskLabel): Tone {
  if (label === "at_desk") return "lime";
  if (label === "away") return "amber";
  return "mute";
}

export function focusFlag(focus: FocusSnapshot | null): {
  label: string;
  tone: Tone;
} {
  if (!focus) {
    return { label: "Waiting", tone: "mute" };
  }
  if (focus.matchedBlock) {
    return { label: "Blocked", tone: "red" };
  }
  if (focus.matchedAllow) {
    return { label: "Allowlisted", tone: "lime" };
  }
  return { label: "Unmatched", tone: "amber" };
}

export function formatConfidence(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return `${Math.round(clamped * 100)}%`;
}

export function formatClock(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatRelative(ts: number, now: number): string {
  const delta = Math.max(0, now - ts);
  if (delta < 2000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return formatClock(ts);
}

export function padCountdown(seconds: number): string {
  if (seconds > 99) return String(seconds);
  return String(Math.max(0, seconds)).padStart(2, "0");
}

export function windowPrimary(focus: FocusSnapshot | null): string {
  if (!focus) return "No foreground app";
  return focus.processName.length > 0 ? focus.processName : "Unknown process";
}

export function windowSecondary(focus: FocusSnapshot | null): string {
  if (!focus) return "Window monitor idle";
  return focus.windowTitle.length > 0 ? focus.windowTitle : "Untitled window";
}

export function deskPrimary(desk: DeskSnapshot | null): string {
  if (!desk) return "Desk AI standby";
  return deskLabel(desk.label);
}

export function sessionModeLabel(state: SessionState): string {
  return state.sessionActive ? "Live" : "Standby";
}

export function deskModelLabel(model: DeskModelId): string {
  if (model === "stub") return "Stub";
  if (model === "custom") return "Custom";
  return "BlazeFace";
}

export function plugPowerLabel(plug: PlugView): string {
  if (plug.error) return "Error";
  if (!plug.online) return "Offline";
  if (plug.powerOn === null) return "Unknown";
  return plug.powerOn ? "Power on" : "Power off";
}

export function plugStatusLine(plugs: readonly PlugView[]): string {
  return summarizePlugs(plugs);
}

export function plugKillNote(plugs: readonly PlugView[]): string | null {
  return plugKillNoteFromViews(plugs);
}
