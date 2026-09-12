import type { FacePhase } from "@shared/faces";
import { formatFaceClock } from "../clock";
import {
  CANDLE_GEOM,
  buildCandlePose,
  fitCandleView,
  flameSway,
  resolveClockMs,
  type CandleDripPose,
  type CandlePose,
} from "./math";

export interface CandleDrawInput {
  progress: number;
  phase: FacePhase;
  remainingMs: number;
  killCount: number;
  clockMs: number;
  freeze: boolean;
}

function addWaxPath(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx, holderY } = CANDLE_GEOM;
  const top = pose.waxTop;
  const h = pose.waxHeight;
  const collar = pose.topHalfW + pose.collar;
  ctx.moveTo(cx + collar, top + 7);
  ctx.bezierCurveTo(
    cx + pose.topHalfW + 2,
    top + h * 0.2,
    cx + pose.midHalfW + 4,
    top + h * 0.5,
    cx + pose.baseHalfW,
    holderY - 5,
  );
  ctx.quadraticCurveTo(cx + pose.baseHalfW - 4, holderY + 3, cx, holderY + 4);
  ctx.quadraticCurveTo(cx - pose.baseHalfW + 4, holderY + 3, cx - pose.baseHalfW, holderY - 5);
  ctx.bezierCurveTo(
    cx - pose.midHalfW - 4,
    top + h * 0.5,
    cx - pose.topHalfW - 2,
    top + h * 0.2,
    cx - collar,
    top + 7,
  );
  ctx.quadraticCurveTo(cx - collar - 2, top - 1, cx, top - 2);
  ctx.quadraticCurveTo(cx + collar + 2, top - 1, cx + collar, top + 7);
  ctx.closePath();
}

function paintRoom(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pose: CandlePose,
  phase: FacePhase,
): void {
  const night = ctx.createLinearGradient(0, 0, 0, h);
  night.addColorStop(0, "#08070c");
  night.addColorStop(0.45, "#05060a");
  night.addColorStop(1, "#030208");
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, w, h);

  const warm =
    phase === "break"
      ? `rgba(255, 70, 70, ${0.1 + pose.flame.bright * 0.12})`
      : `rgba(255, 168, 64, ${0.16 + pose.flame.bright * 0.22})`;
  const spot = ctx.createRadialGradient(
    w * 0.5,
    h * 0.38,
    6,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.46,
  );
  spot.addColorStop(0, warm);
  spot.addColorStop(0.42, "rgba(40, 22, 8, 0.16)");
  spot.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);
}

