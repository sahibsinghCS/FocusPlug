import type { FaceProps, FaceSettings } from "../types";
import type { FaceVariant } from "./draw";

export interface FlightPreviewQuery {
  props: FaceProps;
  variant: FaceVariant;
  idleOverride?: number;
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

export function parseFlightPreview(search: string): FlightPreviewQuery {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const estimateMinutes = readNumber(q.get("estimateMinutes")) ?? 90;
  const progress = readNumber(q.get("progress"));
  const remainingFromProgress =
    progress === undefined ? undefined : Math.max(0, estimateMinutes * 60 * (1 - progress));
  const remaining = readNumber(q.get("remaining")) ?? remainingFromProgress ?? 45 * 60;
  const now = readTime(q.get("now") ?? q.get("utc"));
  const complete = q.get("complete") === "1" || remaining <= 0;
  const settings: FaceSettings = {
    dep: q.get("dep") ?? "JFK",
    arr: q.get("arr") ?? "LHR",
    depName: q.get("depName") ?? undefined,
    arrName: q.get("arrName") ?? undefined,
    depLat: readNumber(q.get("depLat")),
    depLon: readNumber(q.get("depLon")),
    arrLat: readNumber(q.get("arrLat")),
    arrLon: readNumber(q.get("arrLon")),
  };
  const variant: FaceVariant = q.get("variant") === "sticker" ? "sticker" : "instrument";
  return {
    variant,
    idleOverride: readNumber(q.get("idle")),
    props: {
      remaining: complete ? 0 : remaining,
      estimateMinutes,
      now,
      paused: q.get("freeze") !== null || q.get("paused") === "1",
      complete,
      reducedMotion: q.get("reducedMotion") === "1",
      settings,
    },
  };
}
