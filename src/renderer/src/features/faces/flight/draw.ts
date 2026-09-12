import { CITY_LIGHTS } from "./cities";
import { rasterGlobe, rasterStickerGlobe } from "./globe";
import {
  contrailWidthScale,
  dayAmount,
  degToRad,
  formatClockHm,
  formatGs,
  formatKm,
  formatZulu,
  greatCirclePoint,
  latLonToUnit,
  phaseScale,
} from "./math";
import { projectWorld, type FlightModel } from "./model";

export type FaceVariant = "instrument" | "sticker";

export interface DrawFlightInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  model: FlightModel;
  variant: FaceVariant;
}

const globeBitmapCache = new Map<string, ImageBitmap | HTMLCanvasElement>();

function globeKey(model: FlightModel, size: number, variant: FaceVariant): string {
  if (variant === "sticker") return `sticker:${size}`;
  return [
    size.toFixed(0),
    model.cameraForward[0].toFixed(3),
    model.cameraForward[1].toFixed(3),
    model.cameraForward[2].toFixed(3),
    model.sunLat.toFixed(2),
    model.sunLon.toFixed(2),
  ].join("|");
}

function blitImageData(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context unavailable for globe blit");
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function globeLayer(model: FlightModel, size: number, variant: FaceVariant): HTMLCanvasElement {
  const key = globeKey(model, size, variant);
  const hit = globeBitmapCache.get(key);
  if (hit && "getContext" in hit) {
    return hit;
  }
  const image = variant === "sticker" ? rasterStickerGlobe(size) : rasterGlobe(model, size);
  const canvas = blitImageData(image);
  if (globeBitmapCache.size > 8) {
    globeBitmapCache.clear();
  }
  globeBitmapCache.set(key, canvas);
  return canvas;
}

function fillPanel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.1, w * 0.5, h * 0.5, h * 0.78);
  g.addColorStop(0, "#10141c");
  g.addColorStop(0.55, "#07080c");
  g.addColorStop(1, "#04050a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawBezel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.save();
  const outer = radius + 28;
  const ring = ctx.createLinearGradient(cx - outer, cy - outer, cx + outer, cy + outer);
  ring.addColorStop(0, "#3a4254");
  ring.addColorStop(0.35, "#1b202c");
  ring.addColorStop(0.7, "#2a3140");
  ring.addColorStop(1, "#12151c");
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2, true);
  ctx.fillStyle = ring;
  ctx.fill();

  ctx.strokeStyle = "rgba(212,255,58,0.16)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(cx, cy, outer - 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(170,190,220,0.14)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 72; i += 1) {
    const a = (i / 72) * Math.PI * 2;
    const major = i % 6 === 0;
    const r0 = outer - (major ? 11 : 7);
    ctx.strokeStyle = major ? "rgba(238,242,248,0.38)" : "rgba(170,190,220,0.16)";
    ctx.lineWidth = major ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (outer - 3), cy + Math.sin(a) * (outer - 3));
    ctx.stroke();
  }
  ctx.restore();
}

function drawScrews(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const spots = [
    [36, 36],
    [w - 36, 36],
    [36, h - 36],
    [w - 36, h - 36],
  ];
  for (const spot of spots) {
    const x = spot[0] ?? 0;
    const y = spot[1] ?? 0;
    const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 8);
    g.addColorStop(0, "#4a5366");
    g.addColorStop(1, "#12151c");
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(238,242,248,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 3.5, y - 3.5);
    ctx.lineTo(x + 3.5, y + 3.5);
    ctx.moveTo(x + 3.5, y - 3.5);
    ctx.lineTo(x - 3.5, y + 3.5);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.stroke();
  }
}

function drawRoute(ctx: CanvasRenderingContext2D, model: FlightModel, cx: number, cy: number, radius: number): void {
  ctx.save();
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= 72; i += 1) {
    const t = i / 72;
    const p = greatCirclePoint(model.dep.lat, model.dep.lon, model.arr.lat, model.arr.lon, t);
    const pr = projectWorld(latLonToUnit(p.lat, p.lon), model, cx, cy, radius);
    if (!pr.visible) {
      started = false;
      continue;
    }
    if (!started) {
      ctx.moveTo(pr.x, pr.y);
      started = true;
    } else {
      ctx.lineTo(pr.x, pr.y);
    }
  }
  ctx.strokeStyle = "rgba(212,255,58,0.22)";
  ctx.lineWidth = 1.15;
  ctx.setLineDash([3, 5]);
  ctx.stroke();
  ctx.restore();

  for (const end of [
    { lat: model.dep.lat, lon: model.dep.lon },
    { lat: model.arr.lat, lon: model.arr.lon },
  ]) {
    const pr = projectWorld(latLonToUnit(end.lat, end.lon), model, cx, cy, radius);
    if (!pr.visible) continue;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(238,242,248,0.8)";
    ctx.fill();
  }
}

