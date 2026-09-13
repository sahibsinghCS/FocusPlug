import { CITY_LIGHTS } from "./cities";
import { coastRings } from "./continents";
import { rasterGlobe, rasterStickerGlobe, stickerLookModel } from "./globe";
import {
  chartLandFade,
  chartRangeKm,
  clamp,
  contrailWidthScale,
  dayAmount,
  degToRad,
  formatClockHm,
  formatGs,
  formatKm,
  formatZulu,
  greatCirclePoint,
  latLonToUnit,
  phasePitchDeg,
  phaseScale,
  wingAttitude,
} from "./math";
import { projectWorld, type FlightModel } from "./model";

export type FaceVariant = "instrument" | "sticker";

export interface DrawFlightInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  model: FlightModel;
  variant: FaceVariant;
  /** HTML overlay owns type; canvas keeps the globe. */
  chrome?: "overlay" | "canvas";
}

const globeBitmapCache = new Map<string, ImageBitmap | HTMLCanvasElement>();

export function stickerGlobeRadius(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("stickerGlobeRadius requires a positive size");
  }
  return Math.min(width, height) * 0.48;
}

function globeKey(model: FlightModel, size: number, variant: FaceVariant): string {
  const source = variant === "sticker" ? stickerLookModel(model) : model;
  if (variant === "sticker") {
    return [
      "sticker",
      size.toFixed(0),
      source.cameraForward[0].toFixed(3),
      source.cameraForward[1].toFixed(3),
      source.cameraForward[2].toFixed(3),
      source.sunLat.toFixed(2),
      source.sunLon.toFixed(2),
    ].join("|");
  }
  return [
    size.toFixed(0),
    model.cameraZoom.toFixed(2),
    model.orbit.toFixed(3),
    model.cameraForward[0].toFixed(3),
    model.cameraForward[1].toFixed(3),
    model.cameraForward[2].toFixed(3),
    model.cameraRight[0].toFixed(3),
    model.cameraRight[1].toFixed(3),
    model.cameraRight[2].toFixed(3),
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
  const image = variant === "sticker" ? rasterStickerGlobe(size, model) : rasterGlobe(model, size);
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
  const outer = radius + 38;
  const ring = ctx.createLinearGradient(cx - outer, cy - outer, cx + outer, cy + outer);
  ring.addColorStop(0, "#4a5368");
  ring.addColorStop(0.28, "#1c2230");
  ring.addColorStop(0.62, "#2c3446");
  ring.addColorStop(1, "#0d1016");
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2, true);
  ctx.fillStyle = ring;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.strokeStyle = "rgba(212,255,58,0.16)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, outer - 3, 0, Math.PI * 2);
  ctx.stroke();
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
  const steps = model.cameraZoom > 6 ? 120 : 72;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
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
    { lat: model.dep.lat, lon: model.dep.lon, code: model.dep.code },
    { lat: model.arr.lat, lon: model.arr.lon, code: model.arr.code },
  ]) {
    const pr = projectWorld(latLonToUnit(end.lat, end.lon), model, cx, cy, radius);
    if (!pr.visible) continue;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, 3.1, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(238,242,248,0.88)";
    ctx.fill();
    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillStyle = "rgba(238,242,248,0.82)";
    ctx.textAlign = "left";
    ctx.fillText(end.code, pr.x + 7, pr.y - 6);
  }
}

