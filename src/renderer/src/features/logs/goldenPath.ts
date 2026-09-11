import type { SessionEvent } from "@shared/ipc";
import { isSessionEventShape, normalizeKind } from "./eventModel";

export interface GoldenStep {
  id: string;
  beat: string;
  label: string;
  cue: string;
}

export const GOLDEN_PATH_DURATION = "90 seconds";

export const GOLDEN_PATH_STEPS: readonly GoldenStep[] = [
  {
    id: "start",
    beat: "0:00",
    label: "Start session",
    cue: "Session home. Window on Allowlist (Chrome / Google Docs). Desk AI At desk. Decision On task.",
  },
  {
    id: "distracted",
    beat: "0:20",
    label: "Distracted",
    cue: "Alt-tab to Discord on the Blocklist. Decision Distracted. Desk AI still At desk.",
  },
  {
    id: "countdown",
    beat: "0:20",
    label: "Countdown",
    cue: "Opaque overlay: Killing blocked apps in 10s. Return to Docs cancels the fuse.",
  },
  {
    id: "kill",
    beat: "0:30",
    label: "Kill",
    cue: "Discord force-quit (kind kill). Armed plugs Plug off. Never the study PC.",
  },
  {
    id: "unlock",
    beat: "0:50",
    label: "Unlock",
    cue: "Back on Docs, Desk AI At desk. Decision On task. kind unlock. Plug on if outlets were cut.",
  },
  {
    id: "demo",
    beat: "1:10",
    label: "Demo Kill",
    cue: "Filming control: same force-quit, skip the wait. Home footer or overlay Demo Kill.",
  },
];

export const CAUSAL_CHAIN_LEGEND: ReadonlyArray<{
  stage: "sensor" | "decision" | "countdown" | "consequence" | "recovery";
  label: string;
  hint: string;
}> = [
  { stage: "sensor", label: "Sensor", hint: "Window · Desk AI" },
  { stage: "decision", label: "Decision", hint: "On task · Distracted · Away" },
  { stage: "countdown", label: "Countdown", hint: "Killing blocked apps in 10s" },
  { stage: "consequence", label: "Kill / Plug off", hint: "Force-quit · never the study PC" },
  { stage: "recovery", label: "Unlock / Plug on", hint: "Docs + At desk" },
];

export const PRODUCT_LABELS = [
  "Start session",
  "On task",
  "Distracted",
  "Away",
  "Idle",
  "At desk",
  "Uncertain",
  "Allowlist",
  "Blocklist",
  "Countdown",
  "Kill",
  "Unlock",
  "Demo Kill",
  "Plug off",
  "Plug on",
  "Strict mode",
] as const;

export function goldenStepSeen(stepId: string, events: readonly unknown[]): boolean {
  const log = events.filter(isSessionEventShape);
  switch (stepId) {
    case "start":
      return log.some(
        (event) =>
          normalizeKind(event.kind) === "session" && event.detail.toLowerCase().includes("started"),
      );
    case "distracted":
      return log.some(
        (event) =>
          normalizeKind(event.kind) === "decision" && event.detail.toUpperCase().includes("DISTRACTED"),
      );
    case "countdown":
      return log.some((event) => {
        const kind = normalizeKind(event.kind);
        return (
          (kind === "countdown" || kind === "policy") &&
          event.detail.toLowerCase().includes("start_countdown")
        );
      });
    case "kill":
      return log.some((event) => {
        const kind = normalizeKind(event.kind);
        return kind === "kill" || kind === "demo";
      });
    case "unlock":
      return log.some((event) => normalizeKind(event.kind) === "unlock");
    case "demo":
      return log.some((event) => {
        const kind = normalizeKind(event.kind);
        return kind === "demo" || (kind === "kill" && /demo/i.test(event.detail));
      });
    default:
      return false;
  }
}

export function goldenPathProgress(events: readonly unknown[]): {
  seen: number;
  total: number;
  steps: Array<GoldenStep & { seen: boolean }>;
} {
  const steps = GOLDEN_PATH_STEPS.map((step) => ({
    ...step,
    seen: goldenStepSeen(step.id, events),
  }));
  return {
    seen: steps.filter((step) => step.seen).length,
    total: steps.length,
    steps,
  };
}

export function asSessionEvents(events: readonly unknown[]): SessionEvent[] {
  return events.filter(isSessionEventShape);
}
