import type { FacePhase } from "@shared/faces";
import { formatFaceClock } from "../clock";
import { isFaceThumb } from "../thumb";
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
  const top = pose.waxTop + 8;
  const h = pose.waxHeight - 8;
  ctx.moveTo(cx + pose.topHalfW, top);
  ctx.bezierCurveTo(
    cx + pose.topHalfW + 4,
    top + h * 0.2,
    cx + pose.midHalfW + 6,
    top + h * 0.5,
    cx + pose.baseHalfW,
    holderY - 6,
  );
  ctx.quadraticCurveTo(cx + pose.baseHalfW - 8, holderY + 6, cx, holderY + 7);
  ctx.quadraticCurveTo(cx - pose.baseHalfW + 8, holderY + 6, cx - pose.baseHalfW, holderY - 6);
  ctx.bezierCurveTo(
    cx - pose.midHalfW - 6,
    top + h * 0.5,
    cx - pose.topHalfW - 4,
    top + h * 0.2,
    cx - pose.topHalfW,
    top,
  );
  ctx.lineTo(cx + pose.topHalfW, top);
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
  night.addColorStop(0, "#09080e");
  night.addColorStop(0.5, "#05060a");
  night.addColorStop(1, "#020208");
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, w, h);

  const warm =
    phase === "break"
      ? `rgba(255, 72, 64, ${0.12 + pose.flame.bright * 0.14})`
      : `rgba(255, 164, 56, ${0.2 + pose.flame.bright * 0.28})`;
  const spot = ctx.createRadialGradient(
    w * 0.5,
    h * 0.36,
    10,
    w * 0.5,
    h * 0.48,
    Math.max(w, h) * 0.5,
  );
  spot.addColorStop(0, warm);
  spot.addColorStop(0.4, "rgba(48, 24, 8, 0.2)");
  spot.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);
}

