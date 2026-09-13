import { hashString, lerp, mulberry32 } from "../canvas";
import { formatFaceClock, formatFacePercent } from "../clock";
import type { FacePhase } from "@shared/faces";
import { isFaceThumb } from "../thumb";
import type { FaceProps } from "../types";
import {
  GLASS_CAP,
  NECK_HALF,
  innerRadius,
  layoutHourglass,
  outerRadius,
  streamEndY,
  toPixel,
  transferFromProgress,
  type HourglassLayout,
  type HourglassTransfer,
} from "./math";

const SAND_LIT = "#f3d27a";
const SAND_MID = "#d4a24a";
const SAND_SHADE = "#8a5a1c";
const SAND_DEEP = "#5a3810";
const BRASS_HI = "#f0dca0";
const BRASS_MID = "#c49648";
const BRASS_LO = "#5a3a16";

const WALL_STEPS = 180;

export function paintHourglass(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  props: FaceProps,
  clockMs: number,
): void {
  const layout = layoutHourglass(width, height);
  const transfer = transferFromProgress(props.progress, props.phase);
  const seed = hashString(props.sessionId || "hourglass");

  ctx.clearRect(0, 0, width, height);
  paintRoom(ctx, width, height, props.phase, layout);
  paintLamp(ctx, layout, props.phase);
  paintFloor(ctx, layout);
  paintPillars(ctx, layout, "back");
  paintGlassVoid(ctx, layout);
  paintSand(ctx, layout, transfer, seed);
  paintStream(ctx, layout, transfer, clockMs, seed);
  paintNeckGlow(ctx, layout, transfer, clockMs);
  paintGlassShell(ctx, layout);
  paintPillars(ctx, layout, "front");
  paintCaps(ctx, layout);
  paintReflection(ctx, layout, transfer);
  if (!isFaceThumb(height)) {
    paintCaption(ctx, width, height, props, transfer);
  }
}

function paintRoom(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: FacePhase,
  layout: HourglassLayout,
): void {
  const wash = ctx.createRadialGradient(
    layout.cx,
    layout.cy + layout.scale * 0.08,
    layout.scale * 0.15,
    layout.cx,
    layout.cy,
    Math.max(width, height) * 0.72,
  );
  wash.addColorStop(0, "#16120e");
  wash.addColorStop(0.38, "#0c0b10");
  wash.addColorStop(1, "#05060a");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  if (phase === "focus") {
    const lime = ctx.createRadialGradient(layout.cx, layout.cy, 8, layout.cx, layout.cy, layout.scale * 1.6);
    lime.addColorStop(0, "rgba(212,255,58,0.05)");
    lime.addColorStop(1, "rgba(212,255,58,0)");
    ctx.fillStyle = lime;
    ctx.fillRect(0, 0, width, height);
  } else if (phase === "break") {
    const rose = ctx.createRadialGradient(layout.cx, layout.cy, 8, layout.cx, layout.cy, layout.scale * 1.6);
    rose.addColorStop(0, "rgba(255,45,85,0.07)");
    rose.addColorStop(1, "rgba(255,45,85,0)");
    ctx.fillStyle = rose;
    ctx.fillRect(0, 0, width, height);
  }
}

