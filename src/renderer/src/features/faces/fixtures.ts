import type { SessionEvent } from "@shared/ipc";
import { goldenSessionEvents } from "../logs/fixtures";
import { deriveFaceProps } from "./derive";
import type { FaceId, FaceProps, FaceRound } from "./instrument";

export type FaceSceneId =
  | "live"
  | "rounds"
  | "plain"
  | "thirds"
  | "artifact"
  | "idle"
  | "break"
  | "bar";

export const DEMO_ROUNDS: readonly FaceRound[] = [
  { id: "r1", label: "Round 1", start: 0, end: 0.28, kind: "focus" },
  { id: "b1", label: "Break", start: 0.28, end: 0.4, kind: "break" },
  { id: "r2", label: "Round 2", start: 0.4, end: 0.7, kind: "focus" },
  { id: "b2", label: "Break", start: 0.7, end: 0.82, kind: "break" },
  { id: "r3", label: "Round 3", start: 0.82, end: 1, kind: "focus" },
];

const DURATION = 50 * 60 * 1000;
const ARTIFACT_NOW = 1_700_000_000_000;

function logForProgress(progress: number, now: number): SessionEvent[] {
  const started = now - progress * DURATION;
  const gold = goldenSessionEvents(now);
  const shifted = gold.map((event) => ({
    ...event,
    ts: started + Math.max(0, now - event.ts),
  }));
  return [
    { ts: started, kind: "session", detail: "Session started" },
    ...shifted.filter((event) => event.kind !== "session"),
    { ts: started + 0.18 * DURATION, kind: "desk", detail: "away · 91%" },
    { ts: started + 0.19 * DURATION, kind: "decision", detail: "AWAY · Chair empty" },
    { ts: started + 0.33 * DURATION, kind: "countdown", detail: "start_countdown · blocked_focus · 10s" },
    { ts: started + 0.335 * DURATION, kind: "decision", detail: "DISTRACTED · Distracted: discord.exe" },
    { ts: started + 0.36 * DURATION, kind: "kill", detail: "blocked_focus · killed discord.exe" },
    { ts: started + 0.361 * DURATION, kind: "plug_off", detail: "off · console-lamp" },
    { ts: started + 0.42 * DURATION, kind: "unlock", detail: "Unlocked — back on task" },
    { ts: started + 0.421 * DURATION, kind: "plug_on", detail: "on · console-lamp" },
    { ts: started + 0.58 * DURATION, kind: "focus", detail: "Discord — #general" },
    { ts: started + 0.59 * DURATION, kind: "decision", detail: "DISTRACTED · Distracted: Discord" },
  ];
}

function propsAt(input: {
  progress: number;
  scene: FaceSceneId;
  freeze?: boolean;
}): FaceProps {
  const now = ARTIFACT_NOW;
  const elapsedMs = input.progress * DURATION;
  const sessionActive = input.scene !== "idle" && input.scene !== "artifact";
  const inBreak = input.scene === "break" || (input.scene === "rounds" && input.progress >= 0.28 && input.progress < 0.4);
  const countdownSec = input.scene === "live" && input.progress > 0.32 && input.progress < 0.36 ? 8 : 0;
  const rounds =
    input.scene === "rounds" || input.scene === "break" || input.scene === "artifact"
      ? DEMO_ROUNDS
      : undefined;
  const lineMode = input.scene === "plain" ? "plain" : input.scene === "thirds" ? "thirds" : "auto";

  return deriveFaceProps({
    sessionActive,
    decision: inBreak ? "ON_TASK" : countdownSec > 0 ? "DISTRACTED" : "ON_TASK",
    countdownSec,
    log: input.scene === "idle" ? [] : logForProgress(Math.max(input.progress, 0.05), now),
    nowMs: now,
    elapsedMs,
    durationMs: DURATION,
    sessionId: "fp-rec-1847",
    rounds,
    freeze: input.freeze ?? true,
    paused: input.scene === "idle",
    lineMode,
  });
}

export function faceFixture(face: FaceId | "bar", scene: FaceSceneId): FaceProps {
  if (face === "movement") {
    // Beat fraction 0.34 → escapement is in the overshoot, not a linear step.
    // Mid-session so the mainspring reads as a ribbon, not a speaker coil.
    const beats = 4 * (0.45 * DURATION) / 1000 + 0.34;
    const elapsedSec = beats / 4;
    const progress = (elapsedSec * 1000) / DURATION;
    return propsAt({ progress, scene: scene === "idle" ? "idle" : "live" });
  }
  if (face === "line") {
    if (scene === "plain" || scene === "idle") {
      return propsAt({ progress: scene === "idle" ? 0 : 0.42, scene: scene === "idle" ? "idle" : "plain" });
    }
    if (scene === "thirds") {
      return propsAt({ progress: 0.52, scene: "thirds" });
    }
    if (scene === "break") {
      return propsAt({ progress: 0.34, scene: "break" });
    }
    return propsAt({ progress: 0.34, scene: "rounds" });
  }
  if (scene === "idle") {
    return propsAt({ progress: 0, scene: "idle" });
  }
  if (scene === "live") {
    return propsAt({ progress: 0.62, scene: "live" });
  }
  return propsAt({ progress: 1, scene: "artifact" });
}

export function defaultSceneFor(face: FaceId | "bar"): FaceSceneId {
  if (face === "line") {
    return "rounds";
  }
  if (face === "movement") {
    return "live";
  }
  return "artifact";
}
