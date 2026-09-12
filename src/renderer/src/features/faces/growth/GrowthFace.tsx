import { useMemo, type JSX } from "react";
import { cn } from "../../../lib/cn";
import "./growth.css";
import { poseGrowth, resolveKillCount, resolveProgress } from "./pose";
import { buildDrawModel, leafPath } from "./svg";
import { generateGrowthTree } from "./tree";
import { GROWTH_FACE_TITLE, GROWTH_VIEWBOX, type GrowthFaceProps } from "./types";

export function GrowthFace(props: GrowthFaceProps): JSX.Element {
  if (typeof props.sessionId !== "string" || props.sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  const progress = resolveProgress(props.progress);
  const killCount = resolveKillCount({
    killCount: props.killCount,
    killEvents: props.killEvents,
  });
  const width = props.width ?? 420;
  const height = props.height ?? 520;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("width and height must be positive finite numbers");
  }

  const tree = useMemo(() => generateGrowthTree(props.sessionId), [props.sessionId]);
  const posed = useMemo(() => poseGrowth(tree, progress, killCount), [tree, progress, killCount]);
  const model = useMemo(() => buildDrawModel(posed), [posed]);
  const { palette } = model;
  const wiltPct = Math.round(posed.view.wilt * 100);
  const grownPct = Math.round(posed.view.progress * 100);
  const view = zoomedGrowthViewBox(progress);
  const label = posed.view.killCount > 0
    ? `${GROWTH_FACE_TITLE} bonsai, ${grownPct}% grown, wilted after ${posed.view.killCount} kills`
    : `${GROWTH_FACE_TITLE} bonsai, ${grownPct}% grown`;

  return (
    <div
      className={cn("fp-growth", props.className)}
      data-face="growth"
      data-session={props.sessionId}
      data-progress={progress}
      data-kills={killCount}
      data-wilt={wiltPct}
      data-blossom={posed.view.blossomOpen ? "open" : "shut"}
    >
      <svg
        role="img"
        aria-label={label}
        width={width}
        height={height}
        viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`}
        preserveAspectRatio="xMidYMax meet"
      >
        <title>{label}</title>
        <ellipse cx="0" cy="40" rx="70" ry="12" fill={palette.potShadow} opacity="0.55" />
        <path d={model.pot.d} fill={palette.pot} />
        <path d={model.pot.rim} fill={palette.potRim} />
        <path d={model.soil.rim} fill={palette.soilRim} />
        <path d={model.soil.mound} fill={palette.soil} />

        {posed.branches.reduce((sum, branch) => sum + branch.reveal * branch.length, 0) <
        tree.totalLength * 0.18 ? (
          <g className="fp-growth-sapling" aria-hidden="true">
            <path
              d="M 0 2 Q 6 -36 2 -88"
              fill="none"
              stroke={palette.bark}
              strokeWidth="4.2"
              strokeLinecap="round"
            />
            <path d={leafPath({ x: 8, y: -52 }, -2.2, 28)} fill={palette.greenA} />
            <path d={leafPath({ x: -6, y: -70 }, -0.85, 24)} fill={palette.greenB} />
          </g>
        ) : null}

        {model.woods.map((wood) => (
          <path
            key={`bark-${wood.id}`}
            d={wood.d}
            fill="none"
            stroke={palette.barkEdge}
            strokeWidth={wood.width + 1.15}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {model.woods.map((wood) => (
          <path
            key={`wood-${wood.id}`}
            d={wood.d}
            fill="none"
            stroke={palette.bark}
            strokeWidth={wood.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {model.leaves.map((leaf) => (
          <path key={leaf.id} d={leaf.d} fill={leaf.fill} />
        ))}

        {model.blossom
          ? model.blossom.petals.map((petal, index) => (
              <path
                key={`petal-${index}`}
                d={petal.d}
                fill={petal.fill}
                stroke={palette.blossomEdge}
                strokeWidth="0.6"
              />
            ))
          : null}
        {model.blossom ? (
          <circle
            cx={model.blossom.heart.cx}
            cy={model.blossom.heart.cy}
            r={model.blossom.heart.r}
            fill={model.blossom.heart.fill}
          />
        ) : null}
      </svg>
    </div>
  );
}

/** Tight on the pot at plant-in; opens to the full canopy as the session grows. */
function zoomedGrowthViewBox(progress: number): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  const t = Math.min(1, Math.max(0, progress) / 0.42);
  const ease = t * t * (3 - 2 * t);
  return {
    minX: roundView(lerp(-118, GROWTH_VIEWBOX.minX, ease)),
    minY: roundView(lerp(-150, GROWTH_VIEWBOX.minY, ease)),
    width: roundView(lerp(236, GROWTH_VIEWBOX.width, ease)),
    height: roundView(lerp(236, GROWTH_VIEWBOX.height, ease)),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function roundView(value: number): number {
  return Math.round(value * 100) / 100;
}
