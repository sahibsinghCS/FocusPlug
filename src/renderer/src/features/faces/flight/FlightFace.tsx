import { useEffect, useRef, type JSX } from "react";
import type { FaceProps } from "../types";
import { drawFlightFace, type FaceVariant } from "./draw";
import {
  formatClockHm,
  formatGs,
  formatKm,
} from "./math";
import { buildFlightModel } from "./model";

export interface FlightFaceViewProps extends FaceProps {
  variant?: FaceVariant;
  /** Extra camera wander (radians). Stills use this instead of clock-derived idle. */
  idleOverride?: number;
}

function readSize(el: HTMLCanvasElement): { width: number; height: number; dpr: number } {
  const rect = el.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(8, Math.round(rect.width * dpr));
  const height = Math.max(8, Math.round(rect.height * dpr));
  return { width, height, dpr };
}

export function FlightFace(props: FlightFaceViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("FlightFace canvas ref is missing");
    }
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("FlightFace could not create a 2D context");
    }

    let frame = 0;
    let running = true;

    const paint = (): void => {
      const current = propsRef.current;
      const { width, height } = readSize(canvas);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const model = buildFlightModel(current, current.idleOverride);
      drawFlightFace({
        ctx,
        width,
        height,
        model,
        variant: current.variant ?? "instrument",
      });
      canvas.dataset.phase = model.phase;
      canvas.dataset.progress = model.progress.toFixed(3);
      canvas.dataset.complete = model.complete ? "1" : "0";
    };

    const loop = (): void => {
      if (!running) return;
      paint();
      const current = propsRef.current;
      if (current.paused || current.reducedMotion || current.now !== undefined) {
        return;
      }
      frame = window.requestAnimationFrame(loop);
    };

    const onVis = (): void => {
      if (document.hidden) {
        window.cancelAnimationFrame(frame);
        return;
      }
      loop();
    };

    const ro = new ResizeObserver(() => {
      paint();
    });
    ro.observe(canvas);
    document.addEventListener("visibilitychange", onVis);
    loop();

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, []);

  const model = buildFlightModel(props, props.idleOverride);
  const label = model.complete
    ? `Flight complete. Destination ${model.arr.name}.`
    : `Flight ${model.dep.code} to ${model.arr.code}. ${formatKm(model.remainKm)} remaining. ETA ${formatClockHm(model.eta)}. ${formatGs(model.gsKmh)}. ${model.phase}.`;

  return (
    <div
      className={props.className}
      data-face="flight"
      data-variant={props.variant ?? "instrument"}
      data-phase={model.phase}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#07080c",
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
