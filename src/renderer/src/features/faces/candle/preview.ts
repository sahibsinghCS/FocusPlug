import { clamp01 } from "../clock";
import type { FacePhase } from "@shared/faces";
import { STILL_CLOCK_MS } from "./math";

export type CandleSceneId = "start" | "mid" | "end" | "stakes" | "idle";

export interface CandlePreview {
  scene: CandleSceneId;
  progress: number;
  phase: FacePhase;
  remainingMs: number;
  elapsedMs: number;
  sessionId: string;
  killCount: number;
  freeze: boolean;
  stillClockMs: number;
}

const SCENES: Record<CandleSceneId, Pick<CandlePreview, "progress" | "phase" | "killCount">> = {
  start: { progress: 0.04, phase: "focus", killCount: 0 },
  mid: { progress: 0.5, phase: "focus", killCount: 0 },
  end: { progress: 0.92, phase: "focus", killCount: 0 },
  stakes: { progress: 0.5, phase: "focus", killCount: 3 },
  idle: { progress: 0, phase: "idle", killCount: 0 },
};

function readParam(search: string, hash: string, name: string): string | null {
  const query = new URLSearchParams(search);
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const hashParams = new URLSearchParams(hashQuery);
  return query.get(name) ?? hashParams.get(name);
}

export function parseCandleScene(raw: string | null): CandleSceneId {
  if (raw === "start" || raw === "mid" || raw === "end" || raw === "stakes" || raw === "idle") {
    return raw;
  }
  return "mid";
}

export function parseCandlePreview(search: string, hash: string): CandlePreview {
  const scene = parseCandleScene(readParam(search, hash, "scene"));
  const preset = SCENES[scene];
  const progressRaw = readParam(search, hash, "progress");
  const parsed = progressRaw === null ? Number.NaN : Number(progressRaw);
  const progress = Number.isFinite(parsed) ? clamp01(parsed) : preset.progress;
  const killsRaw = readParam(search, hash, "kills");
  const killsParsed = killsRaw === null ? Number.NaN : Number(killsRaw);
  const killCount = Number.isFinite(killsParsed) ? Math.max(0, Math.floor(killsParsed)) : preset.killCount;
  const freeze =
    readParam(search, hash, "freeze") !== null || readParam(search, hash, "still") !== null;
  const estimateMs = 50 * 60_000;
  return {
    scene,
    progress,
    phase: preset.phase,
    remainingMs: Math.round((1 - progress) * estimateMs),
    elapsedMs: Math.round(progress * estimateMs),
    sessionId: "gauntlet-candle-01",
    killCount,
    freeze,
    stillClockMs: STILL_CLOCK_MS,
  };
}
