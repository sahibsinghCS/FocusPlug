import type {
  AttentionLabel,
  Decision,
  DeskLabel,
  DeskModelId,
  DeskSnapshot,
  FocusSnapshot,
  SessionState,
} from "@shared/ipc";
import type { PlugView } from "./plugsUi";
import { plugKillNote as plugKillNoteFromViews, summarizePlugs } from "./plugsUi";

/**
 * Console tone vocabulary. `focus`/`red`/`warn`/`mute` are the monochrome
 * register every surface shares; `amber` is the forecast's own step before
 * red — pre-armed, fuse shortened, nothing dead yet — and has to read apart
 * from red at a glance or the warning is wasted (see --color-fp-amber).
 */
export type Tone = "focus" | "red" | "warn" | "amber" | "mute";

export function decisionLabel(decision: Decision): string {
  if (decision === "ON_TASK") return "On task";
  if (decision === "DISTRACTED") return "Distracted";
  if (decision === "AWAY") return "Away";
  return "Idle";
}

export function decisionTone(decision: Decision): Tone {
  if (decision === "ON_TASK") return "focus";
  if (decision === "DISTRACTED") return "red";
  if (decision === "AWAY") return "warn";
  return "mute";
}

export function deskLabel(label: DeskLabel): string {
  if (label === "at_desk") return "At desk";
  if (label === "away") return "Away";
  return "Uncertain";
}

export function attentionLabel(label: AttentionLabel): string {
  if (label === "phone") return "On phone";
  if (label === "unfocused") return "Unfocused";
  return "Focused";
}

export function deskTone(label: DeskLabel): Tone {
  if (label === "at_desk") return "focus";
  if (label === "away") return "warn";
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
    return { label: "Allowlisted", tone: "focus" };
  }
  return { label: "Unmatched", tone: "warn" };
}

export function formatConfidence(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return `${Math.round(clamped * 100)}%`;
}

export function formatClock(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatHmClock(ts: number): string {
  if (!Number.isFinite(ts)) {
    throw new Error("timestamp must be a finite number");
  }
  return new Date(ts).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
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
  if (desk.label === "at_desk" && desk.attention) return attentionLabel(desk.attention.label);
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
  if (!plug.probed) return "Not tested";
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

export interface ChromeStatus {
  label: string;
  detail: string;
  tone: Tone;
  live: boolean;
}

export function sessionChrome(state: SessionState): ChromeStatus {
  if (!state.sessionActive) {
    return { label: "Session", detail: "Standby", tone: "mute", live: false };
  }
  return {
    label: "Session",
    detail: decisionLabel(state.decision),
    tone: decisionTone(state.decision),
    live: true,
  };
}

export function deskChrome(desk: DeskSnapshot | null): ChromeStatus {
  if (!desk) {
    return { label: "Desk AI", detail: "Standby", tone: "mute", live: false };
  }
  if (!desk.webcamEnabled) {
    return { label: "Desk AI", detail: "Webcam off", tone: "mute", live: false };
  }
  if (desk.label === "at_desk" && desk.attention) {
    const focused = desk.attention.label === "focused";
    return {
      label: "Desk AI",
      detail: `${attentionLabel(desk.attention.label)} ${formatConfidence(desk.attention.confidence)}`,
      tone: focused ? "focus" : "warn",
      live: focused,
    };
  }
  return {
    label: "Desk AI",
    detail: `${deskLabel(desk.label)} ${formatConfidence(desk.confidence)}`,
    tone: deskTone(desk.label),
    live: desk.label === "at_desk",
  };
}

export function plugChrome(plugs: readonly PlugView[]): ChromeStatus {
  if (plugs.length === 0) {
    return { label: "Plugs", detail: "None", tone: "mute", live: false };
  }
  const armed = plugs.filter((plug) => plug.enabled);
  if (armed.length === 0) {
    return { label: "Plugs", detail: "Idle", tone: "mute", live: false };
  }
  const on = armed.filter((plug) => plug.powerOn === true).length;
  const allOff = armed.every((plug) => plug.powerOn === false);
  return {
    label: "Plugs",
    detail: `${armed.length} armed`,
    tone: allOff ? "red" : on > 0 ? "focus" : "warn",
    live: on > 0,
  };
}
