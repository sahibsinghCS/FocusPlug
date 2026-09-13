import type { FlightMapView } from "./mapView";
import type { FlightModel } from "./model";
import {
  buildTerrainMesh,
  hashRouteSeed,
  routePoint,
  type TerrainMesh,
} from "./terrain";

export type FaceVariant = "instrument" | "sticker";

export interface DrawFlightInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  model: FlightModel;
  variant: FaceVariant;
  mapView?: FlightMapView;
  /** HTML overlay owns type; canvas keeps the map. */
  chrome?: "overlay" | "canvas";
  /** Drift clock in ms. Frozen stills pass 0. */
  timeMs?: number;
}

interface TerrainBlit {
  canvas: HTMLCanvasElement;
  mesh: TerrainMesh;
  width: number;
  height: number;
}

const terrainCache = new Map<string, TerrainBlit>();

function cacheKey(
  width: number,
  height: number,
  seed: number,
  view: FlightMapView,
  variant: FaceVariant,
): string {
  return [
    Math.round(width),
    Math.round(height),
    seed.toString(16),
    view,
    variant,
  ].join("|");
}

function terrainLayer(
  width: number,
  height: number,
  seed: number,
  view: FlightMapView,
  variant: FaceVariant,
): TerrainBlit {
  const key = cacheKey(width, height, seed, view, variant);
  const hit = terrainCache.get(key);
  if (hit) {
    return hit;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(width));
  canvas.height = Math.max(8, Math.round(height));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("2D context unavailable for terrain blit");
  }
  const mesh = buildTerrainMesh(canvas.width, canvas.height, seed, view, variant === "sticker");
  paintMesh(ctx, mesh, canvas.width, canvas.height, view);
  if (terrainCache.size > 6) {
    terrainCache.clear();
  }
  const blit = { canvas, mesh, width: canvas.width, height: canvas.height };
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
    ctx.fill();
  }

  if (mesh.river.length > 1) {
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
    ctx.strokeStyle = "#10182a";
    ctx.lineWidth = view === "route" ? Math.max(14, width * 0.024) : Math.max(22, width * 0.032);
    ctx.stroke();
    ctx.strokeStyle = "#1a2744";
    ctx.lineWidth = view === "route" ? Math.max(8, width * 0.014) : Math.max(14, width * 0.02);
    ctx.stroke();
    ctx.restore();
  }
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

function drawPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  heading: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(0, -26 * scale);
  ctx.bezierCurveTo(3.2 * scale, -16 * scale, 3.4 * scale, 4 * scale, 2.2 * scale, 16 * scale);
  ctx.lineTo(1.1 * scale, 22 * scale);
  ctx.lineTo(-1.1 * scale, 22 * scale);
  ctx.lineTo(-2.2 * scale, 16 * scale);
  ctx.bezierCurveTo(-3.4 * scale, 4 * scale, -3.2 * scale, -16 * scale, 0, -26 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-22 * scale, -1 * scale);
  ctx.lineTo(-2.4 * scale, -6 * scale);
  ctx.lineTo(-2.2 * scale, 1.5 * scale);
  ctx.lineTo(-20 * scale, 4.5 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(22 * scale, -1 * scale);
  ctx.lineTo(2.4 * scale, -6 * scale);
  ctx.lineTo(2.2 * scale, 1.5 * scale);
  ctx.lineTo(20 * scale, 4.5 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-8 * scale, 14 * scale);
  ctx.lineTo(-1.1 * scale, 12 * scale);
  ctx.lineTo(-1.1 * scale, 18 * scale);
  ctx.lineTo(-7.2 * scale, 20 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8 * scale, 14 * scale);
  ctx.lineTo(1.1 * scale, 12 * scale);
  ctx.lineTo(1.1 * scale, 18 * scale);
  ctx.lineTo(7.2 * scale, 20 * scale);
  ctx.closePath();
  ctx.fill();
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
}

function drawRouteMarks(
  ctx: CanvasRenderingContext2D,
  model: FlightModel,
  width: number,
  height: number,
): void {
  const dep = routePoint(0, width, height);
  const arr = routePoint(1, width, height);
  const here = routePoint(model.progress, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(here.x, here.y);
  ctx.lineTo(arr.x, arr.y);
  ctx.stroke();
  ctx.restore();

  for (const mark of [
    { x: dep.x, y: dep.y, code: model.dep.code },
    { x: arr.x, y: arr.y, code: model.arr.code },
  ]) {
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.font = "12px Geist, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.textAlign = mark.code === model.arr.code ? "left" : "right";
    ctx.fillText(mark.code, mark.x + (mark.code === model.arr.code ? 10 : -10), mark.y - 8);
  }
}

export function drawFlightFace(input: DrawFlightInput): void {
  const { ctx, width, height, model, variant } = input;
  if (width < 8 || height < 8) {
    throw new Error("drawFlightFace requires a positive canvas size");
  }
  const mapView = input.mapView ?? "close";
  const timeMs = Number.isFinite(input.timeMs) ? (input.timeMs ?? 0) : 0;
  const seed = hashRouteSeed(model.dep.code, model.arr.code);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b0d0c";
  ctx.fillRect(0, 0, width, height);

  if (variant === "sticker") {
    const layer = terrainLayer(width, height, seed, "close", "sticker");
    ctx.drawImage(layer.canvas, 0, 0, width, height);
    drawPlane(ctx, width * 0.5, height * 0.46, Math.max(0.55, Math.min(width, height) / 90), 0);
    return;
  }

  if (mapView === "route") {
    const layer = terrainLayer(width, height, seed, "route", "instrument");
    ctx.drawImage(layer.canvas, 0, 0, width, height);
    drawRouteMarks(ctx, model, width, height);
    const plane = routePoint(model.progress, width, height);
    const mark = Math.max(0.95, Math.min(width, height) / 300);
    drawPlane(ctx, plane.x, plane.y - 18 * mark, mark, 0);
    drawVignette(ctx, width, height);
    return;
  }

  const padX = Math.round(width * 0.12);
  const padY = Math.round(height * 0.12);
  const layer = terrainLayer(width + padX * 2, height + padY * 2, seed, "close", "instrument");
  const pan = closePan(model, timeMs, width, height);
  ctx.drawImage(layer.canvas, -padX + pan.x, -padY + pan.y, layer.width, layer.height);
  drawVignette(ctx, width, height);
}
