import { useMemo, type JSX } from "react";
import { cn } from "../../../lib/cn";
import "./growth.css";
import { poseGrowth, resolveKillCount, resolveProgress } from "./pose";
import { buildDrawModel } from "./svg";
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
        viewBox={`${GROWTH_VIEWBOX.minX} ${GROWTH_VIEWBOX.minY} ${GROWTH_VIEWBOX.width} ${GROWTH_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMax meet"
      >
        <title>{label}</title>
        <ellipse cx="0" cy="40" rx="70" ry="12" fill={palette.potShadow} opacity="0.55" />
        <path d={model.pot.d} fill={palette.pot} />

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

        <path d={model.pot.rim} fill={palette.potRim} />
        <path d={model.soil.rim} fill={palette.soilRim} />
        <path d={model.soil.mound} fill={palette.soil} />

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