function drawCityLights(ctx: CanvasRenderingContext2D, model: FlightModel, cx: number, cy: number, radius: number): void {
  ctx.save();
  for (const city of CITY_LIGHTS) {
    const world = latLonToUnit(city.lat, city.lon);
    const pr = projectWorld(world, model, cx, cy, radius);
    if (!pr.visible || pr.z < 0.08) continue;
    const intensity = world[0] * model.sun[0] + world[1] * model.sun[1] + world[2] * model.sun[2];
    const night = 1 - dayAmount(intensity);
    if (night < 0.22) continue;
    const alpha = night * city.weight * Math.min(1, pr.z * 1.35);
    ctx.fillStyle = `rgba(255, 196, 120, ${alpha.toFixed(3)})`;
    ctx.fillRect(Math.round(pr.x), Math.round(pr.y), 1, 1);
  }
  ctx.restore();
}

function drawContrail(ctx: CanvasRenderingContext2D, model: FlightModel, cx: number, cy: number, radius: number): void {
  if (model.contrail.length < 2) return;
  const widthScale = contrailWidthScale(model.phase);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 1; i < model.contrail.length; i += 1) {
    const a = model.contrail[i - 1];
    const b = model.contrail[i];
    if (!a || !b) continue;
    const pa = projectWorld(latLonToUnit(a.lat, a.lon), model, cx, cy, radius);
    const pb = projectWorld(latLonToUnit(b.lat, b.lon), model, cx, cy, radius);
    if (!pa.visible || !pb.visible) continue;
    const life = 1 - b.ageSec / 90;
    if (life <= 0) continue;
    ctx.strokeStyle = `rgba(220, 236, 255, ${(0.08 + life * 0.42).toFixed(3)})`;
    ctx.lineWidth = (0.4 + life * 2.6) * widthScale;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.restore();
}

function screenHeading(
  model: FlightModel,
  cx: number,
  cy: number,
  radius: number,
): number {
  const here = projectWorld(latLonToUnit(model.planeLat, model.planeLon), model, cx, cy, radius);
  const next = greatCirclePoint(
    model.dep.lat,
    model.dep.lon,
    model.arr.lat,
    model.arr.lon,
    Math.min(1, model.progress + 0.018),
  );
  const ahead = projectWorld(latLonToUnit(next.lat, next.lon), model, cx, cy, radius);
  return Math.atan2(ahead.x - here.x, here.y - ahead.y);
}

function drawAircraft(
  ctx: CanvasRenderingContext2D,
  model: FlightModel,
  cx: number,
  cy: number,
  radius: number,
): void {
  const here = projectWorld(latLonToUnit(model.planeLat, model.planeLon), model, cx, cy, radius);
  if (!here.visible) return;
  const heading = screenHeading(model, cx, cy, radius);
  const bank = degToRad(model.bank);
  const s = model.phase === "climb" ? 1.12 : model.phase === "descent" ? 0.92 : 1;

  ctx.save();
  ctx.translate(here.x + 6, here.y + 7);
  ctx.rotate(heading);
  ctx.scale(s, s * Math.max(0.74, Math.cos(bank)));
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(here.x, here.y);
  ctx.rotate(heading);
  ctx.transform(1, 0, Math.sin(bank) * 0.42, Math.max(0.7, Math.cos(bank)), 0, 0);
  ctx.scale(s, s);

  ctx.fillStyle = "#e8edf6";
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.bezierCurveTo(2.2, -12, 2.4, 8, 1.6, 13);
  ctx.lineTo(-1.6, 13);
  ctx.bezierCurveTo(-2.4, 8, -2.2, -12, 0, -16);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-15, 1);
  ctx.lineTo(-2, -1.2);
  ctx.lineTo(-1.4, 3.2);
  ctx.lineTo(-13.5, 4.6);
  ctx.closePath();
  ctx.moveTo(15, 1);
  ctx.lineTo(2, -1.2);
  ctx.lineTo(1.4, 3.2);
  ctx.lineTo(13.5, 4.6);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-5.2, 11);
  ctx.lineTo(-1.2, 9.4);
  ctx.lineTo(-1.1, 12.6);
  ctx.lineTo(-4.6, 13.4);
  ctx.closePath();
  ctx.moveTo(5.2, 11);
  ctx.lineTo(1.2, 9.4);
  ctx.lineTo(1.1, 12.6);
  ctx.lineTo(4.6, 13.4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#d4ff3a";
  ctx.fillRect(-14.6, 1.4, 1.6, 1.6);
  ctx.fillStyle = "#ff2d55";
  ctx.fillRect(13, 1.4, 1.6, 1.6);

  ctx.fillStyle = "rgba(122,162,255,0.55)";
  ctx.fillRect(-0.7, -8, 1.4, 6);
  ctx.restore();
}

