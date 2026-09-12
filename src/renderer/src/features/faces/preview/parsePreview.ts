import { clampProgress } from "../clamp";
import { isFaceId, isFacePhase, type FaceId, type FacePhase } from "../types";

export type PreviewKind = FaceId | "bar";

export interface PreviewQuery {
  kind: PreviewKind;
  progress: number;
  phase: FacePhase;
  vs: boolean;
  now: number;
  killCount: number;
}

const DEFAULT_NOW = 1_700_000_420_000;

export function parsePreview(hash: string): PreviewQuery {
  const raw = hash.replace(/^#/, "");
  const [pathPart, queryPart] = raw.split("?");
  const path = (pathPart ?? "").replace(/^\//, "");
  const params = new URLSearchParams(queryPart ?? "");

  const vs = path.startsWith("vs/") || params.get("vs") === "1";
  const token = vs ? path.replace(/^vs\//, "") : path;
  const kind: PreviewKind = token === "bar" || isFaceId(token) ? token : "descent";

  const progress = clampProgress(Number(params.get("p") ?? params.get("progress") ?? 0.62));
  const phaseRaw = params.get("phase") ?? "focus";
  const phase: FacePhase = isFacePhase(phaseRaw) ? phaseRaw : "focus";
  const nowRaw = Number(params.get("now") ?? DEFAULT_NOW);
  const now = Number.isFinite(nowRaw) ? nowRaw : DEFAULT_NOW;
  const killRaw = Number(params.get("kills") ?? 0);
  const killCount = Number.isFinite(killRaw) ? Math.max(0, Math.floor(killRaw)) : 0;

  return { kind, progress, phase, vs, now, killCount };
}
