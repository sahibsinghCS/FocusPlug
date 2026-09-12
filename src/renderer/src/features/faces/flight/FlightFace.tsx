import { useEffect, useRef, type JSX } from "react";
import type { FlightClock } from "./clock";
import { drawFlightFace, type FaceVariant } from "./draw";
import "./flight.css";
import {
  formatBank,
  formatClockHm,
  formatGrouped,
  formatHdg,
  formatZulu,
} from "./math";
import { buildFlightModel } from "./model";
import { FlightRoutePicker } from "./RoutePicker";

export interface FlightFaceViewProps {
  clock: FlightClock;
  variant?: FaceVariant;
  /** Extra camera wander (radians). Stills use this instead of clock-derived idle. */
  idleOverride?: number;
  className?: string;
  compact?: boolean;
  onRouteChange?: (next: { dep: string; arr: string }) => void;
  routePickerOpen?: "dep" | "arr" | null;
}

function readSize(el: HTMLCanvasElement): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  const width = Math.max(8, Math.round(rect.width));
  const height = Math.max(8, Math.round(rect.height));
  return { width, height };
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
      const model = buildFlightModel(current.clock, current.idleOverride);
      drawFlightFace({
        ctx,
        width,
        height,
        model,
        variant: current.variant ?? "instrument",
        chrome: "overlay",
      });
      canvas.dataset.phase = model.phase;
      canvas.dataset.progress = model.progress.toFixed(3);
      canvas.dataset.complete = model.complete ? "1" : "0";
      canvas.dataset.dep = model.dep.code;
      canvas.dataset.arr = model.arr.code;
      canvas.dataset.zoom = model.cameraZoom.toFixed(2);
    };

    const loop = (): void => {
      if (!running) return;
      paint();
      const current = propsRef.current;
      if (current.clock.paused || current.clock.reducedMotion) {
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
    void document.fonts.ready.then(() => {
      if (running) loop();
    });
    loop();

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, []);

  const model = buildFlightModel(props.clock, props.idleOverride);
  const variant = props.variant ?? "instrument";
  const remain = model.complete ? "0" : formatGrouped(model.remainKm);
  const eta = model.complete ? "ARR" : formatClockHm(model.eta);
  const gs = model.complete ? "0" : formatGrouped(model.gsKmh);
  const label = model.complete
    ? `Flight complete. Destination ${model.arr.name}.`
    : `Flight ${model.dep.code} to ${model.arr.code}. ${remain} km remaining. ETA ${eta}. ${gs} kph. ${model.phase}.`;

  return (
    <div
      className={["fp-flight", props.compact ? "is-compact" : "", props.className]
        .filter(Boolean)
        .join(" ")}
      data-face="flight"
      data-variant={variant}
      data-phase={model.phase}
      data-layout={props.compact ? "host" : "stage"}
      data-dep={model.dep.code}
      data-arr={model.arr.code}
    >
      {variant === "instrument" ? (
        <div className="fp-flight-head">
          <span>
            FLIGHT
            <strong>
              {model.dep.code}–{model.arr.code}
            </strong>
          </span>
          <span>
            {formatZulu(model.now)} <em>{model.phase.toUpperCase()}</em>
            <span className="fp-flight-meta">HDG {formatHdg(model.heading)}</span>
            <em className="fp-flight-bank">BANK {formatBank(model.bank)}</em>
          </span>
        </div>
      ) : null}
      {variant === "instrument" && model.complete ? (
        <div className="fp-flight-plate">
          <div>
            <span>DESTINATION SETS</span>
            <b>{model.arr.name.toUpperCase()}</b>
          </div>
        </div>
      ) : null}
      <canvas ref={canvasRef} role="img" aria-label={label} />
      {variant === "instrument" ? (
        <FlightRoutePicker
          dep={model.dep.code}
          arr={model.arr.code}
          layout="face"
          forceOpen={props.routePickerOpen ?? null}
          onChange={props.onRouteChange}
        />
      ) : null}
      {variant === "instrument" ? (
        <div className="fp-flight-strip">
          <div>
            <span>DEP/ARR</span>
            <b>
              {model.dep.code} → {model.arr.code}
            </b>
          </div>
          <div>
            <span>REMAIN</span>
            <b>
              {remain}
              <small>km</small>
            </b>
          </div>
          <div>
            <span>ETA</span>
            <b>{eta}</b>
          </div>
          <div>
            <span>GS</span>
            <b>
              {gs}
              <small>kph</small>
            </b>
          </div>
        </div>
      ) : null}
    </div>
  );
}
