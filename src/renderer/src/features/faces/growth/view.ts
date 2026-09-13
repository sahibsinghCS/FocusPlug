import type { PosedGrowth } from "./types";

const POT_MIN_X = -78;
const POT_MAX_X = 78;
const POT_MIN_Y = -18;
const POT_MAX_Y = 72;
const SAPLING_TOP = -96;

/**
 * Wide, pot-anchored crop for catalog tiles. The lock-size viewBox is a tall
 * empty sky at ~35% grown — picker thumbs need the plant, not the void.
 */
export function thumbGrowthViewBox(posed: PosedGrowth): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  let minX = POT_MIN_X;
  let maxX = POT_MAX_X;
  let minY = POT_MIN_Y;
  let maxY = POT_MAX_Y;

  const revealed = posed.branches.reduce(
    (sum, branch) => sum + branch.reveal * branch.length,
    0,
  );
  if (revealed < posed.tree.totalLength * 0.18) {
    minY = Math.min(minY, SAPLING_TOP);
    minX = Math.min(minX, -24);
    maxX = Math.max(maxX, 24);
  }

  for (const branch of posed.branches) {
    if (branch.reveal <= 0.001) {
      continue;
    }
    for (const point of [branch.start, branch.control, branch.end]) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }

  minX -= 26;
  maxX += 26;
  minY -= 20;
  maxY += 16;
  minX = Math.min(minX, POT_MIN_X - 10);
  maxX = Math.max(maxX, POT_MAX_X + 10);
  maxY = Math.max(maxY, POT_MAX_Y);

  let width = maxX - minX;
  let height = maxY - minY;
  const targetAspect = 2;
  if (width / height < targetAspect) {
    const extra = targetAspect * height - width;
    minX -= extra / 2;
    width += extra;
  }

  return {
    minX: roundView(minX),
    minY: roundView(minY),
    width: roundView(width),
    height: roundView(height),
  };
}

function roundView(value: number): number {
  return Math.round(value * 100) / 100;
}
