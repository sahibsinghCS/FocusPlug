import { useEffect, useRef, useState, type JSX } from "react";
import type { FlightClock } from "./clock";
import { drawFlightFace, type FaceVariant } from "./draw";
import "./flight.css";
import { createFlightLoop, type FlightLoop } from "./loop";
import { formatGrouped } from "./math";
import type { FlightMapView } from "./mapView";
import { buildFlightModel } from "./model";
import { PLANE_PATH } from "./plane";
import {
  flightStatusLine,
  formatArriveLocal,
  formatRemainHms,
  formatStudied,
  studiedSeconds,
} from "./remain";
import { FlightRoutePicker } from "./RoutePicker";
import { resolveFlightRoutePicker } from "./routePickerVisibility";

export interface FlightFaceViewProps {
  clock: FlightClock;
  variant?: FaceVariant;
  mapView?: FlightMapView;
  /** Extra camera wander (radians). Kept so stills URLs stay valid. */
  idleOverride?: number;
  className?: string;
  compact?: boolean;
  onRouteChange?: (next: { dep: string; arr: string }) => void;
  routePickerOpen?: "dep" | "arr" | null;
  /**
   * Origin/Arrival boxes. Default false so lock stays unobstructed.
   * Settings owns the live picker; pass true only on settings-style surfaces.
   */
  showRoutePicker?: boolean;
}

/** Sharp on scaled displays without paying for a 3× backing store. */
const MAX_PIXEL_RATIO = 2;

/** The close map drifts a few pixels a second, so 30 fps is plenty. */
const DRIFT_FRAME_MS = 33;

function readSize(el: HTMLCanvasElement): { width: number; height: number } {
  // Layout size, not getBoundingClientRect: the lock stage rises in on a transform.
  return { width: Math.max(8, el.clientWidth), height: Math.max(8, el.clientHeight) };
}

function readPixelRatio(): number {
  const raw = window.devicePixelRatio;
  return Number.isFinite(raw) && raw > 0 ? Math.min(MAX_PIXEL_RATIO, Math.max(1, raw)) : 1;
}