function paintLamp(ctx: CanvasRenderingContext2D, layout: HourglassLayout, phase: FacePhase): void {
  const glow = ctx.createRadialGradient(
    layout.cx,
    layout.cy,
    layout.scale * 0.04,
    layout.cx,
    layout.cy,
    layout.scale * 1.15,
  );
  const warm = phase === "break" ? "rgba(232,140,90,0.22)" : "rgba(232,186,90,0.26)";
  glow.addColorStop(0, warm);
  glow.addColorStop(0.45, "rgba(160,110,40,0.08)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, layout.width, layout.height);
}

function paintFloor(ctx: CanvasRenderingContext2D, layout: HourglassLayout): void {
  const y = layout.cy + layout.scale * 1.22;
  const shadow = ctx.createRadialGradient(layout.cx, y, 4, layout.cx, y, layout.scale * 0.72);
  shadow.addColorStop(0, "rgba(0,0,0,0.72)");
  shadow.addColorStop(0.55, "rgba(40,28,12,0.22)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(layout.cx, y, layout.scale * 0.7, layout.scale * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  const plate = ctx.createRadialGradient(layout.cx, y - 2, 6, layout.cx, y, layout.scale * 0.42);
  plate.addColorStop(0, "rgba(90,70,40,0.35)");
  plate.addColorStop(1, "rgba(20,14,8,0)");
  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.ellipse(layout.cx, y - 1, layout.scale * 0.4, layout.scale * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
}

function buildWallPath(
  layout: HourglassLayout,
  radiusAt: (y: number) => number,
  y0: number,
  y1: number,
): Path2D {
  const path = new Path2D();
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  for (let i = 0; i <= WALL_STEPS; i += 1) {
    const y = lo + ((hi - lo) * i) / WALL_STEPS;
    const p = toPixel(layout, radiusAt(y), y);
    if (i === 0) {
      path.moveTo(p.x, p.y);
    } else {
      path.lineTo(p.x, p.y);
    }
  }
  for (let i = WALL_STEPS; i >= 0; i -= 1) {
    const y = lo + ((hi - lo) * i) / WALL_STEPS;
    const p = toPixel(layout, -radiusAt(y), y);
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  return path;
}

function paintGlassVoid(ctx: CanvasRenderingContext2D, layout: HourglassLayout): void {
  const inner = buildWallPath(layout, innerRadius, -GLASS_CAP, GLASS_CAP);
  ctx.save();
  ctx.fillStyle = "#14110d";
  ctx.fill(inner);
  const shade = ctx.createLinearGradient(
    layout.cx - layout.scale * 0.45,
    layout.cy - layout.scale,
    layout.cx + layout.scale * 0.4,
    layout.cy + layout.scale,
  );
  shade.addColorStop(0, "rgba(255,236,200,0.14)");
  shade.addColorStop(0.4, "rgba(40,30,18,0.08)");
  shade.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = shade;
  ctx.fill(inner);
  paintSpecular(ctx, layout, -0.55, 0.22, 0.18);
  paintSpecular(ctx, layout, 0.55, 0.2, 0.16);
  ctx.restore();
}

function topSandPath(layout: HourglassLayout, transfer: HourglassTransfer): Path2D {
  const path = new Path2D();
  const yNeck = -NECK_HALF;
  const ySurf = Math.min(yNeck - 0.01, transfer.topSurfaceY);
  const rSurf = innerRadius(ySurf);
  const surfaceSteps = 36;
  for (let i = 0; i <= surfaceSteps; i += 1) {
    const t = i / surfaceSteps;
    const x = lerp(-rSurf, rSurf, t);
    const dip = transfer.funnel * (1 - (x / Math.max(rSurf, 1e-4)) ** 2);
    let y = ySurf + dip;
    const wall = innerRadius(y) - 0.002;
    const xc = clampAbs(x, wall);
    const p = toPixel(layout, xc, y);
    if (i === 0) {
      path.moveTo(p.x, p.y);
    } else {
      path.lineTo(p.x, p.y);
    }
  }
  const from = ySurf;
  const to = yNeck;
  const steps = 40;
  for (let i = 1; i <= steps; i += 1) {
    const y = from + ((to - from) * i) / steps;
    const p = toPixel(layout, innerRadius(y), y);
    path.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const y = from + ((to - from) * i) / steps;
    const p = toPixel(layout, -innerRadius(y), y);
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  return path;
}

function bottomSandPath(layout: HourglassLayout, transfer: HourglassTransfer): Path2D {
  const path = new Path2D();
  const bottom = transfer.bottom;
  if (bottom.kind === "empty") {
    return path;
  }
  const yFloor = GLASS_CAP;
  const peak = toPixel(layout, 0, bottom.peakY);

  if (bottom.kind === "cone") {
    const left = toPixel(layout, -bottom.baseR, yFloor);
    const right = toPixel(layout, bottom.baseR, yFloor);
    path.moveTo(left.x, left.y);
    path.lineTo(peak.x, peak.y);
    path.lineTo(right.x, right.y);
    path.closePath();
    return path;
  }

  const yShoulder = bottom.shoulderY;
  const steps = 48;
  const rightPeak = toPixel(layout, 0.004, bottom.peakY);
  path.moveTo(rightPeak.x, rightPeak.y);
  for (let i = 0; i <= steps; i += 1) {
    const y = yShoulder + ((yFloor - yShoulder) * i) / steps;
    const p = toPixel(layout, innerRadius(y), y);
    path.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const y = yShoulder + ((yFloor - yShoulder) * i) / steps;
    const p = toPixel(layout, -innerRadius(y), y);
    path.lineTo(p.x, p.y);
  }
  path.lineTo(peak.x, peak.y);
  path.closePath();
  return path;
}

function paintSand(
  ctx: CanvasRenderingContext2D,
  layout: HourglassLayout,
  transfer: HourglassTransfer,
  seed: number,
): void {
  const inner = buildWallPath(layout, innerRadius, -GLASS_CAP, GLASS_CAP);
  ctx.save();
  ctx.clip(inner);

  if (transfer.topFill > 0.012) {
    const top = topSandPath(layout, transfer);
    const y0 = layout.cy + transfer.topSurfaceY * layout.scale;
    const y1 = layout.cy - NECK_HALF * layout.scale;
    const g = ctx.createLinearGradient(layout.cx, y0, layout.cx, y1);
    g.addColorStop(0, SAND_LIT);
    g.addColorStop(0.45, SAND_MID);
    g.addColorStop(1, SAND_SHADE);
    ctx.fillStyle = g;
    ctx.fill(top);

    const light = ctx.createLinearGradient(
      layout.cx - layout.scale * 0.3,
      y0,
      layout.cx + layout.scale * 0.2,
      y1,
    );
    light.addColorStop(0, "rgba(255,236,180,0.28)");
    light.addColorStop(0.55, "rgba(255,220,140,0.04)");
    light.addColorStop(1, "rgba(80,40,8,0.18)");
    ctx.fillStyle = light;
    ctx.fill(top);
    paintGrain(ctx, layout, top, seed ^ 0x9e3779b9, 90, transfer.topSurfaceY, -NECK_HALF);
    paintSandSurface(ctx, layout, transfer, "top");
  }

  if (transfer.bottom.kind !== "empty" && transfer.bottomFill > 0.008) {
    const bot = bottomSandPath(layout, transfer);
    const yPeak = layout.cy + transfer.bottom.peakY * layout.scale;
    const yFloor = layout.cy + GLASS_CAP * layout.scale;
    const g = ctx.createLinearGradient(layout.cx, yPeak, layout.cx, yFloor);
    g.addColorStop(0, SAND_LIT);
    g.addColorStop(0.4, SAND_MID);
    g.addColorStop(1, SAND_DEEP);
    ctx.fillStyle = g;
    ctx.fill(bot);

    const cone = ctx.createRadialGradient(
      layout.cx - layout.scale * 0.08,
      yPeak + layout.scale * 0.06,
      layout.scale * 0.02,
      layout.cx,
      yFloor,
      layout.scale * 0.42,
    );
    cone.addColorStop(0, "rgba(255,230,160,0.22)");
    cone.addColorStop(0.45, "rgba(180,120,40,0.05)");
    cone.addColorStop(1, "rgba(40,22,6,0.28)");
    ctx.fillStyle = cone;
    ctx.fill(bot);
    paintGrain(ctx, layout, bot, seed ^ 0x85ebca77, 110, transfer.bottom.peakY, GLASS_CAP);
    paintSandSurface(ctx, layout, transfer, "bottom");
  }

  ctx.restore();
}

function paintSandSurface(
  ctx: CanvasRenderingContext2D,
  layout: HourglassLayout,
  transfer: HourglassTransfer,
  which: "top" | "bottom",
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,236,190,0.55)";
  ctx.lineWidth = Math.max(1.1, layout.scale * 0.012);
  ctx.lineCap = "round";
  ctx.beginPath();
  if (which === "top") {
    const ySurf = Math.min(-NECK_HALF - 0.01, transfer.topSurfaceY);
    const rSurf = innerRadius(ySurf);
    const steps = 28;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = lerp(-rSurf, rSurf, t);
      const dip = transfer.funnel * (1 - (x / Math.max(rSurf, 1e-4)) ** 2);
      const p = toPixel(layout, x, ySurf + dip);
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
  } else if (transfer.bottom.kind === "cone") {
    const left = toPixel(layout, -transfer.bottom.baseR, transfer.bottom.shoulderY);
    const peak = toPixel(layout, 0, transfer.bottom.peakY);
    const right = toPixel(layout, transfer.bottom.baseR, transfer.bottom.shoulderY);
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(peak.x, peak.y);
    ctx.lineTo(right.x, right.y);
  } else if (transfer.bottom.kind === "bowl") {
    const left = toPixel(layout, -transfer.bottom.baseR, transfer.bottom.shoulderY);
    const peak = toPixel(layout, 0, transfer.bottom.peakY);
    const right = toPixel(layout, transfer.bottom.baseR, transfer.bottom.shoulderY);
    ctx.moveTo(left.x, left.y);
    ctx.quadraticCurveTo(peak.x - layout.scale * 0.12, peak.y + 2, peak.x, peak.y);
    ctx.quadraticCurveTo(peak.x + layout.scale * 0.12, peak.y + 2, right.x, right.y);
  }
  ctx.stroke();
  ctx.restore();
}

function paintGrain(
  ctx: CanvasRenderingContext2D,
  layout: HourglassLayout,
  clip: Path2D,
  seed: number,
  count: number,
  y0: number,
  y1: number,
): void {
  ctx.save();
  ctx.clip(clip);
  const rng = mulberry32(seed);
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  for (let i = 0; i < count; i += 1) {
    const y = lerp(lo, hi, rng());
    const r = innerRadius(y) * (0.15 + 0.8 * rng());
    const x = (rng() * 2 - 1) * r;
    const p = toPixel(layout, x, y);
    const a = 0.08 + rng() * 0.22;
    ctx.fillStyle = rng() > 0.5 ? `rgba(255,236,180,${a})` : `rgba(70,40,12,${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.5 + rng() * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintStream(
  ctx: CanvasRenderingContext2D,
  layout: HourglassLayout,
  transfer: HourglassTransfer,
  clockMs: number,
  seed: number,
): void {
  if (!transfer.flowing) {
    return;
  }
  const y0 = -NECK_HALF;
  const y1 = streamEndY(transfer);
  const half = Math.max(0.011, transfer.streamHalfWidth);
  const top = toPixel(layout, 0, y0);
  const bot = toPixel(layout, 0, y1);
  const widthPx = half * layout.scale * 2;

  ctx.save();
  const bloom = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y);
  bloom.addColorStop(0, "rgba(255,220,130,0.0)");
  bloom.addColorStop(0.1, "rgba(255,214,120,0.38)");
  bloom.addColorStop(0.65, "rgba(232,176,80,0.16)");
  bloom.addColorStop(1, "rgba(210,150,50,0.0)");
  ctx.fillStyle = bloom;
  const haloTop = widthPx * 1.15;
  const haloBot = widthPx * 0.55;
  ctx.beginPath();
  ctx.moveTo(top.x - haloTop, top.y);
  ctx.lineTo(top.x + haloTop, top.y);
  ctx.lineTo(bot.x + haloBot, bot.y);
  ctx.lineTo(bot.x - haloBot, bot.y);
  ctx.closePath();
  ctx.fill();

  const ribbon = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y);
  ribbon.addColorStop(0, "rgba(255,230,160,0.55)");
  ribbon.addColorStop(0.55, "rgba(232,186,90,0.32)");
  ribbon.addColorStop(1, "rgba(210,150,50,0.0)");
  ctx.fillStyle = ribbon;
  const coreTop = widthPx * 0.42;
  const coreBot = widthPx * 0.18;
  ctx.beginPath();
  ctx.moveTo(top.x - coreTop, top.y);
  ctx.lineTo(top.x + coreTop, top.y);
  ctx.lineTo(bot.x + coreBot, bot.y);
  ctx.lineTo(bot.x - coreBot, bot.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const rng = mulberry32(seed ^ 0x2c1b3c6d);
  const grains = 36;
  const span = Math.max(8, bot.y - top.y);
  for (let i = 0; i < grains; i += 1) {
    const base = (i + 0.5) / grains;
    const drift = (clockMs * (0.00048 + rng() * 0.0001) + rng()) % 1;
    const t = (base + drift) % 1;
    const flare = lerp(widthPx * 0.55, widthPx * 0.22, t);
    const xJit = (rng() - 0.5) * flare;
    const y = top.y + t * span;
    const r = 0.9 + rng() * 2.1;
    const a = 0.22 + rng() * 0.55;
    ctx.fillStyle = rng() > 0.4 ? `rgba(255,232,170,${a})` : `rgba(212,160,70,${a})`;
    ctx.beginPath();
    ctx.arc(top.x + xJit, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintNeckGlow(
  ctx: CanvasRenderingContext2D,
  layout: HourglassLayout,
  transfer: HourglassTransfer,
  clockMs: number,
): void {
  const pulse = transfer.flowing ? 0.82 + 0.18 * Math.sin(clockMs / 420) : 0.5;
  const p = toPixel(layout, 0, 0);
  const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, layout.scale * 0.28);
  g.addColorStop(0, `rgba(255,214,120,${0.55 * pulse})`);
  g.addColorStop(0.35, `rgba(210,150,60,${0.22 * pulse})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, layout.scale * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

function glassRing(layout: HourglassLayout): Path2D {
  const ring = new Path2D();
  ring.addPath(buildWallPath(layout, outerRadius, -GLASS_CAP, GLASS_CAP));
  ring.addPath(buildWallPath(layout, innerRadius, -GLASS_CAP, GLASS_CAP));
  return ring;
}

function paintGlassShell(ctx: CanvasRenderingContext2D, layout: HourglassLayout): void {
  const outer = buildWallPath(layout, outerRadius, -GLASS_CAP, GLASS_CAP);
  const inner = buildWallPath(layout, innerRadius, -GLASS_CAP, GLASS_CAP);
  const ring = glassRing(layout);

  const wall = ctx.createLinearGradient(
    layout.cx - layout.scale * 0.5,
    layout.cy - layout.scale,
    layout.cx + layout.scale * 0.5,
    layout.cy + layout.scale,
  );
  wall.addColorStop(0, "rgba(255,248,230,0.28)");
  wall.addColorStop(0.35, "rgba(220,200,160,0.1)");
  wall.addColorStop(0.7, "rgba(40,32,24,0.2)");
  wall.addColorStop(1, "rgba(255,236,200,0.08)");
  ctx.fillStyle = wall;
  ctx.fill(ring, "evenodd");

  ctx.save();
  ctx.strokeStyle = "rgba(210,180,120,0.2)";
  ctx.lineWidth = Math.max(3.4, layout.scale * 0.032);
  ctx.stroke(outer);
  ctx.strokeStyle = "rgba(236,214,168,0.62)";
  ctx.lineWidth = Math.max(1.35, layout.scale * 0.015);
  ctx.stroke(outer);
  ctx.strokeStyle = "rgba(255,236,200,0.22)";
  ctx.lineWidth = Math.max(0.9, layout.scale * 0.009);
  ctx.stroke(inner);
  ctx.restore();

  paintCollar(ctx, layout);
  paintSpecular(ctx, layout, -0.56, 0.2, 0.16);
  paintSpecular(ctx, layout, 0.58, 0.18, 0.14);

  ctx.save();
  ctx.strokeStyle = "rgba(255,252,245,0.42)";
  ctx.lineWidth = Math.max(1.3, layout.scale * 0.014);
  ctx.lineCap = "round";
  ctx.beginPath();
  const leftSteps = 28;
  for (let i = 0; i <= leftSteps; i += 1) {
    const y = lerp(-0.92, 0.92, i / leftSteps);
    const p = toPixel(layout, -outerRadius(y) * 0.92, y);
    if (i === 0) {
      ctx.moveTo(p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function paintCollar(ctx: CanvasRenderingContext2D, layout: HourglassLayout): void {
  const r = outerRadius(0) + 0.018;
  const left = toPixel(layout, -r, -0.028);
  const right = toPixel(layout, r, 0.028);
  const x = left.x;
  const y = left.y;
  const w = right.x - left.x;
  const h = Math.max(4, toPixel(layout, 0, 0.028).y - y);
  const band = ctx.createLinearGradient(x, y, x, y + h);
  band.addColorStop(0, BRASS_HI);
  band.addColorStop(0.4, BRASS_MID);
  band.addColorStop(1, BRASS_LO);
  ctx.fillStyle = band;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,236,190,0.35)";
  ctx.fillRect(x + 3, y + 1, w - 6, 1);
}

function paintSpecular(
  ctx: CanvasRenderingContext2D,
  layout: HourglassLayout,
  y: number,
  rx: number,
  ry: number,
): void {
  const p = toPixel(layout, -innerRadius(y) * 0.35, y - 0.04);
  const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, layout.scale * rx);
  g.addColorStop(0, "rgba(255,252,245,0.34)");
  g.addColorStop(0.35, "rgba(255,240,210,0.1)");
  g.addColorStop(1, "rgba(255,240,210,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, layout.scale * rx, layout.scale * ry, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function paintPillars(ctx: CanvasRenderingContext2D, layout: HourglassLayout, layer: "back" | "front"): void {
  const xs = layer === "back" ? ([-0.58, 0.58] as const) : ([-0.54, 0.54] as const);
  const alpha = layer === "back" ? 0.55 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const x of xs) {
    const top = toPixel(layout, x, -1.08);
    const bot = toPixel(layout, x, 1.08);
    const w = layout.scale * 0.034;
    const g = ctx.createLinearGradient(top.x - w, 0, top.x + w, 0);
    g.addColorStop(0, BRASS_LO);
    g.addColorStop(0.35, BRASS_HI);
    g.addColorStop(0.55, BRASS_MID);
    g.addColorStop(1, BRASS_LO);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(top.x - w / 2, top.y, w, bot.y - top.y, w / 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,236,190,0.28)";
    ctx.fillRect(top.x - w * 0.18, top.y + 4, w * 0.22, bot.y - top.y - 8);

    for (const y of [-0.72, 0.72]) {
      const ring = toPixel(layout, x, y);
      ctx.fillStyle = BRASS_LO;
      ctx.beginPath();
      ctx.ellipse(ring.x, ring.y, w * 0.72, w * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = BRASS_HI;
      ctx.beginPath();
      ctx.ellipse(ring.x, ring.y - 1, w * 0.55, w * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintCaps(ctx: CanvasRenderingContext2D, layout: HourglassLayout): void {
  paintCap(ctx, layout, -1.12, -1.0);
  paintCap(ctx, layout, 1.0, 1.12);
}

function paintCap(ctx: CanvasRenderingContext2D, layout: HourglassLayout, y0: number, y1: number): void {
  const left = toPixel(layout, -0.56, y0);
  const right = toPixel(layout, 0.56, y1);
  const x = left.x;
  const y = Math.min(left.y, toPixel(layout, 0, y0).y);
  const w = right.x - left.x;
  const h = Math.abs(toPixel(layout, 0, y1).y - toPixel(layout, 0, y0).y);
  const r = Math.min(h * 0.45, 6);

  const body = ctx.createLinearGradient(x, y, x, y + h);
  body.addColorStop(0, BRASS_HI);
  body.addColorStop(0.35, BRASS_MID);
  body.addColorStop(0.75, BRASS_LO);
  body.addColorStop(1, "#3a2410");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();

  const sheen = ctx.createLinearGradient(x, y, x + w, y);
  sheen.addColorStop(0, "rgba(0,0,0,0.25)");
  sheen.addColorStop(0.35, "rgba(255,236,190,0.45)");
  sheen.addColorStop(0.7, "rgba(160,110,40,0.1)");
  sheen.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();

  ctx.fillStyle = "rgba(255,244,210,0.35)";
  ctx.fillRect(x + 8, y + 1, w - 16, 1.2);
  ctx.fillStyle = "rgba(40,24,8,0.45)";
  ctx.fillRect(x + 10, y + h * 0.55, w - 20, 1);

  for (const side of [-0.56, 0.56]) {
    const p = toPixel(layout, side, (y0 + y1) / 2);
    const rad = h * 0.62;
    const knob = ctx.createRadialGradient(p.x - rad * 0.3, p.y - rad * 0.3, 1, p.x, p.y, rad);
    knob.addColorStop(0, BRASS_HI);
    knob.addColorStop(0.55, BRASS_MID);
    knob.addColorStop(1, BRASS_LO);
    ctx.fillStyle = knob;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintReflection(
  ctx: CanvasRenderingContext2D,
  layout: HourglassLayout,
  transfer: HourglassTransfer,
): void {
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.translate(layout.cx, layout.cy + layout.scale * 2.28);
  ctx.scale(1, -0.22);
  ctx.translate(-layout.cx, -layout.cy);
  const inner = buildWallPath(layout, innerRadius, -GLASS_CAP, GLASS_CAP);
  ctx.fillStyle = "rgba(240,200,120,0.35)";
  ctx.fill(inner);
  if (transfer.bottomFill > 0.2) {
    ctx.fillStyle = "rgba(210,160,70,0.5)";
    ctx.fill(bottomSandPath(layout, transfer));
  }
  ctx.restore();
}

function paintCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  props: FaceProps,
  transfer: HourglassTransfer,
): void {
  const kicker =
    props.phase === "idle" ? "AT REST" : props.phase === "break" ? "BREAK" : "SAND";
  const read =
    props.phase === "idle"
      ? "Unflipped"
      : transfer.progress >= 0.995
        ? "Transferred"
        : `${formatFacePercent(transfer.progress)} transferred`;
  const remain =
    props.phase === "idle" ? "" : formatFaceClock(props.remainingMs);

  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(232,214,170,0.42)";
  ctx.font = `600 ${Math.max(9, Math.round(width * 0.009))}px Geist, ui-sans-serif, sans-serif`;
  ctx.fillText(kicker, width - 16, height - 26);
  ctx.fillStyle = "rgba(238,242,248,0.78)";
  ctx.font = `500 ${Math.max(11, Math.round(width * 0.011))}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillText(remain ? `${read}  ·  ${remain}` : read, width - 16, height - 10);
  ctx.restore();
}

function clampAbs(value: number, limit: number): number {
  const cap = Math.max(0, limit);
  if (value > cap) {
    return cap;
  }
  if (value < -cap) {
    return -cap;
  }
  return value;
}
