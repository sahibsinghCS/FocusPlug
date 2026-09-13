import { useEffect, useRef, useState, type JSX } from "react";
import type { FlightClock } from "./clock";
import { drawFlightFace, type FaceVariant } from "./draw";
import "./flight.css";
import { formatGrouped } from "./math";
import type { FlightMapView } from "./mapView";
import { buildFlightModel } from "./model";
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
  const paintRef = useRef<() => void>(() => undefined);
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
      });
      canvas.dataset.phase = model.phase;
      canvas.dataset.progress = model.progress.toFixed(3);
      canvas.dataset.complete = model.complete ? "1" : "0";
      canvas.dataset.dep = model.dep.code;
      canvas.dataset.arr = model.arr.code;
      canvas.dataset.mapView = view;
    };
    paintRef.current = paint;

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

  useEffect(() => {
    paintRef.current();
  }, [mapView]);

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
      <path
        fill="#ffffff"
        d="M40 6c1.4 10 2.4 22 2.4 34.2 0 3.8-.2 7.2-.5 10.2L70 56v5.2L41.6 54.6c-.2 4-.6 7.2-.6 9.2 0 1.4.5 2.8 1.8 3.8L58 74.2V78L40 70.6 22 78v-3.8l15.2-6.6c1.3-1 1.8-2.4 1.8-3.8 0-2-.4-5.2-.6-9.2L10 61.2V56l28.1-5.6c-.3-3-.5-6.4-.5-10.2 0-12.2 1-24.2 2.4-34.2z"
      />
    </svg>
  );
}
