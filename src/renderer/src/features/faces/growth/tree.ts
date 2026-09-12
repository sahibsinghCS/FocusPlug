import { createSessionRng, lerp } from "./rng";
import type { GrowthBranch, GrowthLeaf, GrowthTree, Vec2 } from "./types";

const treeCache = new Map<string, GrowthTree>();

const ITERATIONS = 4;
const AXIOM = "X";
const TARGET_HEIGHT = 268;
const TARGET_HALF_WIDTH = 148;

/**
 * Generate the FULL bonsai once per sessionId.
 * Progress must never call this. Same seed → identical skeleton after a stall.
 */
export function generateGrowthTree(sessionId: string): GrowthTree {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  const cached = treeCache.get(sessionId);
  if (cached) {
    return cached;
  }
  const tree = buildTree(sessionId);
  Object.freeze(tree);
  treeCache.set(sessionId, tree);
  return tree;
}

export function peekGrowthTree(sessionId: string): GrowthTree | undefined {
  return treeCache.get(sessionId);
}

/** Test helper — does not exist for render. */
export function resetGrowthTreeCache(): void {
  treeCache.clear();
}

export function serializeGrowthTree(tree: GrowthTree): string {
  if (!tree || typeof tree.sessionId !== "string") {
    throw new Error("tree is required");
  }
  return JSON.stringify({
    sessionId: tree.sessionId,
    axiom: tree.axiom,
    expanded: tree.expanded,
    totalLength: round6(tree.totalLength),
    blossomBranchId: tree.blossomBranchId,
    maxDepth: tree.maxDepth,
    branches: tree.branches.map((branch) => ({
      id: branch.id,
      parentId: branch.parentId,
      start: roundVec(branch.start),
      control: roundVec(branch.control),
      end: roundVec(branch.end),
      curve: round6(branch.curve),
      length: round6(branch.length),
      width: round6(branch.width),
      depth: branch.depth,
      heading: round6(branch.heading),
      startArc: round6(branch.startArc),
      endArc: round6(branch.endArc),
      leaf: branch.leaf
        ? {
            angle: round6(branch.leaf.angle),
            size: round6(branch.leaf.size),
            tone: branch.leaf.tone,
          }
        : null,
      blossomHost: branch.blossomHost,
    })),
  });
}

function buildTree(sessionId: string): GrowthTree {
  const rng = createSessionRng(sessionId);
  const expanded = expandLSystem(rng);
  const drafted = normalizeSkeleton(turtle(expanded, rng));
  if (drafted.length === 0) {
    throw new Error("Growth L-system produced no branches");
  }

  const childCounts = new Map<number, number>();
  for (const branch of drafted) {
    if (branch.parentId !== null) {
      childCounts.set(branch.parentId, (childCounts.get(branch.parentId) ?? 0) + 1);
    }
  }

  let blossomId = drafted[drafted.length - 1]?.id ?? 0;
  let bestY = Number.POSITIVE_INFINITY;
  for (const branch of drafted) {
    const isTip = (childCounts.get(branch.id) ?? 0) === 0;
    if (isTip && branch.end.y < bestY) {
      bestY = branch.end.y;
      blossomId = branch.id;
    }
  }

  let maxDepth = 0;
  const branches: GrowthBranch[] = drafted.map((branch) => {
    maxDepth = Math.max(maxDepth, branch.depth);
    const isTip = (childCounts.get(branch.id) ?? 0) === 0;
    const leaf = isTip || branch.depth >= 2 ? makeLeaf(rng, branch.depth) : null;
    return {
      ...branch,
      leaf,
      blossomHost: branch.id === blossomId,
    };
  });

  const last = branches[branches.length - 1];
  if (!last) {
    throw new Error("Growth L-system produced no branches");
  }

  return {
    sessionId,
    axiom: AXIOM,
    expanded,
    branches,
    totalLength: last.endArc,
    blossomBranchId: blossomId,
    maxDepth,
  };
}

/**
 * Stochastic bonsai L-system.
 * X = apex. F = internodal wood. Same rng stream → identical word.
 */
function expandLSystem(rng: () => number): string {
  let word = AXIOM;
  for (let i = 0; i < ITERATIONS; i += 1) {
    let next = "";
    for (const token of word) {
      if (token === "X") {
        const roll = rng();
        if (roll < 0.4) {
          next += "F[+X][-X]X";
        } else if (roll < 0.66) {
          next += "F[+X]X";
        } else if (roll < 0.9) {
          next += "F[-X]X";
        } else {
          next += "F[+X][-X]";
        }
      } else {
        next += token;
      }
    }
    word = next;
  }
  return word;
}