function paintTable(ctx: CanvasRenderingContext2D): void {
  const { cx, shelfY } = CANDLE_GEOM;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.beginPath();
  ctx.ellipse(cx, shelfY + 16, 150, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  const wood = ctx.createLinearGradient(cx - 170, shelfY, cx + 170, shelfY + 24);
  wood.addColorStop(0, "#100c08");
  wood.addColorStop(0.45, "#261c12");
  wood.addColorStop(1, "#0c0906");
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.ellipse(cx, shelfY + 6, 156, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(110, 78, 40, 0.4)";
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.restore();
}

function paintHolder(ctx: CanvasRenderingContext2D): void {
  const { cx, holderY, dishRx, dishRy } = CANDLE_GEOM;
  ctx.save();
  const metal = ctx.createLinearGradient(cx - dishRx, holderY - 10, cx + dishRx, holderY + 28);
  metal.addColorStop(0, "#5a4a38");
  metal.addColorStop(0.35, "#2a2218");
  metal.addColorStop(1, "#0c0a08");
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.ellipse(cx, holderY + 12, dishRx, dishRy + 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#14100c";
  ctx.beginPath();
  ctx.ellipse(cx, holderY + 6, dishRx - 14, dishRy, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(232, 196, 130, 0.45)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, holderY - 2, dishRx - 8, 7.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(80, 56, 28, 0.7)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(cx, holderY + 1, dishRx - 18, 5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function paintPool(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx, holderY } = CANDLE_GEOM;
  ctx.save();
  ctx.translate(cx, holderY + 5);

  ctx.fillStyle = "rgba(40, 24, 8, 0.5)";
  ctx.beginPath();
  ctx.ellipse(4, 7, pose.poolRx * 1.06, pose.poolRy * 1.2, 0.08, 0, Math.PI * 2);
  ctx.fill();

  const solid = ctx.createRadialGradient(-14, -4, 6, 2, 4, pose.poolRx);
  solid.addColorStop(0, "#ffe7a8");
  solid.addColorStop(0.35, "#e0b45a");
  solid.addColorStop(0.75, "#a06a28");
  solid.addColorStop(1, "#5a3814");
  ctx.fillStyle = solid;
  ctx.beginPath();
  ctx.ellipse(0, 0, pose.poolRx, pose.poolRy, 0.05, 0, Math.PI * 2);
  ctx.ellipse(-pose.poolRx * 0.42, 2, pose.poolRx * 0.46, pose.poolRy * 0.72, -0.35, 0, Math.PI * 2);
  ctx.ellipse(pose.poolRx * 0.4, 3, pose.poolRx * 0.4, pose.poolRy * 0.62, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 236, 170, 0.7)";
  ctx.beginPath();
  ctx.ellipse(-pose.poolRx * 0.18, -pose.poolRy * 0.22, pose.poolRx * 0.38, pose.poolRy * 0.32, -0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 220, 150, 0.45)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, -1, pose.poolRx * 0.78, pose.poolRy * 0.48, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(90, 54, 18, 0.28)";
  ctx.beginPath();
  ctx.ellipse(pose.poolRx * 0.22, pose.poolRy * 0.18, pose.poolRx * 0.34, pose.poolRy * 0.22, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintWax(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx } = CANDLE_GEOM;
  ctx.save();
  ctx.translate(3, 4);
  ctx.beginPath();
  addWaxPath(ctx, pose);
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  addWaxPath(ctx, pose);
  const body = ctx.createLinearGradient(cx - pose.baseHalfW, pose.waxTop, cx + pose.baseHalfW, pose.waxTop);
  body.addColorStop(0, "#fff6d4");
  body.addColorStop(0.18, "#f2d28a");
  body.addColorStop(0.48, "#c88838");
  body.addColorStop(0.78, "#6a4014");
  body.addColorStop(1, "#2a1608");
  ctx.fillStyle = body;
  ctx.fill();
  ctx.clip();

  ctx.fillStyle = "rgba(255, 236, 180, 0.22)";
  ctx.fillRect(cx - pose.baseHalfW, pose.waxTop, pose.baseHalfW * 0.55, pose.waxHeight);
  ctx.fillStyle = "rgba(20, 8, 0, 0.28)";
  ctx.fillRect(cx + pose.baseHalfW * 0.2, pose.waxTop, pose.baseHalfW * 0.85, pose.waxHeight);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#7a4818";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i += 1) {
    const x = cx - 26 + i * 13;
    ctx.beginPath();
    ctx.moveTo(x, pose.waxTop + 16);
    ctx.bezierCurveTo(
      x + 3,
      pose.waxTop + pose.waxHeight * 0.34,
      x - 3,
      pose.waxTop + pose.waxHeight * 0.68,
      x + 1,
      CANDLE_GEOM.holderY - 8,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function paintCollar(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx } = CANDLE_GEOM;
  const y = pose.waxTop + 6;
  const rx = pose.topHalfW + pose.collar;
  const inner = Math.max(12, pose.topHalfW * 0.72);
  ctx.save();
  const lip = ctx.createLinearGradient(cx - rx, y, cx + rx, y);
  lip.addColorStop(0, "#fff4c8");
  lip.addColorStop(0.35, "#e8c060");
  lip.addColorStop(0.7, "#a86a24");
  lip.addColorStop(1, "#5a3010");
  ctx.fillStyle = lip;
  ctx.beginPath();
  ctx.moveTo(cx - rx, y);
  ctx.bezierCurveTo(cx - rx - 8, y - 10, cx - 20, y - 16, cx, y - 14);
  ctx.bezierCurveTo(cx + 20, y - 16, cx + rx + 8, y - 10, cx + rx, y);
  ctx.bezierCurveTo(cx + rx + 5, y + 10, cx + 12, y + 14, cx, y + 13);
  ctx.bezierCurveTo(cx - 12, y + 14, cx - rx - 5, y + 10, cx - rx, y);
  ctx.closePath();
  ctx.ellipse(cx, y + 4, inner, 7, 0, 0, Math.PI * 2);
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(255, 230, 170, 0.6)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx - rx, y);
  ctx.bezierCurveTo(cx - rx - 8, y - 10, cx - 20, y - 16, cx, y - 14);
  ctx.bezierCurveTo(cx + 20, y - 16, cx + rx + 8, y - 10, cx + rx, y);
  ctx.stroke();
  ctx.restore();
}

function paintDrip(ctx: CanvasRenderingContext2D, drip: CandleDripPose): void {
  const { x, y0, length, width, side } = drip;
  const y1 = y0 + length;
  const out = x + side * (width * 0.95);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - side * 5, y0 - 3);
  ctx.bezierCurveTo(x + side * 6, y0 + length * 0.18, out, y0 + length * 0.48, x + side * 5, y1);
  ctx.bezierCurveTo(
    x + side * width * 1.15,
    y1 + width * 0.8,
    x - side * width * 0.2,
    y1 + width * 0.78,
    x - side * 7,
    y1 - 2,
  );
  ctx.bezierCurveTo(x - side * 5, y0 + length * 0.4, x - side * 3, y0 + 8, x - side * 5, y0 - 3);
  ctx.closePath();
  const fill = ctx.createLinearGradient(x - width, y0, x + width, y1 + width);
  fill.addColorStop(0, "#fff6d2");
  fill.addColorStop(0.4, "#e8c060");
  fill.addColorStop(1, "#8a5418");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "rgba(70, 40, 12, 0.45)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 248, 220, 0.7)";
  ctx.beginPath();
  ctx.ellipse(x + side * 3, y0 + length * 0.32, 2.2, length * 0.16, side * 0.25, 0, Math.PI * 2);
  ctx.fill();

  const bulb = ctx.createRadialGradient(x + side * 2, y1 + 2, 1, x, y1 + 4, width * 0.7);
  bulb.addColorStop(0, "#fff1c0");
  bulb.addColorStop(0.55, "#d4a040");
  bulb.addColorStop(1, "#6a3c10");
  ctx.fillStyle = bulb;
  ctx.beginPath();
  ctx.ellipse(x + side * 1, y1 + width * 0.18, width * 0.48, width * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintMeniscus(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx } = CANDLE_GEOM;
  const y = pose.waxTop + 2;
  const rx = pose.topHalfW + pose.collar * 0.55;
  ctx.save();

  const well = ctx.createRadialGradient(cx - 3, y + 4, 2, cx, y + 12, rx);
  well.addColorStop(0, "#0c0602");
  well.addColorStop(0.28, "#3a1c08");
  well.addColorStop(0.62, "#8a5018");
  well.addColorStop(1, "#e8c070");
  ctx.fillStyle = well;
  ctx.beginPath();
  ctx.ellipse(cx, y + 10, rx - 2, pose.meniscusDepth, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#fff3c4";
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  ctx.ellipse(cx, y + 2, rx + 2, 8.5, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  ctx.strokeStyle = "rgba(20, 8, 0, 0.65)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(cx, y + 12, rx - 8, 7, 0, 0.1, Math.PI - 0.1);
  ctx.stroke();
  ctx.restore();
}

function paintWick(ctx: CanvasRenderingContext2D, pose: CandlePose): void {
  const { cx } = CANDLE_GEOM;
  const y = pose.waxTop + 6;
  ctx.save();
  ctx.strokeStyle = "#140c08";
  ctx.lineWidth = 3.1;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, y + 2);
  ctx.quadraticCurveTo(cx + 2.4, y - pose.flame.wickH * 0.4, cx - 0.8, y - pose.flame.wickH);
  ctx.stroke();
  ctx.strokeStyle = "#6a3820";
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.fillStyle = "#e06018";
  ctx.beginPath();
  ctx.arc(cx - 0.6, y - pose.flame.wickH + 1, 2.1, 0, Math.PI * 2);
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
  const tip = pose.waxTop - pose.flame.wickH + 3;
  const sway = flameSway(clockMs, pose.flame.sputter);
  const h = CANDLE_GEOM.flameH * pose.flame.scale;
  const w = CANDLE_GEOM.flameW * pose.flame.scale;
  const dim = pose.flame.bright;

  ctx.save();
  ctx.translate(cx + sway.x, tip);
  ctx.rotate(sway.lean);

  const halo = ctx.createRadialGradient(0, -h * 0.3, 4, 0, -h * 0.05, h * 1.85);
  const haloColor =
    phase === "break" ? `rgba(255, 86, 50, ${0.28 * dim})` : `rgba(255, 168, 48, ${0.4 * dim})`;
  halo.addColorStop(0, haloColor);
  halo.addColorStop(1, "rgba(255, 120, 16, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.15, w * 3.6, h * 1.55, 0, 0, Math.PI * 2);
  ctx.fill();

  const envelope = ctx.createLinearGradient(0, 6, 0, -h);
  envelope.addColorStop(0, `rgba(255, 80, 10, ${0.65 * dim})`);
  envelope.addColorStop(0.35, `rgba(255, 140, 24, ${0.92 * dim})`);
  envelope.addColorStop(1, `rgba(255, 214, 90, ${0.2 * dim})`);
  ctx.fillStyle = envelope;
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.bezierCurveTo(-w * 0.4, -h * 0.7, -w * 1.05, -h * 0.26, 0, 8);
  ctx.bezierCurveTo(w * 1.05, -h * 0.26, w * 0.4, -h * 0.7, 0, -h);
  ctx.fill();

  const body = ctx.createLinearGradient(0, 4, 0, -h * 0.84);
  body.addColorStop(0, `rgba(255, 110, 16, ${0.8 * dim})`);
  body.addColorStop(0.42, `rgba(255, 200, 56, ${0.98 * dim})`);
  body.addColorStop(1, `rgba(255, 248, 190, ${0.4 * dim})`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.84);
  ctx.bezierCurveTo(-w * 0.24, -h * 0.58, -w * 0.68, -h * 0.2, 0, 4);
  ctx.bezierCurveTo(w * 0.68, -h * 0.2, w * 0.24, -h * 0.58, 0, -h * 0.84);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 253, 236, ${0.95 * dim})`;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.5);
  ctx.bezierCurveTo(-w * 0.14, -h * 0.34, -w * 0.26, -h * 0.12, 0, 1);
  ctx.bezierCurveTo(w * 0.26, -h * 0.12, w * 0.14, -h * 0.34, 0, -h * 0.5);
  ctx.fill();

  if (pose.flame.sputter < 0.35) {
    ctx.fillStyle = "rgba(150, 200, 255, 0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 3, 4.2, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintSmoke(ctx: CanvasRenderingContext2D, pose: CandlePose, clockMs: number): void {
  if (pose.flame.sputter <= 0) {
    return;
  }
  const { cx } = CANDLE_GEOM;
  const tip = pose.waxTop - pose.flame.wickH - CANDLE_GEOM.flameH * pose.flame.scale * 0.82;
  const sway = flameSway(clockMs, pose.flame.sputter);
  ctx.save();
  ctx.globalAlpha = 0.2 + pose.flame.sputter * 0.22;
  ctx.strokeStyle = "rgba(190, 168, 148, 0.85)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx + sway.x, tip);
  ctx.bezierCurveTo(cx + sway.x + 8, tip - 22, cx + sway.x - 10, tip - 44, cx + sway.x + 5, tip - 72);
  ctx.stroke();
  ctx.restore();
}

function paintGlow(ctx: CanvasRenderingContext2D, pose: CandlePose, clockMs: number): void {
  const { cx } = CANDLE_GEOM;
  const y = pose.waxTop - 12;
  const pulse = 0.84 + 0.16 * Math.sin(clockMs / 180);
  const r = 120 + pose.flame.bright * 50;
  const g = ctx.createRadialGradient(cx, y, 6, cx, y, r);
  g.addColorStop(0, `rgba(255, 186, 72, ${0.34 * pose.flame.bright * pulse})`);
  g.addColorStop(0.32, `rgba(255, 132, 32, ${0.16 * pose.flame.bright})`);
  g.addColorStop(1, "rgba(255, 90, 16, 0)");
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
  paintHolder(ctx);
  paintPool(ctx, pose);
  paintWax(ctx, pose);
  for (const drip of pose.drips) {
    paintDrip(ctx, drip);
  }
  paintCollar(ctx, pose);
  paintMeniscus(ctx, pose);
  paintWick(ctx, pose);
  paintFlame(ctx, pose, clockMs, input.phase);
  paintSmoke(ctx, pose, clockMs);

  ctx.restore();
  if (!isFaceThumb(height)) {
    paintMeta(ctx, width, height, pose, input.remainingMs, input.phase);
  }
}
