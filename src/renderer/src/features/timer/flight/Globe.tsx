import { useEffect, useRef, useState, type JSX } from "react";
import land from "../../../assets/land.json";
import { bearing, interpolate, toRadians, type FlightRoute, type LatLon } from "./route";

/**
 * An orthographic globe on a canvas, drawn from coastlines bundled with the
 * app — no tile server, no token, nothing leaves the machine.
 *
 * Every land vertex is turned into a unit vector once at module load, so a
 * frame costs three dot products per point instead of four trig calls. That is
 * what lets the picker animate a globe next to five other faces without the
 * panel dropping frames.
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

function projectVector(
  basis: Basis,
  x: number,
  y: number,
  z: number,
): { sx: number; sy: number; front: boolean } {
  return {
    sx: x * basis.ex + y * basis.ey + z * basis.ez,
    sy: x * basis.nx + y * basis.ny + z * basis.nz,
    front: x * basis.vx + y * basis.vy + z * basis.vz > 0,
  };
}

function projectLatLon(basis: Basis, point: LatLon): { sx: number; sy: number; front: boolean } {
  const lon = toRadians(point.lon);
  const lat = toRadians(point.lat);
  const cosLat = Math.cos(lat);
  return projectVector(basis, cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat));
}

const ARC_STEPS = 160;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  route: FlightRoute,
  progress: number,
  compact: boolean,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const fitRadius = Math.min(width, height) / 2 - (compact ? 2 : 10);
  if (fitRadius <= 4) {
    return;
  }

  /*
   * Short hops are a few pixels of arc on a whole Earth, so the projection
   * zooms until the route spans a readable share of the frame. Long-haul
   * routes need no help and stay at globe scale.
   */
  const angular = route.km / 6371;
  const chord = 2 * Math.sin(Math.max(angular, 1e-4) / 2);
  const wanted = (Math.min(width, height) * 0.58) / chord;
  const radius = Math.min(Math.max(wanted, fitRadius), fitRadius * 6);

  const center = interpolate(route.from, route.to, 0.5);
  const basis = basisFor(center);
  const toScreen = (p: { sx: number; sy: number }): [number, number] => [
    cx + p.sx * radius,
    cy - p.sy * radius,
  ];

  ctx.clearRect(0, 0, width, height);

  // Atmosphere: a cool halo just outside the rim.
  const halo = ctx.createRadialGradient(cx, cy, fitRadius * 0.92, cx, cy, fitRadius * 1.16);
  halo.addColorStop(0, "rgba(93, 178, 255, 0.3)");
  halo.addColorStop(1, "rgba(93, 178, 255, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, fitRadius * 1.16, 0, Math.PI * 2);
  ctx.fill();

  /*
   * The frame is always the same circle. At globe scale it is the planet's own
   * limb; zoomed in for a short hop it becomes a porthole onto the surface.
   * Either way you are looking at a sphere, which a rectangular map loses.
   */
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, fitRadius, 0, Math.PI * 2);
  ctx.clip();

  // Ocean, lit from the upper left so the sphere reads as a sphere.
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

  // Graticule every 30 degrees.
  ctx.strokeStyle = "rgba(137, 196, 240, 0.13)";
  ctx.lineWidth = 1;
  const gridStep = radius > fitRadius * 1.6 ? 10 : 30;
  for (let lat = -80; lat <= 80; lat += gridStep) {
    ctx.beginPath();
    let started = false;
    for (let lon = -180; lon <= 180; lon += 4) {
      const p = projectLatLon(basis, { lat, lon });
      if (!p.front) {
        started = false;
        continue;
      }
      const [x, y] = toScreen(p);
      if (started) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        started = true;
      }
    }
    ctx.stroke();
  }
  for (let lon = -180; lon < 180; lon += gridStep) {
    ctx.beginPath();
    let started = false;
    for (let lat = -90; lat <= 90; lat += 4) {
      const p = projectLatLon(basis, { lat, lon });
      if (!p.front) {
        started = false;
        continue;
      }
      const [x, y] = toScreen(p);
      if (started) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        started = true;
      }
    }
    ctx.stroke();
  }

  // Land. Each visible run of a ring is its own subpath; the limb clip hides
  // the chords that closes them.
  ctx.beginPath();
  for (const ring of RINGS) {
    let started = false;
    for (let i = 0; i < ring.length; i += 3) {
      const p = projectVector(basis, ring[i]!, ring[i + 1]!, ring[i + 2]!);
      if (!p.front) {
        started = false;
        continue;
      }
      const [x, y] = toScreen(p);
      if (started) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
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

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, fitRadius, 0, Math.PI * 2);
  ctx.clip();

  const flown = Math.min(1, Math.max(0, progress));
  const arc: Array<{ sx: number; sy: number; front: boolean }> = [];
  for (let step = 0; step <= ARC_STEPS; step += 1) {
    arc.push(projectLatLon(basis, interpolate(route.from, route.to, step / ARC_STEPS)));
  }

  const strokeArc = (from: number, to: number, style: string, lineWidth: number, dash: number[]) => {
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = style;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    let started = false;
    for (let step = from; step <= to; step += 1) {
      const p = arc[step];
      if (!p || !p.front) {
        started = false;
        continue;
      }
      const [x, y] = toScreen(p);
      if (started) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        started = true;
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  const cut = Math.round(flown * ARC_STEPS);
  strokeArc(0, ARC_STEPS, "rgba(214, 238, 255, 0.28)", compact ? 1 : 1.4, [3, 5]);

  ctx.save();
  ctx.shadowColor = "rgba(125, 216, 255, 0.9)";
  ctx.shadowBlur = compact ? 4 : 10;
  strokeArc(0, cut, "#8fe0ff", compact ? 1.4 : 2.2, []);
  ctx.restore();

  const marker = (point: LatLon, filled: boolean): void => {
    const p = projectLatLon(basis, point);
    if (!p.front) {
      return;
    }
    const [x, y] = toScreen(p);
    ctx.beginPath();
    ctx.arc(x, y, compact ? 1.6 : 3, 0, Math.PI * 2);
    ctx.fillStyle = filled ? "#dff3ff" : "rgba(9, 20, 34, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "#8fe0ff";
    ctx.lineWidth = compact ? 0.8 : 1.4;
    ctx.stroke();
  };
  marker(route.from, true);
  marker(route.to, false);

  // The aircraft, turned to its heading on screen rather than on the sphere.
  const here = interpolate(route.from, route.to, flown);
  const ahead = interpolate(route.from, route.to, Math.min(1, flown + 0.004));
  const hp = projectLatLon(basis, here);
  if (hp.front) {
    const ap = projectLatLon(basis, ahead);
    const [hx, hy] = toScreen(hp);
    const [ax, ay] = toScreen(ap);
    const angle =
      flown >= 1 ? toRadians(bearing(route.from, route.to)) : Math.atan2(ay - hy, ax - hx);
    const size = compact ? 4.5 : 11;

    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(160, 226, 255, 0.95)";
    ctx.shadowBlur = compact ? 5 : 14;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.55, size * 0.62);
    ctx.lineTo(-size * 0.28, 0);
    ctx.lineTo(-size * 0.55, -size * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

export function Globe(props: {
  route: FlightRoute;
  progress: number;
  compact?: boolean;
  className?: string;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

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
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(ctx, size.width, size.height, props.route, props.progress, props.compact ?? false);
  }, [props.compact, props.progress, props.route, size.height, size.width]);

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
