import type { VisualPhase } from "./visual";

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(1, Math.max(0, progress));
}

export function clampKillCount(killCount: number): number {
  if (!Number.isFinite(killCount)) {
    return 0;
  }
  return Math.max(0, Math.floor(killCount));
}

export function resolveFaceBox(size: number | { width: number; height: number }): {
  width: number;
  height: number;
} {
  if (typeof size === "number") {
    const edge = Number.isFinite(size) && size > 0 ? size : 320;
    return { width: edge, height: edge };
  }
  const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 320;
  const height = Number.isFinite(size.height) && size.height > 0 ? size.height : 320;
  return { width, height };
}

export function phaseSine(now: number, seed: number, periodMs: number): number {
  const safeNow = Number.isFinite(now) ? now : 0;
  const safePeriod = periodMs > 0 ? periodMs : 1000;
  return Math.sin((safeNow / safePeriod) * Math.PI * 2 + seed);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function phaseAccent(phase: VisualPhase): "calm" | "hot" | "done" {
  if (phase === "fuse" || phase === "kill") return "hot";
  if (phase === "complete") return "done";
  return "calm";
}
