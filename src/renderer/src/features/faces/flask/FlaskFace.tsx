import { useRef, type JSX } from "react";
import type { FacePhase } from "@shared/faces";
import { useFaceCanvas } from "../useFaceCanvas";
import { drawFlaskFace } from "./draw";
import "./flask.css";

export interface FlaskVesselProps {
  progress: number;
  phase: FacePhase;
  remainingMs: number;
  elapsedMs: number;
  sessionId: string;
  width: number;
  height: number;
  freeze?: boolean;
  paused?: boolean;
}

export function FlaskVessel(props: FlaskVesselProps): JSX.Element {
  if (typeof props.sessionId !== "string" || props.sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  if (!Number.isFinite(props.progress)) {
    throw new Error("progress must be a finite number");
  }
  if (!Number.isFinite(props.remainingMs) || !Number.isFinite(props.elapsedMs)) {
    throw new Error("remainingMs and elapsedMs must be finite numbers");
  }
  const width = Math.max(1, Math.round(props.width));
  const height = Math.max(1, Math.round(props.height));
  if (width <= 0 || height <= 0) {
    throw new Error("width and height must be positive");
  }

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const freeze = props.freeze === true || props.paused === true;
  const fill = Math.max(0, Math.min(1, 1 - props.progress));

  useFaceCanvas(
    canvasRef,
    (ctx, w, h, clockMs) => {
      drawFlaskFace(ctx, w, h, {
        progress: props.progress,
        phase: props.phase,
        remainingMs: props.remainingMs,
        clockMs,
        freeze,
      });
    },
    [props.progress, props.phase, props.remainingMs, props.sessionId, freeze],
    { freeze, paused: freeze },
  );

  const label = `Flask ${Math.round(fill * 100)} percent remaining, ${props.phase}${
    props.phase === "idle" ? ", sealed" : ", leaking"
  }`;

  return (
    <div
      className="fp-flask"
      data-face="flask"
      data-face-status="ready"
      data-phase={props.phase}
      data-fill={fill.toFixed(3)}
      data-leak={props.phase === "idle" || fill <= 0.035 ? "0" : "1"}
    >
      <canvas ref={canvasRef} role="img" aria-label={label} />
    </div>
  );
}
