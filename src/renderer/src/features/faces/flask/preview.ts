import { clamp01 } from "../clock";
import type { FacePhase } from "@shared/faces";
import { STILL_CLOCK_MS } from "./math";

export type FlaskSceneId = "leak" | "full" | "low" | "idle";

export interface FlaskPreview {
  scene: FlaskSceneId;
  progress: number;
  phase: FacePhase;
  remainingMs: number;
  elapsedMs: number;
  sessionId: string;
  freeze: boolean;
  stillClockMs: number;
}

const SCENES: Record<FlaskSceneId, Pick<FlaskPreview, "progress" | "phase">> = {
  leak: { progress: 0.62, phase: "focus" },
  full: { progress: 0, phase: "idle" },
  low: { progress: 0.88, phase: "focus" },
  idle: { progress: 0, phase: "idle" },
};

function readParam(search: string, hash: string, name: string): string | null {
  const query = new URLSearchParams(search);
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const hashParams = new URLSearchParams(hashQuery);
  return query.get(name) ?? hashParams.get(name);
}

export function parseFlaskScene(raw: string | null): FlaskSceneId {
  if (raw === "full" || raw === "low" || raw === "idle" || raw === "leak") {
    return raw;
  }
  return "leak";
}

export function parseFlaskPreview(search: string, hash: string): FlaskPreview {
  const scene = parseFlaskScene(readParam(search, hash, "scene"));
  const preset = SCENES[scene];
  const progressRaw = readParam(search, hash, "progress");
  const parsed = progressRaw === null ? Number.NaN : Number(progressRaw);
  const progress = Number.isFinite(parsed) ? clamp01(parsed) : preset.progress;
  const freeze =
    readParam(search, hash, "freeze") !== null || readParam(search, hash, "still") !== null;
  const estimateMs = 50 * 60_000;
  return {
    scene,
    progress,
    phase: preset.phase,
    remainingMs: Math.round((1 - progress) * estimateMs),
    elapsedMs: Math.round(progress * estimateMs),
    sessionId: "gauntlet-flask-01",
    freeze,
    stillClockMs: STILL_CLOCK_MS,
  };
}
