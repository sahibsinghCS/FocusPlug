import { wiltFromKills } from "./colors";
import { clamp01, lerpAngle } from "./rng";
import type {
  GrowthBranch,
  GrowthTree,
  GrowthView,
  PosedBranch,
  PosedGrowth,
  Vec2,
} from "./types";

export function resolveKillCount(input: {
  killCount?: number;
  killEvents?: ReadonlyArray<unknown>;
}): number {
  if (input.killCount !== undefined) {
    if (typeof input.killCount !== "number" || !Number.isFinite(input.killCount)) {
      throw new Error("killCount must be a finite number");
    }
    return Math.max(0, input.killCount);
  }
  if (input.killEvents !== undefined) {
    if (!Array.isArray(input.killEvents)) {
      throw new Error("killEvents must be an array");
    }
    return input.killEvents.length;
  }
  return 0;
}

export function resolveProgress(progress: number): number {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    throw new Error("progress must be a finite number");
  }
  return clamp01(progress);
}

export function killCountFromEvents(events: ReadonlyArray<{ kind: string }>): number {
  if (!Array.isArray(events)) {
    throw new Error("events must be an array");
  }
  return events.filter((event) => {
    if (!event || typeof event.kind !== "string") {
      return false;
    }
    const kind = event.kind.toLowerCase();
    return kind === "kill" || kind === "killed" || kind === "demo_kill";
  }).length;
}

/**
 * Pose the frozen skeleton. Progress reveals arc length.
 * Wilt droops headings toward gravity — same topology, sad stakes.
 */
export function poseGrowth(
  tree: GrowthTree,
  progress: number,
  killCount: number,
): PosedGrowth {
  if (!tree || !Array.isArray(tree.branches)) {
    throw new Error("tree is required");
  }
  const view = makeView(tree.sessionId, progress, killCount);
  const revealedArc = view.progress * tree.totalLength;
  const posedById = new Map<number, PosedBranch>();
  const posed: PosedBranch[] = [];

  for (const branch of tree.branches) {
    const parent = branch.parentId === null ? null : posedById.get(branch.parentId);
    const start = parent ? parent.end : branch.start;
    const heading = droopHeading(branch, view.wilt, tree.maxDepth);
    const end = project(start, heading, branch.length);
    const control = controlFromCurve(start, end, heading, branch.curve);
    const reveal = segmentReveal(branch, revealedArc);
    const posedBranch: PosedBranch = {
      id: branch.id,
      parentId: branch.parentId,
      start,
      control,
      end,
      width: branch.width,
      depth: branch.depth,
      heading,
      length: branch.length,
      reveal,
      leaf: branch.leaf,
      leafScale: reveal,
      blossomHost: branch.blossomHost,
    };
    posedById.set(branch.id, posedBranch);
    posed.push(posedBranch);
  }

  return { tree, view, branches: posed };
}

export function makeView(sessionId: string, progress: number, killCount: number): GrowthView {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  const nextProgress = resolveProgress(progress);
  const nextKills = resolveKillCount({ killCount });
  return {
    sessionId,
    progress: nextProgress,
    killCount: nextKills,
    wilt: wiltFromKills(nextKills),
    blossomOpen: nextProgress >= 1,
  };
}

function droopHeading(branch: GrowthBranch, wilt: number, maxDepth: number): number {
  if (wilt <= 0) {
    return branch.heading;
  }
  const depthT = maxDepth === 0 ? 1 : branch.depth / maxDepth;
  // Hang toward gravity on the side the branch already faces.
  // Do not lerp through 180° — that detaches the trunk and reads as a bug.
  const side = Math.cos(branch.heading) >= 0 ? 1 : -1;
  const trunkGuard = branch.depth <= 0 ? 0.14 : 0.38 + 0.7 * depthT;
  return branch.heading + side * wilt * trunkGuard;
}

function project(start: Vec2, heading: number, length: number): Vec2 {
  return {
    x: start.x + Math.cos(heading) * length,
    y: start.y + Math.sin(heading) * length,
  };
}

function controlFromCurve(start: Vec2, end: Vec2, heading: number, curve: number): Vec2 {
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const nx = -Math.sin(heading);
  const ny = Math.cos(heading);
  return { x: mid.x + nx * curve, y: mid.y + ny * curve };
}

function segmentReveal(branch: GrowthBranch, revealedArc: number): number {
  if (revealedArc <= branch.startArc) {
    return 0;
  }
  if (revealedArc >= branch.endArc) {
    return 1;
  }
  if (branch.length <= 0) {
    return 0;
  }
  return clamp01((revealedArc - branch.startArc) / branch.length);
}

/** Subdivide a quadratic so we can stroke only the revealed prefix. */
export function quadUntil(p0: Vec2, p1: Vec2, p2: Vec2, t: number): [Vec2, Vec2, Vec2] {
  const u = clamp01(t);
  const a = lerpVec(p0, p1, u);
  const b = lerpVec(p1, p2, u);
  const c = lerpVec(a, b, u);
  return [p0, a, c];
}

function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function leafHang(heading: number, leafAngle: number, wilt: number): number {
  const base = heading + leafAngle;
  if (wilt <= 0) {
    return base;
  }
  const side = Math.cos(base) >= 0 ? 1 : -1;
  return lerpAngle(base, side * (Math.PI / 2), 0.88 * wilt);
}
