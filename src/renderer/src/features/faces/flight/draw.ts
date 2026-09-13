import type { FlightMapView } from "./mapView";
import type { FlightModel } from "./model";
import { PLANE_BOX, PLANE_PATH, PLANE_SPAN } from "./plane";
import {
  buildTerrainMesh,
  CLOSE_PAD,
  hashRouteSeed,
  routePoint,
  sampleRoute,
  type TerrainMesh,
} from "./terrain";

export type FaceVariant = "instrument" | "sticker";

export interface DrawFlightInput {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels. The caller sizes the backing store and sets the transform for pixelRatio. */
  width: number;
  height: number;
  model: FlightModel;
  variant: FaceVariant;
  mapView?: FlightMapView;
  /** HTML overlay owns type; canvas keeps the map. */
  chrome?: "overlay" | "canvas";
  /** Drift clock in ms. Frozen stills pass 0. */
  timeMs?: number;
  /** Device pixels per CSS pixel, so cached terrain is painted sharp on scaled displays. */
  pixelRatio?: number;
}

interface TerrainBlit {
  canvas: HTMLCanvasElement;
  mesh: TerrainMesh;
  width: number;
  height: number;
}

const terrainCache = new Map<string, TerrainBlit>();
const ROUTE_STEPS = 64;

function cacheKey(
  width: number,
  height: number,
  ratio: number,
  seed: number,
  view: FlightMapView,
  variant: FaceVariant,
): string {
  return [Math.round(width), Math.round(height), ratio, seed.toString(16), view, variant].join("|");
}

function terrainLayer(
  width: number,
  height: number,
  ratio: number,
  seed: number,
  view: FlightMapView,
  variant: FaceVariant,
): TerrainBlit {
  const key = cacheKey(width, height, ratio, seed, view, variant);
  const hit = terrainCache.get(key);
  if (hit) {
    return hit;
  }
  const cssWidth = Math.max(8, Math.round(width));
  const cssHeight = Math.max(8, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("2D context unavailable for terrain blit");
  }
  ctx.scale(ratio, ratio);
  const mesh = buildTerrainMesh(cssWidth, cssHeight, seed, view, variant === "sticker");
  paintMesh(ctx, mesh, cssWidth, cssHeight, view);
  if (terrainCache.size > 6) {
    terrainCache.clear();
  }
  const blit = { canvas, mesh, width: cssWidth, height: cssHeight };
  terrainCache.set(key, blit);
  return blit;
}