interface DraftBranch {
  id: number;
  parentId: number | null;
  start: Vec2;
  control: Vec2;
  end: Vec2;
  curve: number;
  length: number;
  width: number;
  depth: number;
  heading: number;
  startArc: number;
  endArc: number;
}

function turtle(word: string, rng: () => number): DraftBranch[] {
  const branches: DraftBranch[] = [];
  const lean = lerp(-0.16, 0.16, rng());
  type Frame = {
    pos: Vec2;
    heading: number;
    width: number;
    depth: number;
    parentId: number | null;
  };
  const stack: Frame[] = [];
  let state: Frame = {
    pos: { x: 0, y: 0 },
    heading: -Math.PI / 2 + lean,
    width: lerp(10.5, 13.2, rng()),
    depth: 0,
    parentId: null,
  };
  let arc = 0;
  let id = 0;

  for (const token of word) {
    if (token === "F") {
      const length = lerp(16, 28, rng()) * Math.pow(0.72, state.depth);
      const heading = state.heading + lerp(-0.08, 0.08, rng());
      const end = {
        x: state.pos.x + Math.cos(heading) * length,
        y: state.pos.y + Math.sin(heading) * length,
      };
      const curve = (rng() - 0.5) * length * 0.32;
      const control = controlFromCurve(state.pos, end, heading, curve);
      const startArc = arc;
      arc += length;
      const branch: DraftBranch = {
        id,
        parentId: state.parentId,
        start: state.pos,
        control,
        end,
        curve,
        length,
        width: state.width,
        depth: state.depth,
        heading,
        startArc,
        endArc: arc,
      };
      branches.push(branch);
      state = {
        pos: end,
        heading,
        width: Math.max(1.35, state.width * 0.66),
        depth: state.depth + 1,
        parentId: id,
      };
      id += 1;
    } else if (token === "+") {
      state = { ...state, heading: state.heading + lerp(0.42, 0.98, rng()) };
    } else if (token === "-") {
      state = { ...state, heading: state.heading - lerp(0.42, 0.98, rng()) };
    } else if (token === "[") {
      stack.push({ ...state, pos: { ...state.pos } });
    } else if (token === "]") {
      const popped = stack.pop();
      if (popped) {
        state = popped;
      }
    }
  }

  return branches;
}

function controlFromCurve(start: Vec2, end: Vec2, heading: number, curve: number): Vec2 {
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const nx = -Math.sin(heading);
  const ny = Math.cos(heading);
  return { x: mid.x + nx * curve, y: mid.y + ny * curve };
}

function normalizeSkeleton(drafted: DraftBranch[]): DraftBranch[] {
  if (drafted.length === 0) {
    return drafted;
  }
  let minY = 0;
  let maxAbsX = 0;
  for (const branch of drafted) {
    minY = Math.min(minY, branch.start.y, branch.control.y, branch.end.y);
    maxAbsX = Math.max(maxAbsX, Math.abs(branch.start.x), Math.abs(branch.control.x), Math.abs(branch.end.x));
  }
  const treeHeight = Math.max(24, -minY);
  const scale = Math.min(TARGET_HEIGHT / treeHeight, TARGET_HALF_WIDTH / Math.max(36, maxAbsX));
  return drafted.map((branch) => ({
    ...branch,
    start: scaleVec(branch.start, scale),
    control: scaleVec(branch.control, scale),
    end: scaleVec(branch.end, scale),
    curve: branch.curve * scale,
    length: branch.length * scale,
    startArc: branch.startArc * scale,
    endArc: branch.endArc * scale,
  }));
}

function scaleVec(vec: Vec2, scale: number): Vec2 {
  return { x: vec.x * scale, y: vec.y * scale };
}

function makeLeaf(rng: () => number, depth: number): GrowthLeaf {
  return {
    angle: lerp(-0.55, 0.55, rng()),
    size: lerp(9.5, 14.5, rng()) * (depth >= 3 ? 1 : 0.86),
    tone: rng() < 0.5 ? 0 : 1,
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function roundVec(vec: Vec2): Vec2 {
  return { x: round6(vec.x), y: round6(vec.y) };
}