function paintTable(ctx: CanvasRenderingContext2D): void {
  const { cx, shelfY } = CANDLE_GEOM;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.ellipse(cx, shelfY + 14, 128, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  const wood = ctx.createLinearGradient(cx - 150, shelfY, cx + 150, shelfY + 22);
  wood.addColorStop(0, "#120e0a");
  wood.addColorStop(0.45, "#221910");
  wood.addColorStop(1, "#0c0907");
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.ellipse(cx, shelfY + 6, 138, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(90, 64, 36, 0.35)";
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();
}

function paintHolder(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx, holderY, dishRx, dishRy } = CANDLE_GEOM;
  ctx.save();
  const metal = ctx.createLinearGradient(cx - dishRx, holderY - 8, cx + dishRx, holderY + 22);
  metal.addColorStop(0, "#3a322c");
  metal.addColorStop(0.4, "#1a1613");
  metal.addColorStop(1, "#0b0908");
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.ellipse(cx, holderY + 8, dishRx, dishRy + 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(210, 180, 130, 0.22)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.fillStyle = "#0e0c0a";
  ctx.beginPath();
  ctx.ellipse(cx, holderY + 4, dishRx - 10, dishRy - 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(240, 210, 150, 0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, holderY - 1, dishRx - 6, 6.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  const rim = ctx.createLinearGradient(cx - 80, holderY - 8, cx + 80, holderY);
  rim.addColorStop(0, "rgba(255, 220, 160, 0.08)");
  rim.addColorStop(0.45, "rgba(255, 230, 180, 0.4)");
  rim.addColorStop(1, "rgba(80, 50, 24, 0.2)");
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(cx, holderY - 2, 52 + pose.melt * 8, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintPool(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx, holderY } = CANDLE_GEOM;
  ctx.save();
  ctx.translate(cx, holderY + 3);
  ctx.fillStyle = "rgba(80, 50, 18, 0.45)";
  ctx.beginPath();
  ctx.ellipse(-6, 4, pose.poolRx * 1.02, pose.poolRy * 1.15, -0.08, 0, Math.PI * 2);
  ctx.fill();

  const solid = ctx.createRadialGradient(-10, -2, 4, 0, 2, pose.poolRx);
  solid.addColorStop(0, "#f3d48a");
  solid.addColorStop(0.45, "#d4a85a");
  solid.addColorStop(1, "#8a6230");
  ctx.fillStyle = solid;
  ctx.beginPath();
  ctx.ellipse(0, 0, pose.poolRx, pose.poolRy, 0.04, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 220, 140, 0.55)";
  ctx.beginPath();
  ctx.ellipse(-pose.poolRx * 0.22, -pose.poolRy * 0.15, pose.poolRx * 0.42, pose.poolRy * 0.38, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(90, 58, 22, 0.35)";
  ctx.beginPath();
  ctx.ellipse(pose.poolRx * 0.38, pose.poolRy * 0.1, pose.poolRx * 0.28, pose.poolRy * 0.32, 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 236, 190, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, -0.6, pose.poolRx * 0.86, pose.poolRy * 0.62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function paintWax(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx } = CANDLE_GEOM;
  ctx.save();
  ctx.beginPath();
  addWaxPath(ctx, pose);
  const body = ctx.createLinearGradient(cx - 50, pose.waxTop, cx + 50, pose.waxTop);
  body.addColorStop(0, "#f6e4b8");
  body.addColorStop(0.28, "#edd29a");
  body.addColorStop(0.62, "#c8964e");
  body.addColorStop(1, "#6e4a22");
  ctx.fillStyle = body;
  ctx.fill();

  ctx.clip();
  const vertical = ctx.createLinearGradient(cx, pose.waxTop, cx, CANDLE_GEOM.holderY);
  vertical.addColorStop(0, "rgba(255, 236, 190, 0.55)");
  vertical.addColorStop(0.18, "rgba(255, 200, 110, 0.22)");
  vertical.addColorStop(0.7, "rgba(0, 0, 0, 0)");
  vertical.addColorStop(1, "rgba(40, 22, 8, 0.28)");
  ctx.fillStyle = vertical;
  ctx.fillRect(cx - 80, pose.waxTop - 8, 160, pose.waxHeight + 16);

  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = "#8a6230";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const x = cx - 22 + i * 11;
    ctx.beginPath();
    ctx.moveTo(x, pose.waxTop + 10);
    ctx.bezierCurveTo(
      x + 2,
      pose.waxTop + pose.waxHeight * 0.35,
      x - 2,
      pose.waxTop + pose.waxHeight * 0.7,
      x + 1,
      CANDLE_GEOM.holderY - 6,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255, 248, 220, 0.22)";
  ctx.beginPath();
  ctx.ellipse(cx - 16, pose.waxTop + pose.waxHeight * 0.28, 10, pose.waxHeight * 0.22, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  addWaxPath(ctx, pose);
  ctx.strokeStyle = "rgba(255, 228, 170, 0.35)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function paintDrip(ctx: CanvasRenderingContext2D, drip: CandleDripPose): void {
  const { x, y0, length, width, side } = drip;
  const y1 = y0 + length;
  const bulge = x + side * (width * 0.55);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.bezierCurveTo(x + side * 1.2, y0 + length * 0.25, bulge, y0 + length * 0.55, x + side * 1.4, y1);
  ctx.bezierCurveTo(
    x + side * (width * 0.85),
    y1 + width * 0.55,
    x - side * width * 0.15,
    y1 + width * 0.5,
    x - side * 1.6,
    y1 - 2,
  );
  ctx.bezierCurveTo(x - side * 0.8, y0 + length * 0.45, x, y0 + 8, x, y0);
  ctx.closePath();
  const fill = ctx.createLinearGradient(x - width, y0, x + width, y1);
  fill.addColorStop(0, "#fff1c8");
  fill.addColorStop(0.45, "#e8c878");
  fill.addColorStop(1, "#9a6a30");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = "rgba(255, 248, 220, 0.55)";
  ctx.beginPath();
  ctx.ellipse(x + side * 1.4, y0 + length * 0.35, 1.4, length * 0.18, side * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f0d080";
  ctx.beginPath();
  ctx.ellipse(x + side * 0.4, y1 + width * 0.12, width * 0.42, width * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintMeniscus(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx } = CANDLE_GEOM;
  const y = pose.waxTop;
  const rx = pose.topHalfW + pose.collar * 0.55;
  ctx.save();
  const well = ctx.createRadialGradient(cx, y + 2, 2, cx, y + 4, rx);
  well.addColorStop(0, "#4a2e10");
  well.addColorStop(0.55, "#c89648");
  well.addColorStop(1, "#f3dca8");
  ctx.fillStyle = well;
  ctx.beginPath();
  ctx.ellipse(cx, y + 3, rx, pose.meniscusDepth, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 236, 190, 0.85)";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.ellipse(cx, y + 1, rx + 1, 6.4, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  ctx.strokeStyle = "rgba(80, 48, 16, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(cx, y + 4, rx - 3, 4.2, 0, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 214, 120, 0.35)";
  ctx.beginPath();
  ctx.ellipse(cx, y + 2, rx * 0.55, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintWick(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx } = CANDLE_GEOM;
  const y = pose.waxTop + 4;
  ctx.save();
  ctx.strokeStyle = "#1a120c";
  ctx.lineWidth = 2.3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, y + 2);
  ctx.quadraticCurveTo(cx + 1.6, y - pose.flame.wickH * 0.45, cx - 0.6, y - pose.flame.wickH);
  ctx.stroke();
  ctx.strokeStyle = "#5a3020";
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.fillStyle = "#c45a18";
  ctx.beginPath();
  ctx.arc(cx - 0.4, y - pose.flame.wickH + 1, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintFlame(
  ctx: CanvasRenderingContext2D,
  pose: CandlePose,
  clockMs: number,
  phase: FacePhase,
): void {
  const { cx } = CANDLE_GEOM;
  const tip = pose.waxTop - pose.flame.wickH + 2;
  const sway = flameSway(clockMs, pose.flame.sputter);
  const h = CANDLE_GEOM.flameH * pose.flame.scale;
  const w = CANDLE_GEOM.flameW * pose.flame.scale;
  const dim = pose.flame.bright;

  ctx.save();
  ctx.translate(cx + sway.x, tip);
  ctx.rotate(sway.lean);

  const halo = ctx.createRadialGradient(0, -h * 0.35, 2, 0, -h * 0.1, h * 1.6);
  const haloColor =
    phase === "break" ? `rgba(255, 90, 60, ${0.22 * dim})` : `rgba(255, 170, 50, ${0.32 * dim})`;
  halo.addColorStop(0, haloColor);
  halo.addColorStop(1, "rgba(255, 140, 20, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.2, w * 3.4, h * 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const envelope = ctx.createLinearGradient(0, 0, 0, -h);
  envelope.addColorStop(0, `rgba(255, 90, 20, ${0.55 * dim})`);
  envelope.addColorStop(0.4, `rgba(255, 140, 30, ${0.85 * dim})`);
  envelope.addColorStop(1, `rgba(255, 210, 80, ${0.15 * dim})`);
  ctx.fillStyle = envelope;
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.bezierCurveTo(-w * 0.35, -h * 0.72, -w, -h * 0.28, 0, 4);
  ctx.bezierCurveTo(w, -h * 0.28, w * 0.35, -h * 0.72, 0, -h);
  ctx.fill();

  const body = ctx.createLinearGradient(0, 2, 0, -h * 0.82);
  body.addColorStop(0, `rgba(255, 120, 20, ${0.7 * dim})`);
  body.addColorStop(0.45, `rgba(255, 196, 60, ${0.95 * dim})`);
  body.addColorStop(1, `rgba(255, 244, 180, ${0.35 * dim})`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.82);
  ctx.bezierCurveTo(-w * 0.22, -h * 0.58, -w * 0.62, -h * 0.22, 0, 2);
  ctx.bezierCurveTo(w * 0.62, -h * 0.22, w * 0.22, -h * 0.58, 0, -h * 0.82);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 252, 230, ${0.92 * dim})`;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.52);
  ctx.bezierCurveTo(-w * 0.12, -h * 0.36, -w * 0.22, -h * 0.14, 0, 0);
  ctx.bezierCurveTo(w * 0.22, -h * 0.14, w * 0.12, -h * 0.36, 0, -h * 0.52);
  ctx.fill();

  if (pose.flame.sputter < 0.35) {
    ctx.fillStyle = "rgba(140, 190, 255, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 1.5, 3.2, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintSmoke(ctx: CanvasRenderingContext2D, pose: CandlePose, clockMs: number): void {
  if (pose.flame.sputter <= 0) {
    return;
  }
  const { cx } = CANDLE_GEOM;
  const tip = pose.waxTop - pose.flame.wickH - CANDLE_GEOM.flameH * pose.flame.scale * 0.85;
  const sway = flameSway(clockMs, pose.flame.sputter);
  ctx.save();
  ctx.globalAlpha = 0.16 + pose.flame.sputter * 0.18;
  ctx.strokeStyle = "rgba(180, 160, 140, 0.7)";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx + sway.x, tip);
  ctx.bezierCurveTo(
    cx + sway.x + 6,
    tip - 18,
    cx + sway.x - 8,
    tip - 36,
    cx + sway.x + 4,
    tip - 58,
  );
  ctx.stroke();
  ctx.restore();
}

function paintGlow(
  ctx: CanvasRenderingContext2D,
  pose: CandlePose,
  clockMs: number,
): void {
  const { cx } = CANDLE_GEOM;
  const y = pose.waxTop - 8;
  const pulse = 0.86 + 0.14 * Math.sin(clockMs / 180);
  const r = 90 + pose.flame.bright * 40;
  const g = ctx.createRadialGradient(cx, y, 4, cx, y, r);
  g.addColorStop(0, `rgba(255, 190, 80, ${0.28 * pose.flame.bright * pulse})`);
  g.addColorStop(0.35, `rgba(255, 140, 40, ${0.12 * pose.flame.bright})`);
  g.addColorStop(1, "rgba(255, 100, 20, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function paintMeta(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pose: CandlePose,
  remainingMs: number,
  phase: FacePhase,
): void {
  const label = phase === "idle" ? "AT REST" : pose.flame.sputter > 0 ? "SPUTTER" : "BURNING";
  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(107, 118, 138, 0.95)";
  ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("CANDLE", w - 22, h - 42);
  ctx.fillStyle = "#eef2f8";
  ctx.font = "600 15px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `${Math.round(pose.remain * 100)}% wax · ${formatFaceClock(remainingMs)}`,
    w - 22,
    h - 24,
  );
  ctx.fillStyle = pose.flame.sputter > 0 ? "#ffb020" : phase === "focus" ? "#f0c56a" : "#6b768a";
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(label, w - 22, h - 10);
  ctx.restore();
}

export function drawCandleFace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: CandleDrawInput,
): void {
  if (width < 8 || height < 8) {
    return;
  }
  const pose = buildCandlePose(input.progress, input.phase, input.killCount);
  const clockMs = resolveClockMs(input.clockMs, input.freeze);
  const view = fitCandleView(width, height);

  ctx.clearRect(0, 0, width, height);
  paintRoom(ctx, width, height, pose, input.phase);

  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);

  paintTable(ctx);
  paintGlow(ctx, pose, clockMs);
  paintHolder(ctx, pose);
  paintPool(ctx, pose);
  paintWax(ctx, pose);
  for (const drip of pose.drips) {
    paintDrip(ctx, drip);
  }
  paintMeniscus(ctx, pose);
  paintWick(ctx, pose);
  paintFlame(ctx, pose, clockMs, input.phase);
  paintSmoke(ctx, pose, clockMs);

  ctx.restore();
  paintMeta(ctx, width, height, pose, input.remainingMs, input.phase);
}