export function FlightFace(props: FlightFaceViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  const loopRef = useRef<FlightLoop | null>(null);
  propsRef.current = props;
  const [mapView, setMapView] = useState<FlightMapView>(props.mapView ?? "close");
  const mapViewRef = useRef(mapView);
  mapViewRef.current = mapView;

  useEffect(() => {
    if (props.mapView && props.mapView !== mapViewRef.current) {
      setMapView(props.mapView);
    }
  }, [props.mapView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("FlightFace canvas ref is missing");
    }
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("FlightFace could not create a 2D context");
    }

    // The loop object owns the frame handle; this only throttles the drift.
    let lastPaint = Number.NEGATIVE_INFINITY;

    const paint = (): void => {
      const current = propsRef.current;
      const { width, height } = readSize(canvas);
      const ratio = readPixelRatio();
      const backingWidth = Math.round(width * ratio);
      const backingHeight = Math.round(height * ratio);
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const model = buildFlightModel(current.clock, current.idleOverride);
      const view = mapViewRef.current;
      drawFlightFace({
        ctx,
        width,
        height,
        model,
        variant: current.variant ?? "instrument",
        mapView: view,
        chrome: "overlay",
        timeMs: current.clock.paused || current.clock.reducedMotion ? 0 : performance.now(),
        pixelRatio: ratio,
      });
      lastPaint = performance.now();
      canvas.dataset.phase = model.phase;
      canvas.dataset.progress = model.progress.toFixed(3);
      canvas.dataset.complete = model.complete ? "1" : "0";
      canvas.dataset.dep = model.dep.code;
      canvas.dataset.arr = model.arr.code;
      canvas.dataset.mapView = view;
    };

    // Only the close map drifts. The whole map, a held clock and picker tiles
    // have nothing moving between the parent's clock ticks, so they paint on those.
    const drifting = (): boolean => {
      const current = propsRef.current;
      return (
        (current.variant ?? "instrument") === "instrument" &&
        mapViewRef.current === "close" &&
        !current.clock.paused &&
        !current.clock.reducedMotion
      );
    };

    const loop = createFlightLoop({
      // A still map paints on demand; a drifting one is capped at ~30 fps.
      paint: () => {
        if (document.hidden) {
          return;
        }
        if (!drifting() || performance.now() - lastPaint >= DRIFT_FRAME_MS) {
          paint();
        }
      },
      // Only the close instrument map animates between the parent's ticks.
      isStatic: () => document.hidden || !drifting(),
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
      loop.kick();
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

  // Each render brings a new clock. Repaint a still map with it, and restart
  // the drift when a pause, break or reduced-motion hold ends — the loop parks
  // itself while held, and `kick` is a no-op while a frame is already pending,
  // so this can never stack a second rAF chain.
  useEffect(() => {
    loopRef.current?.kick();
  });

  const model = buildFlightModel(props.clock, props.idleOverride);
  const variant = props.variant ?? "instrument";
  const showRoutePicker = resolveFlightRoutePicker({
    showRoutePicker: props.showRoutePicker,
  });
  const remain = model.complete ? "0" : formatGrouped(model.remainKm);
  const gs = model.complete ? "0" : formatGrouped(model.gsKmh);
  const remainClock = formatRemainHms(model.remaining);
  const studied = formatStudied(studiedSeconds(model.estimateMinutes, model.remaining));
  const arrives = model.complete ? "ARR" : formatArriveLocal(model.eta);
  const status = flightStatusLine(model.phase, model.complete);
  const pct = `${Math.round(model.progress * 100)}%`;
  const label = model.complete
    ? `Flight complete. Destination ${model.arr.name}.`
    : `Flight ${model.dep.code} to ${model.arr.code}. ${remainClock} remaining. ${remain} km left. ${gs} kph. ${model.phase}.`;

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
      data-map-view={mapView}
      data-remain={remainClock}
    >
      <canvas ref={canvasRef} role="img" aria-label={label} />
      {variant === "instrument" ? (
        <>
          {model.complete ? (
            <div className="fp-flight-plate">
              <div>
                <span>DESTINATION SETS</span>
                <b>{model.arr.name.toUpperCase()}</b>
              </div>
            </div>
          ) : null}
          {mapView === "close" && !model.complete ? <PlaneMark /> : null}
          <p className="fp-flight-status">{status}</p>
          <div className="fp-flight-hero">
            <p className="fp-flight-remain">{remainClock}</p>
            <span className="fp-flight-remain-label">Remaining flight time</span>
          </div>
          <div className="fp-flight-progress">
            <b>{model.dep.code}</b>
            <div className="fp-flight-rail" aria-hidden="true">
              <i style={{ width: `${Math.round(model.progress * 100)}%` }} />
              <em style={{ left: `calc(${Math.round(model.progress * 100)}% - 3px)` }} />
              <span className="fp-flight-pct">{pct}</span>
            </div>
            <b>{model.arr.code}</b>
          </div>
          <div className="fp-flight-strip">
            <div>
              <span>Distance left</span>
              <b>
                {remain}
                <small>km</small>
              </b>
            </div>
            <div>
              <span>Ground speed</span>
              <b>
                {gs}
                <small>kph</small>
              </b>
            </div>
            <div>
              <span>Studied</span>
              <b>{studied}</b>
            </div>
            <div>
              <span>Arrives</span>
              <b>{arrives}</b>
            </div>
          </div>
          <div className="fp-flight-views">
            <button
              type="button"
              className={mapView === "close" ? "is-on" : ""}
              aria-pressed={mapView === "close"}
              onClick={() => setMapView("close")}
            >
              In flight
            </button>
            <button
              type="button"
              className={mapView === "route" ? "is-on" : ""}
              aria-pressed={mapView === "route"}
              onClick={() => setMapView("route")}
            >
              Whole map
            </button>
          </div>
        </>
      ) : null}
      {variant === "instrument" && showRoutePicker ? (
        <FlightRoutePicker
          dep={model.dep.code}
          arr={model.arr.code}
          layout="face"
          forceOpen={props.routePickerOpen ?? null}
          onChange={props.onRouteChange}
        />
      ) : null}
    </div>
  );
}

function PlaneMark(): JSX.Element {
  return (
    <svg className="fp-flight-plane" viewBox="0 0 80 80" aria-hidden="true">
      <path fill="#ffffff" d={PLANE_PATH} />
    </svg>
  );
}
