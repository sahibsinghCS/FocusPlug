import { useEffect, useRef, type JSX } from "react";
import type { FlightClock } from "./clock";
import { drawFlightFace, type FaceVariant } from "./draw";
import "./flight.css";
import { createFlightLoop, type FlightLoop } from "./loop";
import {
  formatBank,
  formatClockHm,
  formatGrouped,
  formatHdg,
  formatZulu,
} from "./math";
import { buildFlightModel } from "./model";

export interface FlightFaceViewProps {
  clock: FlightClock;
  variant?: FaceVariant;
  /** Extra camera wander (radians). Stills use this instead of clock-derived idle. */
  idleOverride?: number;
  className?: string;
  compact?: boolean;
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
  const loopRef = useRef<FlightLoop | null>(null);
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
    };

    const loop = createFlightLoop({
      paint,
      isStatic: () => {
        const current = propsRef.current;
        return current.clock.paused || current.clock.reducedMotion;
      },
      request: (callback) => window.requestAnimationFrame(callback),
      cancel: (handle) => window.cancelAnimationFrame(handle),
    });
    loopRef.current = loop;

    const onVis = (): void => {
      if (document.hidden) {
        loop.suspend();
        return;
      }
      loop.kick();
    };

    const ro = new ResizeObserver(() => {
      paint();
    });
    ro.observe(canvas);
    document.addEventListener("visibilitychange", onVis);
    void document.fonts.ready.then(() => {
      loop.kick();
    });
    loop.kick();

    return () => {
      loopRef.current = null;
      loop.stop();
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, []);

  // The loop parks itself while the clock is paused (idle / countdown) or
  // reduced motion holds; kick it again whenever that hold clears.
  const animating = !props.clock.paused && !props.clock.reducedMotion;
  useEffect(() => {
    if (animating) {
      loopRef.current?.kick();
    }
  }, [animating]);

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