function drawCoasts(
  ctx: CanvasRenderingContext2D,
  model: FlightModel,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const width = clamp(1.35 + model.cameraZoom * 0.18, 1.4, 2.8);
  const rangeKm = chartRangeKm(model.totalKm);
  const look = model.cameraForward;
  for (const ring of coastRings()) {
    if (ring.length < 3) continue;
    let started = false;
    ctx.beginPath();
    for (const node of ring) {
      const world = latLonToUnit(node.lat, node.lon);
      if (chartLandFade(world, look, rangeKm) < 0.18) {
        started = false;
        continue;
      }
      const pr = projectWorld(world, model, cx, cy, radius);
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
    ctx.strokeStyle = "rgba(10, 18, 12, 0.78)";
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = "rgba(240, 228, 176, 0.22)";
    ctx.lineWidth = Math.max(0.8, width * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCityLights(ctx: CanvasRenderingContext2D, model: FlightModel, cx: number, cy: number, radius: number): void {
  ctx.save();
  for (const city of CITY_LIGHTS) {
    const world = latLonToUnit(city.lat, city.lon);
    const pr = projectWorld(world, model, cx, cy, radius);
    if (!pr.visible || pr.z < 0.06) continue;
    const intensity = world[0] * model.sun[0] + world[1] * model.sun[1] + world[2] * model.sun[2];
    const night = 1 - dayAmount(intensity);
    if (night < 0.18) continue;
    const alpha = night * city.weight * Math.min(1, pr.z * 1.4);
    const x = Math.round(pr.x);
    const y = Math.round(pr.y);
    const glow = model.cameraZoom > 5 ? 4.4 : 2.8;
    ctx.fillStyle = `rgba(255, 168, 72, ${(alpha * 0.62).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, glow, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 226, 170, ${Math.min(1, alpha * 1.25).toFixed(3)})`;
    ctx.fillRect(x, y, model.cameraZoom > 5 ? 2 : 1, model.cameraZoom > 5 ? 2 : 1);
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
    ctx.strokeStyle = `rgba(210, 232, 255, ${(0.1 + life * 0.22).toFixed(3)})`;
    ctx.lineWidth = (3.2 + life * 7.5) * widthScale;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.strokeStyle = `rgba(236, 246, 255, ${(0.22 + life * 0.62).toFixed(3)})`;
    ctx.lineWidth = (1.2 + life * 3.4) * widthScale;
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
  const pitch = degToRad(phasePitchDeg(model.phase));
  const wings = wingAttitude(model.bank, 34);
  const phaseBoost = model.phase === "climb" ? 1.22 : model.phase === "descent" ? 0.94 : 1;
  const s = phaseBoost * 1.72 * clamp(radius / 240, 0.52, 1.12);

  ctx.save();
  ctx.translate(here.x + 8 + wings.drop * 0.12, here.y + 10);
  ctx.rotate(heading);
  ctx.scale(s, s * 0.78);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(0, 3, 18, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(here.x, here.y);
  ctx.rotate(heading);
  ctx.rotate(pitch);
  ctx.scale(s, s);

  ctx.fillStyle = "#e8edf4";
  ctx.beginPath();
  ctx.moveTo(-wings.leftSpan, wings.leftY);
  ctx.lineTo(-3.2, -2.2);
  ctx.lineTo(-2.4, 4.2);
  ctx.lineTo(-wings.leftSpan + 2.4, wings.leftY + 5.2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(wings.rightSpan, wings.rightY);
  ctx.lineTo(3.2, -2.2);
  ctx.lineTo(2.4, 4.2);
  ctx.lineTo(wings.rightSpan - 2.4, wings.rightY + 5.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#f7f9fc";
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.bezierCurveTo(3.4, -14, 3.6, 6, 2.6, 17);
  ctx.lineTo(-2.6, 17);
  ctx.bezierCurveTo(-3.6, 6, -3.4, -14, 0, -22);
  ctx.fill();

  ctx.fillStyle = "#c5ccd6";
  ctx.beginPath();
  ctx.ellipse(-11, wings.leftY + 2.2, 2.4, 1.3, 0, 0, Math.PI * 2);
  ctx.ellipse(11, wings.rightY + 2.2, 2.4, 1.3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f7f9fc";
  ctx.beginPath();
  ctx.moveTo(-1.4, 10);
  ctx.lineTo(-8.2, 13.2 + wings.drop * 0.1);
  ctx.lineTo(-7.2, 17.4 + wings.drop * 0.1);
  ctx.lineTo(-1.1, 15.6);
  ctx.closePath();
  ctx.moveTo(1.4, 10);
  ctx.lineTo(8.2, 13.2 - wings.drop * 0.1);
  ctx.lineTo(7.2, 17.4 - wings.drop * 0.1);
  ctx.lineTo(1.1, 15.6);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-1.4, 8);
  ctx.lineTo(0, 4);
  ctx.lineTo(1.4, 8);
  ctx.lineTo(1.2, 16);
  ctx.lineTo(-1.2, 16);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#d4ff3a";
  ctx.beginPath();
  ctx.arc(-wings.leftSpan + 1.6, wings.leftY + 1.6, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff2d55";
  ctx.beginPath();
  ctx.arc(wings.rightSpan - 1.6, wings.rightY + 1.6, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(90, 140, 220, 0.75)";
  ctx.beginPath();
  ctx.ellipse(0, -10, 1.2, 4.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBankScale(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  bank: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  const rTick = radius + 20;
  const marks = [-30, -20, -10, 10, 20, 30];
  for (const deg of marks) {
    const a = degToRad(deg) - Math.PI / 2;
    const major = Math.abs(deg) === 30 || Math.abs(deg) === 20;
    ctx.strokeStyle = major ? "rgba(238,242,248,0.72)" : "rgba(238,242,248,0.4)";
    ctx.lineWidth = major ? 2.2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (rTick - (major ? 12 : 7)), Math.sin(a) * (rTick - (major ? 12 : 7)));
    ctx.lineTo(Math.cos(a) * rTick, Math.sin(a) * rTick);
    ctx.stroke();
  }

  ctx.fillStyle = "#d4ff3a";
  ctx.beginPath();
  ctx.moveTo(0, -rTick - 2);
  ctx.lineTo(-5.5, -rTick + 9);
  ctx.lineTo(5.5, -rTick + 9);
  ctx.closePath();
  ctx.fill();

  ctx.rotate(degToRad(bank));
  ctx.fillStyle = "#eef2f8";
  ctx.strokeStyle = "rgba(7,8,12,0.7)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -radius - 6);
  ctx.lineTo(-10, -radius + 14);
  ctx.lineTo(10, -radius + 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
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
  const barH = 92;
  const y = h - barH;
  ctx.fillStyle = "rgba(7,8,12,0.92)";
  ctx.fillRect(0, y, w, barH);
  ctx.fillStyle = "rgba(212,255,58,0.2)";
  ctx.fillRect(0, y, w, 1);

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

  const cellW = w / cells.length;
  ctx.textBaseline = "alphabetic";
  cells.forEach((cell, i) => {
    const label = cell[0] ?? "";
    const value = cell[1] ?? "";
    const x = 36 + i * cellW;
    if (i > 0) {
      ctx.fillStyle = "rgba(170,190,220,0.1)";
      ctx.fillRect(i * cellW, y + 16, 1, barH - 28);
    }
    ctx.font = "12px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillStyle = "#8b97a8";
    ctx.fillText(label, x, y + 28);
    ctx.font = "28px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillStyle = "#eef2f8";
    ctx.fillText(value, x, y + 64);
  });
}

function drawHeader(ctx: CanvasRenderingContext2D, model: FlightModel, w: number): void {
  ctx.save();
  ctx.font = "13px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillStyle = "#8b97a8";
  ctx.textAlign = "left";
  ctx.fillText("FLIGHT", 32, 34);
  ctx.fillStyle = "#eef2f8";
  ctx.fillText(`${model.dep.code}–${model.arr.code}`, 96, 34);
  ctx.textAlign = "right";
  ctx.fillStyle = "#8b97a8";
  ctx.fillText(formatZulu(model.now), w - 32, 34);
  ctx.fillStyle = "#d4ff3a";
  ctx.fillText(model.phase.toUpperCase(), w - 32, 56);
  ctx.restore();
}

function drawCompletePlate(ctx: CanvasRenderingContext2D, model: FlightModel, w: number): void {
  if (!model.complete) return;
  ctx.save();
  ctx.textAlign = "center";
  const plateW = 420;
  const plateH = 78;
  const px = w * 0.5 - plateW / 2;
  const py = 72;
  ctx.fillStyle = "rgba(7,8,12,0.72)";
  ctx.fillRect(px, py, plateW, plateH);
  ctx.strokeStyle = "rgba(212,255,58,0.28)";
  ctx.strokeRect(px + 0.5, py + 0.5, plateW - 1, plateH - 1);
  ctx.fillStyle = "#8b97a8";
  ctx.font = "12px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillText("DESTINATION SETS", w * 0.5, py + 26);
  ctx.fillStyle = "#eef2f8";
  ctx.font = "34px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillText(model.arr.name.toUpperCase(), w * 0.5, py + 60);
  ctx.restore();
}

function drawSticker(
  ctx: CanvasRenderingContext2D,
  model: FlightModel,
  cx: number,
  cy: number,
  radius: number,
): void {
  const look = stickerLookModel(model);
  const globe = globeLayer(look, 256, "sticker");
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(globe, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  const a = projectWorld(latLonToUnit(look.dep.lat, look.dep.lon), look, cx, cy, radius);
  const b = projectWorld(latLonToUnit(look.arr.lat, look.arr.lon), look, cx, cy, radius);
  const mid = projectWorld(
    latLonToUnit((look.dep.lat + look.arr.lat) / 2 + 12, (look.dep.lon + look.arr.lon) / 2),
    look,
    cx,
    cy,
    radius,
  );
  const lift = radius * 0.22;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(mid.x, mid.y - lift, b.x, b.y);
  ctx.strokeStyle = "#ffb020";
  ctx.lineWidth = Math.max(1.6, radius * 0.035);
  ctx.stroke();

  const p = projectWorld(latLonToUnit(look.planeLat, look.planeLon), look, cx, cy, radius);
  const mark = Math.max(3.2, radius * 0.055);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - mark);
  ctx.lineTo(p.x + mark * 0.8, p.y + mark * 0.8);
  ctx.lineTo(p.x - mark * 0.8, p.y + mark * 0.8);
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

  if (variant === "sticker") {
    const radius = stickerGlobeRadius(width, height);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const halo = ctx.createRadialGradient(cx, cy, radius * 0.72, cx, cy, radius + 6);
    halo.addColorStop(0, "rgba(26, 32, 48, 0)");
    halo.addColorStop(1, "rgba(110, 196, 220, 0.22)");
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();
    drawSticker(ctx, model, cx, cy, radius);
    return;
  }

  drawScrews(ctx, width, height);

  const radius = Math.min(width, height) * 0.38 * phaseScale(model.phase);
  const cx = width * 0.5;
  const cy = height * 0.455;

  drawBezel(ctx, cx, cy, radius);
  drawBankScale(ctx, cx, cy, radius, model.bank);
  const rasterSize = model.paused || model.reducedMotion
    ? Math.max(480, Math.min(720, Math.round(radius * 2.1)))
    : Math.max(256, Math.min(384, Math.round(radius * 1.25)));
  const globe = globeLayer(model, rasterSize, "instrument");

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(globe, cx - radius, cy - radius, radius * 2, radius * 2);
  drawCoasts(ctx, model, cx, cy, radius);
  drawCityLights(ctx, model, cx, cy, radius);
  drawRoute(ctx, model, cx, cy, radius);
  drawContrail(ctx, model, cx, cy, radius);
  drawWake(ctx, model, cx, cy, radius);
  drawAircraft(ctx, model, cx, cy, radius);
  ctx.restore();
  drawGlass(ctx, cx, cy, radius);
  if (input.chrome !== "overlay") {
    drawHeader(ctx, model, width);
    drawCompletePlate(ctx, model, width);
    drawStrip(ctx, model, width, height);
  }
  drawGrain(ctx, width, height);
}

function drawWake(
  ctx: CanvasRenderingContext2D,
  model: FlightModel,
  cx: number,
  cy: number,
  radius: number,
): void {
  if (model.complete) return;
  const here = projectWorld(latLonToUnit(model.planeLat, model.planeLon), model, cx, cy, radius);
  if (!here.visible) return;
  const heading = screenHeading(model, cx, cy, radius);
  const aheadGeo = greatCirclePoint(
    model.dep.lat,
    model.dep.lon,
    model.arr.lat,
    model.arr.lon,
    Math.min(1, model.progress + 0.02),
  );
  const ahead = projectWorld(latLonToUnit(aheadGeo.lat, aheadGeo.lon), model, cx, cy, radius);
  let dx = here.x - ahead.x;
  let dy = here.y - ahead.y;
  let len = Math.hypot(dx, dy);
  if (len < 0.8) {
    dx = Math.sin(heading);
    dy = Math.cos(heading);
    len = 1;
  }
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const widthScale = contrailWidthScale(model.phase);
  const tail = model.phase === "climb" ? 148 : model.phase === "descent" ? 124 : 118;
  const curve = degToRad(model.bank) * 26;
  const steps = 12;
  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];
  const core: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const life = 1 - t;
    const x = here.x + ux * tail * t + px * curve * t * t;
    const y = here.y + uy * tail * t + py * curve * t * t;
    const half = (1.4 + life * 9.5) * Math.max(0.62, widthScale);
    left.push({ x: x + px * half, y: y + py * half });
    right.push({ x: x - px * half, y: y - py * half });
    core.push({ x, y });
  }
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const firstLeft = left[0];
  if (!firstLeft) {
    ctx.restore();
    return;
  }
  ctx.moveTo(firstLeft.x, firstLeft.y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  for (let i = right.length - 1; i >= 0; i -= 1) {
    const p = right[i];
    if (p) ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  const fade = ctx.createLinearGradient(
    here.x,
    here.y,
    here.x + ux * tail,
    here.y + uy * tail,
  );
  fade.addColorStop(0, "rgba(12, 10, 8, 0.72)");
  fade.addColorStop(0.45, "rgba(12, 10, 8, 0.32)");
  fade.addColorStop(1, "rgba(12, 10, 8, 0)");
  ctx.fillStyle = fade;
  ctx.fill();

  ctx.beginPath();
  const firstCore = core[0];
  if (firstCore) {
    ctx.moveTo(firstCore.x, firstCore.y);
    for (const p of core) ctx.lineTo(p.x, p.y);
    const coreFade = ctx.createLinearGradient(
      here.x,
      here.y,
      here.x + ux * tail,
      here.y + uy * tail,
    );
    coreFade.addColorStop(0, `rgba(236, 246, 255, ${0.92 * Math.max(0.55, widthScale)})`);
    coreFade.addColorStop(1, "rgba(236, 246, 255, 0)");
    ctx.strokeStyle = coreFade;
    ctx.lineWidth = 3.2 * Math.max(0.55, widthScale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.globalAlpha = 0.035;
  for (let i = 0; i < 220; i += 1) {
    const x = ((i * 127 + 19) * 131) % w;
    const y = ((i * 89 + 41) * 97) % h;
    ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#000000";
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}
