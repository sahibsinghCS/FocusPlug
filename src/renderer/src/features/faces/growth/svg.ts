import { growthPalette } from "./colors";
import { leafHang, quadUntil } from "./pose";
import type { GrowthPalette, PosedBranch, PosedGrowth, Vec2 } from "./types";

export function branchPath(branch: PosedBranch): string | null {
  if (branch.reveal <= 0.001) {
    return null;
  }
  const [p0, p1, p2] = quadUntil(branch.start, branch.control, branch.end, branch.reveal);
  return `M ${fmt(p0.x)} ${fmt(p0.y)} Q ${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
}

/** Leaf = two quadratic curves, scaled by the parent branch reveal. */
export function leafPath(origin: Vec2, angle: number, size: number): string {
  const tip = {
    x: origin.x + Math.cos(angle) * size,
    y: origin.y + Math.sin(angle) * size,
  };
  const mid = {
    x: origin.x + Math.cos(angle) * size * 0.48,
    y: origin.y + Math.sin(angle) * size * 0.48,
  };
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const width = size * 0.38;
  const left = { x: mid.x + nx * width, y: mid.y + ny * width };
  const right = { x: mid.x - nx * width, y: mid.y - ny * width };
  return [
    `M ${fmt(origin.x)} ${fmt(origin.y)}`,
    `Q ${fmt(left.x)} ${fmt(left.y)} ${fmt(tip.x)} ${fmt(tip.y)}`,
    `Q ${fmt(right.x)} ${fmt(right.y)} ${fmt(origin.x)} ${fmt(origin.y)}`,
    "Z",
  ].join(" ");
}

export function blossomPetalPath(origin: Vec2, angle: number, size: number): string {
  return leafPath(origin, angle, size);
}

export interface GrowthDrawModel {
  readonly palette: GrowthPalette;
  readonly pot: { d: string; rim: string; shadow: string };
  readonly soil: { mound: string; rim: string };
  readonly woods: ReadonlyArray<{ id: number; d: string; width: number }>;
  readonly leaves: ReadonlyArray<{
    id: string;
    d: string;
    fill: string;
  }>;
  readonly blossom: {
    open: boolean;
    petals: ReadonlyArray<{ d: string; fill: string }>;
    heart: { cx: number; cy: number; r: number; fill: string };
  } | null;
}

export function buildDrawModel(posed: PosedGrowth): GrowthDrawModel {
  const palette = growthPalette(posed.view.wilt);
  const woods: Array<{ id: number; d: string; width: number }> = [];
  const leaves: Array<{ id: string; d: string; fill: string }> = [];

  for (const branch of posed.branches) {
    const d = branchPath(branch);
    if (d) {
      woods.push({ id: branch.id, d, width: Math.max(1.1, branch.width * (0.55 + 0.45 * branch.reveal)) });
    }
    if (branch.leaf && branch.leafScale > 0.02) {
      const hang = leafHang(branch.heading, branch.leaf.angle, posed.view.wilt);
      const size = branch.leaf.size * branch.leafScale * (1 - posed.view.wilt * 0.12);
      const origin = pointAlong(branch, Math.min(1, 0.92 + 0.08 * branch.reveal));
      leaves.push({
        id: `leaf-${branch.id}`,
        d: leafPath(origin, hang, size),
        fill: branch.leaf.tone === 0 ? palette.greenA : palette.greenB,
      });
    }
  }

  const host = posed.branches.find((branch) => branch.blossomHost) ?? null;
  let blossom: GrowthDrawModel["blossom"] = null;
  if (host && posed.view.blossomOpen && host.reveal > 0.98) {
    const center = host.end;
    const open = 1 - posed.view.wilt * 0.28;
    const petals = [0, 1, 2, 3, 4].map((i) => {
      const spread = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      const angle = posed.view.wilt > 0 ? leafHang(spread, 0, posed.view.wilt * 0.85) : spread;
      return {
        d: blossomPetalPath(center, angle, 11 * open),
        fill: palette.blossom,
      };
    });
    blossom = {
      open: true,
      petals,
      heart: { cx: center.x, cy: center.y, r: 3.1, fill: palette.blossomHeart },
    };
  }

  return {
    palette,
    pot: potPaths(),
    soil: soilPaths(),
    woods,
    leaves,
    blossom,
  };
}

function pointAlong(branch: PosedBranch, t: number): Vec2 {
  const posed = quadUntil(branch.start, branch.control, branch.end, t);
  return posed[2];
}

function potPaths(): GrowthDrawModel["pot"] {
  return {
    shadow: "M -62 38 Q 0 52 62 38 Q 0 58 -62 38 Z",
    d: "M -48 6 L -38 46 Q 0 56 38 46 L 48 6 Z",
    rim: "M -54 4 Q 0 -2 54 4 Q 0 14 -54 4 Z",
  };
}

function soilPaths(): GrowthDrawModel["soil"] {
  return {
    mound: "M -44 6 Q 0 -16 44 6 Q 0 16 -44 6 Z",
    rim: "M -40 8 Q 0 18 40 8 Q 0 2 -40 8 Z",
  };
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}
