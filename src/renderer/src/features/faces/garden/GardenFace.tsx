import { useMemo, useRef, type JSX } from "react";
import { clampProgress, resolveFaceBox } from "../clamp";
import { useFaceCanvas } from "../useFaceCanvas";
import type { FacePhase } from "@shared/faces";
import { paintGarden } from "./draw";
import { gardenPhase, gardenPhaseLabel } from "./math";
import { buildGardenWorld } from "./world";
import "./garden.css";

export interface GardenVisualProps {
  progress: number;
  phase: FacePhase;
  sessionId: string;
  width: number;
  height: number;
  freeze?: boolean;
}

export function GardenVisual(props: GardenVisualProps): JSX.Element {
  if (typeof props.sessionId !== "string" || props.sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  const box = resolveFaceBox({ width: props.width, height: props.height });
  const progress = clampProgress(props.progress);
  const world = useMemo(() => buildGardenWorld(props.sessionId), [props.sessionId]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phase = gardenPhase(progress);
  const freeze = props.freeze === true;

  useFaceCanvas(
    canvasRef,
    (ctx, w, h, clockMs) => {
      paintGarden(ctx, world, w, h, progress, clockMs);
    },
    [world, progress],
    { freeze, paused: freeze },
  );

  return (
    <div
      className="fp-garden"
      role="img"
      aria-label={`Garden ${gardenPhaseLabel(phase)} ${Math.round(progress * 100)} percent. Sun elevation is session progress.`}
      data-face="garden"
      data-face-status="ready"
      data-phase={props.phase}
      data-sky={phase}
      style={{ width: box.width, height: box.height }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
