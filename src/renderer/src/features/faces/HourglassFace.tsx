import { useRef, type JSX } from "react";
import { stillsExtras } from "./adapt";
import { formatFacePercent } from "./clock";
import { paintHourglass } from "./hourglass/draw";
import { transferFromProgress } from "./hourglass/math";
import type { FaceProps } from "./types";
import { useFaceCanvas } from "./useFaceCanvas";

export function HourglassFace(props: FaceProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const extras = stillsExtras();
  const transfer = transferFromProgress(props.progress, props.phase);

  useFaceCanvas(
    canvasRef,
    (ctx, w, h, clockMs) => {
      paintHourglass(ctx, w, h, props, extras.freeze ? 0 : clockMs);
    },
    [
      props.progress,
      props.phase,
      props.elapsedMs,
      props.remainingMs,
      props.sessionId,
      extras.freeze,
    ],
    { freeze: extras.freeze },
  );

  return (
    <div
      className={`fp-face fp-hourglass is-${props.phase}`}
      data-face="hourglass"
      data-face-status="ready"
      data-phase={props.phase}
    >
      <canvas
        ref={canvasRef}
        aria-label={`Hourglass ${formatFacePercent(transfer.progress)} transferred, ${props.phase}`}
      />
    </div>
  );
}
