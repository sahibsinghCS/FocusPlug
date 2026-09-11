import { ALL_BLOCKLIST_TARGET } from "./constants";
import type { Decision, DeskSnapshot, FocusSnapshot, PolicyEvent, PolicyInput } from "../types";

export type DeskPresence = "present" | "away" | "uncertain";
export type FocusKind = "allow" | "block" | "other" | "none";
export type ViolationKind = "blocked" | "away";

export interface ClassifiedPolicy {
  decision: Decision;
  detail: string;
  focus: FocusKind;
  desk: DeskPresence;
  onTask: boolean;
  violation: ViolationKind | null;
}

/**
 * Desk-away / at-desk only count when the webcam is on, the label is not
 * `uncertain`, and confidence is at least `deskThreshold`. Anything else is
 * uncertain — and uncertain must never produce a desk-only kill.
 */
export function deskPresence(
  desk: DeskSnapshot | null,
  threshold: number,
): DeskPresence {
  if (desk === null) {
    return "uncertain";
  }
  if (!desk.webcamEnabled) {
    return "uncertain";
  }
  if (desk.label === "uncertain") {
    return "uncertain";
  }
  if (!Number.isFinite(desk.confidence) || !Number.isFinite(threshold)) {
    return "uncertain";
  }
  if (desk.confidence < threshold) {
    return "uncertain";
  }
  if (desk.label === "at_desk") {
    return "present";
  }
  return "away";
}

/**
 * Block matches win over allow matches so a dual-listed window is treated as
 * a distraction (enforcement-first).
 */
export function focusKind(focus: FocusSnapshot | null): FocusKind {
  if (focus === null) {
    return "none";
  }
  if (focus.matchedBlock) {
    return "block";
  }
  if (focus.matchedAllow) {
    return "allow";
  }
  return "other";
}

export function isOnTask(
  focus: FocusKind,
  desk: DeskPresence,
  strictMode: boolean,
): boolean {
  if (focus !== "allow") {
    return false;
  }
  if (strictMode) {
    return desk === "present";
  }
  return true;
}

export function classify(input: PolicyInput): ClassifiedPolicy {
  const focus = focusKind(input.focus);
  const desk = deskPresence(input.desk, input.deskThreshold);
  const onTask = isOnTask(focus, desk, input.strictMode);

  if (onTask) {
    return {
      decision: "ON_TASK",
      detail: onTaskDetail(input),
      focus,
      desk,
      onTask: true,
      violation: null,
    };
  }

  if (focus === "block") {
    return {
      decision: "DISTRACTED",
      detail: distractedDetail(input),
      focus,
      desk,
      onTask: false,
      violation: "blocked",
    };
  }

  if (desk === "away") {
    return {
      decision: "AWAY",
      detail: "Away from desk",
      focus,
      desk,
      onTask: false,
      violation: "away",
    };
  }

  return {
    decision: "IDLE",
    detail: idleDetail(focus, desk),
    focus,
    desk,
    onTask: false,
    violation: null,
  };
}

/**
 * Device ids to attach to `plug_off` / `plug_on`. Empty means emit neither.
 *
 * `plugsArmed` defaults to true when ids exist (session setting omitted).
 * Whitespace-only ids are dropped. The returned array is a copy.
 */
export function plugDeviceIds(input: PolicyInput): string[] {
  const ids = input.enabledPlugIds ?? [];
  const armed = input.plugsArmed ?? ids.length > 0;
  if (!armed) {
    return [];
  }
  return unique(ids.map((id) => id.trim()).filter((id) => id.length > 0));
}

export function plugEventFor(
  type: "plug_off" | "plug_on",
  input: PolicyInput,
  reason: string,
): Extract<PolicyEvent, { type: "plug_off" | "plug_on" }> | null {
  if (!input.sessionActive) {
    return null;
  }
  const deviceIds = plugDeviceIds(input);
  if (deviceIds.length === 0) {
    return null;
  }
  return { type, deviceIds, reason };
}

/**
 * Process names to kill for the current snapshots. Allowlisted focus is never
 * included. Desk-away always adds the all-blocklist sentinel so wiring can
 * terminate background games, not the study window.
 */
export function killTargetsFor(
  input: PolicyInput,
  desk: DeskPresence,
): string[] {
  const targets: string[] = [];
  const focus = input.focus;
  if (focus !== null && focus.matchedBlock) {
    const name = focus.processName.trim();
    if (name.length > 0) {
      targets.push(focus.processName);
    }
  }
  if (desk === "away") {
    targets.push(ALL_BLOCKLIST_TARGET);
  }
  return unique(targets);
}

function onTaskDetail(input: PolicyInput): string {
  const name = input.focus?.processName.trim();
  if (name) {
    return `On task: ${name}`;
  }
  return "On task";
}

function distractedDetail(input: PolicyInput): string {
  const name = input.focus?.processName.trim();
  if (name) {
    return `Distracted: ${name}`;
  }
  return "Distracted";
}

function idleDetail(focus: FocusKind, desk: DeskPresence): string {
  if (focus === "allow" && desk === "uncertain") {
    return "Allowlisted focus, uncertain desk — holding desk-only kill";
  }
  if (focus === "none") {
    return "Idle — no focused window";
  }
  if (focus === "other") {
    return "Idle — window not on allowlist or blocklist";
  }
  return "Idle";
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