function drawGlass(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const sheen = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius * 0.4, cy + radius * 0.2);
  sheen.addColorStop(0, "rgba(255,255,255,0.14)");
  sheen.addColorStop(0.28, "rgba(255,255,255,0.03)");
  sheen.addColorStop(0.55, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  const vignette = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = vignette;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawStrip(
  ctx: CanvasRenderingContext2D,
  model: FlightModel,
  w: number,
  h: number,
): void {
  const y = h - 54;
  ctx.fillStyle = "rgba(7,8,12,0.82)";
  ctx.fillRect(0, y - 8, w, 62);
  ctx.fillStyle = "rgba(212,255,58,0.14)";
  ctx.fillRect(0, y - 8, w, 1);

  const route = `${model.dep.code}  →  ${model.arr.code}`;
  const remain = model.complete ? "0 km" : formatKm(model.remainKm);
  const eta = model.complete ? "ARR" : formatClockHm(model.eta);
  const gs = model.complete ? "0 km/h" : formatGs(model.gsKmh);
  const cells = [
    ["DEP/ARR", route],
    ["REMAIN", remain],
    ["ETA", eta],
    ["GS", gs],
  ];

  ctx.font = "500 10px 'IBM Plex Mono', ui-monospace, monospace";
  const cellW = w / cells.length;
  cells.forEach((cell, i) => {
    const label = cell[0] ?? "";
    const value = cell[1] ?? "";
    const x = 28 + i * cellW;
    ctx.fillStyle = "#6b768a";
    ctx.fillText(label, x, y + 10);
    ctx.fillStyle = "#eef2f8";
    ctx.font = "500 18px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillText(value, x, y + 34);
    ctx.font = "500 10px 'IBM Plex Mono', ui-monospace, monospace";
  });
}

function drawHeader(ctx: CanvasRenderingContext2D, model: FlightModel, w: number): void {
  ctx.save();
  ctx.font = "500 11px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillStyle = "#6b768a";
  ctx.textAlign = "left";
  ctx.fillText("FACE  FLIGHT", 28, 28);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9aa6b8";
  ctx.fillText(formatZulu(model.now), w - 28, 28);
  ctx.fillText(model.phase.toUpperCase(), w - 28, 46);
  ctx.restore();
}

function drawCompletePlate(ctx: CanvasRenderingContext2D, model: FlightModel, w: number, h: number): void {
  if (!model.complete) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(7,8,12,0.42)";
  ctx.fillRect(w * 0.5 - 180, h * 0.18, 360, 86);
  ctx.fillStyle = "#6b768a";
  ctx.font = "500 11px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillText("DESTINATION SETS", w * 0.5, h * 0.18 + 22);
  ctx.fillStyle = "#eef2f8";
  ctx.font = "600 36px Geist, ui-sans-serif, sans-serif";
  ctx.fillText(model.arr.name.toUpperCase(), w * 0.5, h * 0.18 + 62);
  ctx.restore();
}

function drawSticker(
  ctx: CanvasRenderingContext2D,
  model: FlightModel,
  cx: number,
  cy: number,
  radius: number,
): void {
  const globe = globeLayer(model, 256, "sticker");
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(globe, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  const a = projectWorld(latLonToUnit(model.dep.lat, model.dep.lon), model, cx, cy, radius);
  const b = projectWorld(latLonToUnit(model.arr.lat, model.arr.lon), model, cx, cy, radius);
  const mid = projectWorld(
    latLonToUnit((model.dep.lat + model.arr.lat) / 2 + 12, (model.dep.lon + model.arr.lon) / 2),
    model,
    cx,
    cy,
    radius,
  );
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(mid.x, mid.y - 40, b.x, b.y);
  ctx.strokeStyle = "#ffb020";
  ctx.lineWidth = 6;
  ctx.stroke();

  const p = projectWorld(latLonToUnit(model.planeLat, model.planeLon), model, cx, cy, radius);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 10);
  ctx.lineTo(p.x + 8, p.y + 8);
  ctx.lineTo(p.x - 8, p.y + 8);
  ctx.closePath();
  ctx.fill();
}

export function drawFlightFace(input: DrawFlightInput): void {
  const { ctx, width, height, model, variant } = input;
  if (width < 8 || height < 8) {
    throw new Error("drawFlightFace requires a positive canvas size");
  }
  ctx.clearRect(0, 0, width, height);
  fillPanel(ctx, width, height);
  drawScrews(ctx, width, height);

  const radius = Math.min(width, height) * 0.34 * phaseScale(model.phase);
  const cx = width * 0.5;
  const cy = height * 0.46;

  if (variant === "sticker") {
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = "#1a2030";
    ctx.fill();
    drawSticker(ctx, model, cx, cy, radius);
    return;
  }

  drawBezel(ctx, cx, cy, radius);
  const rasterSize = Math.max(192, Math.min(384, Math.round(radius * 1.15)));
  const globe = globeLayer(model, rasterSize, "instrument");

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(globe, cx - radius, cy - radius, radius * 2, radius * 2);
  drawCityLights(ctx, model, cx, cy, radius);
  drawRoute(ctx, model, cx, cy, radius);
  drawContrail(ctx, model, cx, cy, radius);
  drawAircraft(ctx, model, cx, cy, radius);
  ctx.restore();
  drawGlass(ctx, cx, cy, radius);
  drawHeader(ctx, model, width);
  drawCompletePlate(ctx, model, width, height);
  drawStrip(ctx, model, width, height);
}
