import { isFaceId, type FaceId } from "@shared/faces";
import { clamp01 } from "./clock";

function readParam(search: string, hash: string, name: string): string | null {
  const query = new URLSearchParams(search);
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const hashParams = new URLSearchParams(hashQuery);
  return query.get(name) ?? hashParams.get(name);
}

export function parseFaceParam(search: string, hash: string): FaceId | null {
  const raw = readParam(search, hash, "face");
  return isFaceId(raw) ? raw : null;
}

export function parseProgressParam(search: string, hash: string): number | null {
  const raw = readParam(search, hash, "progress");
  if (raw === null) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return clamp01(parsed);
}

export function readFaceOverride(): FaceId | null {
  if (typeof window === "undefined") {
    return null;
  }
  return parseFaceParam(window.location.search, window.location.hash);
}

export function readProgressOverride(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  return parseProgressParam(window.location.search, window.location.hash);
}
