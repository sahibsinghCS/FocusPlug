import { useEffect, useRef, useState, type JSX } from "react";
import land from "../../../assets/land.json";
import { bearing, interpolate, toRadians, type FlightRoute, type LatLon } from "./route";

/**
 * An orthographic globe on a canvas, drawn from coastlines bundled with the
 * app — no tile server, no token, nothing leaves the machine.
 *
 * The globe never changes during a session, so it is rendered once to an
 * offscreen canvas and blitted each frame. Only the arc and the aircraft are
 * redrawn, which is what makes a 60 fps flight affordable next to six other
 * live previews.
 */

const RINGS: Float64Array[] = (land as { rings: number[][] }).rings.map((flat) => {
  const points = new Float64Array((flat.length / 2) * 3);
  for (let i = 0, o = 0; i < flat.length; i += 2, o += 3) {
    const lon = toRadians(flat[i]!);
    const lat = toRadians(flat[i + 1]!);
    const cosLat = Math.cos(lat);
    points[o] = cosLat * Math.cos(lon);
    points[o + 1] = cosLat * Math.sin(lon);
    points[o + 2] = Math.sin(lat);
  }
  return points;
});

interface Basis {
  /** Screen-right, screen-up, and toward-the-viewer unit vectors. */
  ex: number; ey: number; ez: number;
  nx: number; ny: number; nz: number;
  vx: number; vy: number; vz: number;
}

interface View {
  cx: number;
  cy: number;
  /** The circular frame. At globe scale it is the limb; zoomed, a porthole. */
  fitRadius: number;
  /** Projection radius, which grows to make a short hop readable. */
  radius: number;
  basis: Basis;
}

function basisFor(center: LatLon): Basis {
  const lon = toRadians(center.lon);
  const lat = toRadians(center.lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  return {
    ex: -sinLon, ey: cosLon, ez: 0,
    nx: -sinLat * cosLon, ny: -sinLat * sinLon, nz: cosLat,
    vx: cosLat * cosLon, vy: cosLat * sinLon, vz: sinLat,
  };
}

function viewFor(width: number, height: number, route: FlightRoute, compact: boolean): View | null {
  const fitRadius = Math.min(width, height) / 2 - (compact ? 2 : 10);
  if (fitRadius <= 4) {
    return null;
  }
  // Short hops are a few pixels of arc on a whole Earth, so the projection
  // zooms until the route spans a readable share of the frame.
  const angular = route.km / 6371;
  const chord = 2 * Math.sin(Math.max(angular, 1e-4) / 2);
  const wanted = (Math.min(width, height) * 0.58) / chord;
  return {
    cx: width / 2,
    cy: height / 2,
    fitRadius,
    radius: Math.min(Math.max(wanted, fitRadius), fitRadius * 6),
    basis: basisFor(interpolate(route.from, route.to, 0.5)),
  };
}

interface Projected {
  x: number;
  y: number;
  front: boolean;
}

function projectVector(view: View, x: number, y: number, z: number): Projected {
  const { basis, radius } = view;
  return {
    x: view.cx + (x * basis.ex + y * basis.ey + z * basis.ez) * radius,
    y: view.cy - (x * basis.nx + y * basis.ny + z * basis.nz) * radius,
    front: x * basis.vx + y * basis.vy + z * basis.vz > 0,
  };
}

function project(view: View, point: LatLon): Projected {
  const lon = toRadians(point.lon);
  const lat = toRadians(point.lat);
  const cosLat = Math.cos(lat);
  return projectVector(view, cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat));
}

/** A run of consecutive front-facing points, as one subpath. */
function strokeRun(ctx: CanvasRenderingContext2D, points: Projected[]): void {
  let started = false;
  for (const point of points) {
    if (!point.front) {
      started = false;
      continue;
    }
    if (started) {
      ctx.lineTo(point.x, point.y);
    } else {
      ctx.moveTo(point.x, point.y);
      started = true;
    }
  }
}

function frame(ctx: CanvasRenderingContext2D, view: View): void {
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, view.fitRadius, 0, Math.PI * 2);
  ctx.clip();
}

