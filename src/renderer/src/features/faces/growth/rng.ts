/** FNV-1a 32-bit. Same sessionId → same seed in every JS engine. */
export function hashSessionId(sessionId: string): number {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  let hash = 2166136261;
  for (let i = 0; i < sessionId.length; i += 1) {
    hash ^= sessionId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32 — deterministic, no Date.now(). */
export function mulberry32(seed: number): () => number {
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    throw new Error("seed must be a finite number");
  }
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSessionRng(sessionId: string): () => number {
  return mulberry32(hashSessionId(sessionId));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("value must be a finite number");
  }
  return Math.min(1, Math.max(0, value));
}

export function shortestAngleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + shortestAngleDelta(from, to) * t;
}

export function mixHex(a: string, b: string, t: number): string {
  const left = parseHex(a);
  const right = parseHex(b);
  const u = clamp01(t);
  return rgbToHex(
    Math.round(lerp(left.r, right.r, u)),
    Math.round(lerp(left.g, right.g, u)),
    Math.round(lerp(left.b, right.b, u)),
  );
}

export function desaturateHex(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = clamp01(amount);
  return rgbToHex(
    Math.round(lerp(r, luma, t)),
    Math.round(lerp(g, luma, t)),
    Math.round(lerp(b, luma, t)),
  );
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (channel: number): string =>
    Math.min(255, Math.max(0, channel)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
