export interface DescentSpeck {
  x: number;
  y: number;
  r: number;
  seed: number;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLayer(count: number, seed: number, radius: { min: number; max: number }): DescentSpeck[] {
  const rand = mulberry32(seed);
  const specks: DescentSpeck[] = [];
  for (let i = 0; i < count; i += 1) {
    specks.push({
      x: rand(),
      y: rand(),
      r: radius.min + rand() * (radius.max - radius.min),
      seed: rand() * Math.PI * 2,
    });
  }
  return specks;
}

/** Fixed arrays — no physics. Alpha is a phase sine of `now`. Radii are viewBox units (960×640). */
export const FAR_SILT = makeLayer(110, 0x51c7, { min: 1.1, max: 2.2 });
export const MID_MOTES = makeLayer(56, 0xa31e, { min: 1.8, max: 3.4 });
export const NEAR_BIO = makeLayer(28, 0x0e4d, { min: 2.4, max: 4.6 });
