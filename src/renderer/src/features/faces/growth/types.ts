export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** One L-system segment. Generated once per sessionId; never from progress. */
export interface GrowthBranch {
  readonly id: number;
  readonly parentId: number | null;
  readonly start: Vec2;
  readonly control: Vec2;
  readonly end: Vec2;
  /** Signed perpendicular offset of the quadratic control from the chord. */
  readonly curve: number;
  readonly length: number;
  readonly width: number;
  readonly depth: number;
  readonly heading: number;
  /** Distance along the pre-order skeleton before this segment. */
  readonly startArc: number;
  readonly endArc: number;
  readonly leaf: GrowthLeaf | null;
  readonly blossomHost: boolean;
}

/** A leaf is two quadratic curves. Size is scaled by branch reveal at draw time. */
export interface GrowthLeaf {
  readonly angle: number;
  readonly size: number;
  readonly tone: 0 | 1;
}

export interface GrowthTree {
  readonly sessionId: string;
  readonly axiom: string;
  readonly expanded: string;
  readonly branches: readonly GrowthBranch[];
  readonly totalLength: number;
  readonly blossomBranchId: number;
  readonly maxDepth: number;
}

export interface GrowthFaceProps {
  sessionId: string;
  /** 0..1 fraction of total branch length to reveal. Does not rebuild geometry. */
  progress: number;
  /** Session-persistent stakes. Droop + desaturation. */
  killCount?: number;
  /** Alternate stakes input: length is the kill count. */
  killEvents?: ReadonlyArray<unknown>;
  width?: number;
  height?: number;
  className?: string;
}

export interface GrowthView {
  readonly sessionId: string;
  readonly progress: number;
  readonly killCount: number;
  readonly wilt: number;
  readonly blossomOpen: boolean;
}

export interface PosedBranch {
  readonly id: number;
  readonly parentId: number | null;
  readonly start: Vec2;
  readonly control: Vec2;
  readonly end: Vec2;
  readonly width: number;
  readonly depth: number;
  readonly heading: number;
  readonly length: number;
  /** 0..1 how much of this segment is drawn. */
  readonly reveal: number;
  readonly leaf: GrowthLeaf | null;
  readonly leafScale: number;
  readonly blossomHost: boolean;
}

export interface PosedGrowth {
  readonly tree: GrowthTree;
  readonly view: GrowthView;
  readonly branches: readonly PosedBranch[];
}

export interface GrowthPalette {
  readonly soil: string;
  readonly soilRim: string;
  readonly pot: string;
  readonly potRim: string;
  readonly potShadow: string;
  readonly bark: string;
  readonly barkEdge: string;
  readonly greenA: string;
  readonly greenB: string;
  readonly blossom: string;
  readonly blossomEdge: string;
  readonly blossomHeart: string;
}

export const GROWTH_FACE_ID = "growth" as const;
export const GROWTH_FACE_TITLE = "Growth";

export const GROWTH_VIEWBOX = {
  minX: -168,
  minY: -348,
  width: 336,
  height: 448,
} as const;
