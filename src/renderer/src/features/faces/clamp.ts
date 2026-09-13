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

/**
 * Expand a landscape design viewBox when the host is taller than the 380px strip
 * the faces were drawn for, so lock mode does not crop left/right with `slice`.
 */
export function tallStripViewBox(
  box: { width: number; height: number },
  designWidth: number,
  designHeight: number,
): { width: number; height: number } {
  const width = Number.isFinite(designWidth) && designWidth > 0 ? designWidth : 1280;
  const height = Number.isFinite(designHeight) && designHeight > 0 ? designHeight : 380;
  const boxW = Number.isFinite(box.width) && box.width > 0 ? box.width : width;
  const boxH = Number.isFinite(box.height) && box.height > 0 ? box.height : height;
  const boxAspect = boxW / boxH;
  const designAspect = width / height;
  // FaceHost is a ~380px strip and is slightly taller than the design aspect.
  // Only grow the viewBox for lock-sized hosts, not that strip.
  if (boxAspect >= designAspect * 0.9) {
    return { width, height };
  }
  return { width, height: width / boxAspect };
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
