import { useRef, type JSX } from "react";
import type { FacePhase } from "@shared/faces";
import { useFaceCanvas } from "../useFaceCanvas";
import { waxRemain } from "./math";
import { drawCandleFace } from "./draw";
import "./candle.css";

export interface CandleVesselProps {
  progress: number;
  phase: FacePhase;
  remainingMs: number;
  elapsedMs: number;
  sessionId: string;
  killCount: number;
  width: number;
  height: number;
  freeze?: boolean;
}

export function CandleVessel(props: CandleVesselProps): JSX.Element {
  if (typeof props.sessionId !== "string" || props.sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  if (!Number.isFinite(props.progress)) {
    throw new Error("progress must be a finite number");
  }
  if (!Number.isFinite(props.remainingMs) || !Number.isFinite(props.elapsedMs)) {
    throw new Error("remainingMs and elapsedMs must be finite numbers");
  }
  if (!Number.isFinite(props.killCount)) {
    throw new Error("killCount must be a finite number");
  }
  const width = Math.max(1, Math.round(props.width));
  const height = Math.max(1, Math.round(props.height));
  if (width <= 0 || height <= 0) {
    throw new Error("width and height must be positive");
  }

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const freeze = props.freeze === true;
  const remain = waxRemain(props.progress);

  useFaceCanvas(
    canvasRef,
    (ctx, w, h, clockMs) => {
      drawCandleFace(ctx, w, h, {
        progress: props.progress,
        phase: props.phase,
        remainingMs: props.remainingMs,
        killCount: props.killCount,
        clockMs,
        freeze,
      });
    },
    [props.progress, props.phase, props.remainingMs, props.killCount, props.sessionId, freeze],
    { freeze, paused: freeze },
  );

  const label = `Candle ${Math.round(remain * 100)} percent wax remaining, ${props.phase}`;

  return (
    <div
      className="fp-candle"
      data-face="candle"
      data-face-status="ready"
      data-phase={props.phase}
      data-remain={remain.toFixed(3)}
      data-kills={Math.max(0, Math.floor(props.killCount))}
    >
      <canvas ref={canvasRef} role="img" aria-label={label} />
    </div>
  );
}