/** Halo, ocean, graticule, land, rim. Fixed for a route, so drawn once. */
function drawBase(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: View,
  compact: boolean,
): void {
  const { cx, cy, fitRadius } = view;
  ctx.clearRect(0, 0, width, height);

  const halo = ctx.createRadialGradient(cx, cy, fitRadius * 0.92, cx, cy, fitRadius * 1.16);
  halo.addColorStop(0, "rgba(93, 178, 255, 0.3)");
  halo.addColorStop(1, "rgba(93, 178, 255, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, fitRadius * 1.16, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  frame(ctx, view);

  const ocean = ctx.createRadialGradient(
    cx - fitRadius * 0.35,
    cy - fitRadius * 0.4,
    fitRadius * 0.1,
    cx,
    cy,
    fitRadius,
  );
  ocean.addColorStop(0, "#15406f");
  ocean.addColorStop(0.6, "#0b2647");
  ocean.addColorStop(1, "#050f1f");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(137, 196, 240, 0.13)";
  ctx.lineWidth = 1;
  const step = view.radius > view.fitRadius * 1.6 ? 10 : 30;
  for (let lat = -80; lat <= 80; lat += step) {
    const points: Projected[] = [];
    for (let lon = -180; lon <= 180; lon += 4) {
      points.push(project(view, { lat, lon }));
    }
    ctx.beginPath();
    strokeRun(ctx, points);
    ctx.stroke();
  }
  for (let lon = -180; lon < 180; lon += step) {
    const points: Projected[] = [];
    for (let lat = -90; lat <= 90; lat += 4) {
      points.push(project(view, { lat, lon }));
    }
    ctx.beginPath();
    strokeRun(ctx, points);
    ctx.stroke();
  }

  ctx.beginPath();
  for (const ring of RINGS) {
    let started = false;
    for (let i = 0; i < ring.length; i += 3) {
      const point = projectVector(view, ring[i]!, ring[i + 1]!, ring[i + 2]!);
      if (!point.front) {
        started = false;
        continue;
      }
      if (started) {
        ctx.lineTo(point.x, point.y);
      } else {
        ctx.moveTo(point.x, point.y);
        started = true;
      }
    }
  }
  ctx.fillStyle = "#1d4a5f";
  ctx.fill();
  ctx.strokeStyle = "rgba(126, 199, 228, 0.55)";
  ctx.lineWidth = compact ? 0.6 : 0.9;
  ctx.stroke();

  ctx.restore();

  ctx.strokeStyle = "rgba(147, 205, 255, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, fitRadius, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Half an airliner seen from above, nose at +1, mirrored to draw the other
 * wing. A triangle reads as a cursor; this reads as an aircraft.
 */
const PLANE: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0.82, 0.08],
  [0.34, 0.12],
  [0.12, 0.13],
  [-0.28, 0.9],
  [-0.5, 0.9],
  [-0.27, 0.17],
  [-0.62, 0.15],
  [-0.79, 0.44],
  [-0.93, 0.44],
  [-0.89, 0.12],
  [-1, 0.07],
];

function planePath(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.beginPath();
  ctx.moveTo(PLANE[0]![0] * size, 0);
  for (const [x, y] of PLANE) {
    ctx.lineTo(x * size, y * size);
  }
  for (let i = PLANE.length - 1; i >= 1; i -= 1) {
    const [x, y] = PLANE[i]!;
    ctx.lineTo(x * size, -y * size);
  }
  ctx.closePath();
}

const ARC_STEPS = 160;