function paintMesh(
  ctx: CanvasRenderingContext2D,
  mesh: TerrainMesh,
  width: number,
  height: number,
  view: FlightMapView,
): void {
  ctx.fillStyle = "#1a2818";
  ctx.fillRect(0, 0, width, height);
  for (const tri of mesh.triangles) {
    ctx.beginPath();
    ctx.moveTo(tri.a.x, tri.a.y);
    ctx.lineTo(tri.b.x, tri.b.y);
    ctx.lineTo(tri.c.x, tri.c.y);
    ctx.closePath();
    ctx.fillStyle = tri.color;
    // Stroke in the fill colour so anti-aliased seams never show the ground through.
    ctx.strokeStyle = tri.color;
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }

  // The whole map draws its route live; only the close map has a river baked in.
  if (view !== "close" || mesh.river.length < 2) {
    return;
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const first = mesh.river[0];
  if (first) {
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < mesh.river.length; i += 1) {
      const p = mesh.river[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
  }
  // A valley river, not a route line: thin, muted, and clear of the clock.
  ctx.strokeStyle = "#142331";
  ctx.lineWidth = Math.max(7, width * 0.012);
  ctx.stroke();
  ctx.strokeStyle = "#24425c";
  ctx.lineWidth = Math.max(4, width * 0.0075);
  ctx.stroke();
  ctx.restore();
}

function closePan(
  model: FlightModel,
  timeMs: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const frozen = model.paused || model.reducedMotion;
  const drift = frozen ? 0 : (timeMs / 9000) * Math.PI * 2;
  return {
    x: Math.sin(model.progress * Math.PI * 2 + drift) * width * 0.018,
    y: model.progress * height * 0.04 + Math.cos(drift) * height * 0.01,
  };
}

let planeShape: Path2D | null = null;

function planePath(): Path2D {
  planeShape ??= new Path2D(PLANE_PATH);
  return planeShape;
}

/** Draws the plane centred on (x, y), `span` px wingtip to wingtip, nose along `heading`. */
function drawPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  span: number,
  heading: number,
): void {
  const scale = span / PLANE_SPAN;
  const half = PLANE_BOX / 2;
  // Flat shadow on the ground, offset toward the same corner as the lock plane mark.
  ctx.save();
  ctx.translate(x + span * 0.13, y + span * 0.2);
  ctx.rotate(heading);
  ctx.scale(scale, scale);
  ctx.translate(-half, -half);
  ctx.fillStyle = "rgba(6, 10, 6, 0.3)";
  ctx.fill(planePath());
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.scale(scale, scale);
  ctx.translate(-half, -half);
  ctx.fillStyle = "#ffffff";
  ctx.fill(planePath());
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const g = ctx.createRadialGradient(
    width * 0.5,
    height * 0.42,
    height * 0.12,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.62, "rgba(0,0,0,0.12)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // The stats strip sits on the lower map; darken it a little so the numbers stay readable.
  const scrim = ctx.createLinearGradient(0, height * 0.55, 0, height);
  scrim.addColorStop(0, "rgba(6,10,6,0)");
  scrim.addColorStop(1, "rgba(6,10,6,0.4)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, height * 0.55, width, height * 0.45);
}

/** Whole-map plane size: readable, but small enough to leave the airport codes alone. */
function routePlaneSpan(width: number, height: number): number {
  return Math.min(76, Math.max(40, Math.min(width, height) * 0.13));
}

function drawRoute(
  ctx: CanvasRenderingContext2D,
  model: FlightModel,
  width: number,
  height: number,
  planeSpan: number,
): void {
  const points = sampleRoute(width, height, ROUTE_STEPS);
  const here = routePoint(model.progress, width, height);
  const flownSteps = Math.min(ROUTE_STEPS, Math.floor(model.progress * ROUTE_STEPS));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Ground track under both halves, so the white line holds up on light terrain.
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = "rgba(6, 10, 6, 0.32)";
  ctx.lineWidth = 7;
  ctx.stroke();

  // Still to fly: dashed, along the same curve.
  ctx.beginPath();
  ctx.moveTo(here.x, here.y);
  for (let i = flownSteps + 1; i < points.length; i += 1) {
    const p = points[i];
    if (p) ctx.lineTo(p.x, p.y);
  }
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // Flown: solid.
  const start = points[0];
  if (start && model.progress > 0) {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i <= flownSteps; i += 1) {
      const p = points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(here.x, here.y);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();

  // Airports: a dot on the route and the code underneath, clear of the plane's wings.
  const labelGap = Math.max(14, planeSpan * 0.5 + 6);
  ctx.save();
  ctx.font = '600 12px Archivo, Geist, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const mark of [
    { t: 0, code: model.dep.code },
    { t: 1, code: model.arr.code },
  ]) {
    const p = routePoint(mark.t, width, height);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(6, 10, 6, 0.55)";
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.fillText(mark.code, p.x, p.y + labelGap);
  }
  ctx.restore();
}

function readRatio(raw: number | undefined): number {
  return raw !== undefined && Number.isFinite(raw) && raw > 0 ? Math.min(3, raw) : 1;
}

export function drawFlightFace(input: DrawFlightInput): void {
  const { ctx, width, height, model, variant } = input;
  if (width < 8 || height < 8) {
    throw new Error("drawFlightFace requires a positive canvas size");
  }
  const mapView = input.mapView ?? "close";
  const timeMs = Number.isFinite(input.timeMs) ? (input.timeMs ?? 0) : 0;
  const ratio = readRatio(input.pixelRatio);
  const seed = hashRouteSeed(model.dep.code, model.arr.code);

  ctx.fillStyle = "#0b0d0c";
  ctx.fillRect(0, 0, width, height);

  if (variant === "sticker") {
    const layer = terrainLayer(width, height, ratio, seed, "close", "sticker");
    ctx.drawImage(layer.canvas, 0, 0, width, height);
    drawPlane(ctx, width * 0.5, height * 0.46, Math.min(width, height) * 0.46, 0);
    return;
  }

  if (mapView === "route") {
    const layer = terrainLayer(width, height, ratio, seed, "route", "instrument");
    ctx.drawImage(layer.canvas, 0, 0, width, height);
    drawVignette(ctx, width, height);
    const span = routePlaneSpan(width, height);
    drawRoute(ctx, model, width, height, span);
    const here = routePoint(model.progress, width, height);
    drawPlane(ctx, here.x, here.y, span, here.heading);
    return;
  }

  const padX = Math.round(width * CLOSE_PAD);
  const padY = Math.round(height * CLOSE_PAD);
  const layer = terrainLayer(width + padX * 2, height + padY * 2, ratio, seed, "close", "instrument");
  const pan = closePan(model, timeMs, width, height);
  ctx.drawImage(layer.canvas, -padX + pan.x, -padY + pan.y, layer.width, layer.height);
  drawVignette(ctx, width, height);
}
