import type { FacePhase } from "@shared/faces";
import type { FaceProps } from "../types";
import type { FaceSettings } from "./airports";
import type { FaceVariant } from "./draw";

export interface FlightPreviewQuery {
  face: FaceProps;
  variant: FaceVariant;
  idleOverride?: number;
  reducedMotion: boolean;
  settings: FaceSettings;
  freeze: boolean;
  estimateMinutes?: number;
  picker: "dep" | "arr" | null;
}

function readNumber(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function readTime(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : ms;
}

function mergeParams(search: string, hash: string): URLSearchParams {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (hash.includes("?")) {
    const hashParams = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
    hashParams.forEach((value, key) => {
      if (!q.has(key)) q.set(key, value);
    });
  }
  return q;
}

export function parseFlightPreview(search: string, hash = ""): FlightPreviewQuery {
  const q = mergeParams(search, hash);
  const estimateMinutes = readNumber(q.get("estimateMinutes")) ?? 90;
  const progress = readNumber(q.get("progress"));
  const remainingFromProgress =
    progress === undefined ? undefined : Math.max(0, estimateMinutes * 60 * (1 - progress));
  const remainingSec = readNumber(q.get("remaining")) ?? remainingFromProgress ?? 45 * 60;
  const nowMs = readTime(q.get("now") ?? q.get("utc"));
  const complete = q.get("complete") === "1" || remainingSec <= 0;
  const phaseRaw = q.get("phase");
  const phase: FacePhase =
    phaseRaw === "idle" || phaseRaw === "break" || phaseRaw === "focus" ? phaseRaw : "focus";
  const elapsedMs = complete
    ? estimateMinutes * 60_000
    : Math.max(0, estimateMinutes * 60_000 - remainingSec * 1000);
  const pickerRaw = q.get("picker");
  const picker: "dep" | "arr" | null =
    pickerRaw === "arr" || pickerRaw === "dep" ? pickerRaw : pickerRaw === "1" ? "dep" : null;
  const settings: FaceSettings = {
    dep: q.get("dep") ?? undefined,
    arr: q.get("arr") ?? undefined,
    depName: q.get("depName") ?? undefined,
    arrName: q.get("arrName") ?? undefined,
    depLat: readNumber(q.get("depLat")),
    depLon: readNumber(q.get("depLon")),
    arrLat: readNumber(q.get("arrLat")),
    arrLon: readNumber(q.get("arrLon")),
  };
  const variant: FaceVariant = q.get("variant") === "sticker" ? "sticker" : "instrument";
  const freeze = q.get("freeze") !== null || q.get("paused") === "1";
  return {
    variant,
    idleOverride: readNumber(q.get("idle")),
    reducedMotion: q.get("reducedMotion") === "1",
    settings,
    freeze,
    picker,
    estimateMinutes: q.get("estimateMinutes") ? estimateMinutes : undefined,
    face: {
      progress: complete ? 1 : Math.min(1, Math.max(0, elapsedMs / (estimateMinutes * 60_000))),
      phase: complete ? "focus" : phase,
      elapsedMs,
      remainingMs: complete ? 0 : remainingSec * 1000,
      estimateMinutes,
      sessionId: "flight-stills",
      events: [],
      killCount: 0,
      now: new Date(nowMs ?? Date.parse("2026-09-12T16:00:00.000Z")),
      width: readNumber(q.get("width")) ?? 1280,
      height: readNumber(q.get("height")) ?? 800,
    },
  };
}