/** Route, endpoints and aircraft — the only things that move. */
function drawFlight(
  ctx: CanvasRenderingContext2D,
  view: View,
  route: FlightRoute,
  progress: number,
  compact: boolean,
): void {
  ctx.save();
  frame(ctx, view);

  const flown = Math.min(1, Math.max(0, progress));
  const arc: Projected[] = [];
  for (let step = 0; step <= ARC_STEPS; step += 1) {
    arc.push(project(view, interpolate(route.from, route.to, step / ARC_STEPS)));
  }

  const strokeArc = (
    from: number,
    to: number,
    style: string,
    lineWidth: number,
    dash: number[],
  ): void => {
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = style;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    strokeRun(ctx, arc.slice(from, to + 1));
    ctx.stroke();
    ctx.restore();
  };

  strokeArc(0, ARC_STEPS, "rgba(214, 238, 255, 0.28)", compact ? 1 : 1.4, [3, 5]);

  const cut = Math.round(flown * ARC_STEPS);
  ctx.save();
  ctx.shadowColor = "rgba(125, 216, 255, 0.9)";
  ctx.shadowBlur = compact ? 4 : 10;
  strokeArc(0, cut, "#8fe0ff", compact ? 1.4 : 2.2, []);
  ctx.restore();

  const marker = (point: LatLon, filled: boolean): void => {
    const p = project(view, point);
    if (!p.front) {
      return;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, compact ? 1.6 : 3, 0, Math.PI * 2);
    ctx.fillStyle = filled ? "#dff3ff" : "rgba(9, 20, 34, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "#8fe0ff";
    ctx.lineWidth = compact ? 0.8 : 1.4;
    ctx.stroke();
  };
  marker(route.from, true);
  marker(route.to, false);

  const here = project(view, interpolate(route.from, route.to, flown));
  if (here.front) {
    // Heading is measured on screen, so the aircraft sits right on the arc
    // whatever the projection is doing at that latitude.
    const ahead = project(view, interpolate(route.from, route.to, Math.min(1, flown + 0.002)));
    const angle =
      flown >= 1
        ? toRadians(bearing(route.from, route.to))
        : Math.atan2(ahead.y - here.y, ahead.x - here.x);
    const size = compact ? 5 : 13;

    ctx.save();
    ctx.translate(here.x, here.y);
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(160, 226, 255, 0.95)";
    ctx.shadowBlur = compact ? 5 : 14;
    ctx.fillStyle = "#ffffff";
    planePath(ctx, size);
    ctx.fill();
    if (!compact) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(120, 190, 230, 0.85)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

/** Distance from the target at which easing has visibly arrived. */
const SETTLED = 0.00002;

export function Globe(props: {
  route: FlightRoute;
  progress: number;
  compact?: boolean;
  className?: string;
}): JSX.Element {
  const compact = props.compact ?? false;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const targetRef = useRef(props.progress);
  const shownRef = useRef(props.progress);
  targetRef.current = props.progress;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) {
        setSize({ width: Math.round(box.width), height: Math.round(box.height) });
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) {
      return;
    }
    const view = viewFor(size.width, size.height, props.route, compact);
    if (!view) {
      return;
    }

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    // The globe is fixed for this route and size: render it once, reuse it.
    const base = baseRef.current ?? document.createElement("canvas");
    baseRef.current = base;
    base.width = canvas.width;
    base.height = canvas.height;
    const baseCtx = base.getContext("2d");
    if (!baseCtx) {
      return;
    }
    baseCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawBase(baseCtx, size.width, size.height, view, compact);

    let raf = 0;
    let last = performance.now();
    let painted = Number.NaN;

    const paint = (value: number): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawFlight(ctx, view, props.route, value, compact);
      painted = value;
    };

    /*
     * The timer only ticks four times a second, so the aircraft is eased
     * toward the tick rather than snapped to it. At cruise that is a fraction
     * of a pixel a second; the easing is what stops the preview from stepping.
     */
    const tick = (now: number): void => {
      const dt = Math.min(100, now - last);
      last = now;
      const gap = targetRef.current - shownRef.current;
      shownRef.current += Math.abs(gap) < SETTLED ? gap : gap * (1 - Math.exp(-dt / 110));
      if (!(Math.abs(shownRef.current - painted) < SETTLED)) {
        paint(shownRef.current);
      }
      raf = requestAnimationFrame(tick);
    };

    paint(shownRef.current);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [compact, props.route, size.height, size.width]);

  return (
    <div ref={hostRef} className={props.className}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      />
    </div>
  );
}
