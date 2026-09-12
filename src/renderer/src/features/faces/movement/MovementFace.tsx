import { useMemo, useRef, type JSX } from "react";
import type { FaceProps } from "../instrument";
import { useFaceCanvas } from "../useFaceCanvas";
import { formatRemain } from "../derive";
import { gearAngles, movementClock, type MovementClockBase } from "./math";
import {
  drawBalance,
  drawBluedScrew,
  drawCotes,
  drawJewel,
  drawMainspring,
  drawPallet,
  drawPerlage,
  drawPinion,
  layoutGears,
  makeGearSprite,
  type GearSpec,
  type LaidGear,
} from "./draw";

export function MovementFace(props: FaceProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sprites = useRef<Map<string, HTMLCanvasElement> | null>(null);
  const timeBase = useRef<MovementClockBase | null>(null);
  const layout = useMemo(() => layoutGears(), []);

  useFaceCanvas(
    canvasRef,
    (ctx, w, h, clockMs) => {
      if (!sprites.current) {
        sprites.current = new Map();
        for (const spec of Object.values(layout).map((item) => item.spec)) {
          sprites.current.set(spec.id, makeGearSprite(spec));
        }
      }
      const clock = movementClock(props.elapsedMs, props.freeze ? 0 : clockMs, timeBase.current);
      timeBase.current = clock.base;
      paintMovement(ctx, w, h, props, clock.elapsedSec, layout, sprites.current);
    },
    [props.elapsedMs, props.progress, props.phase, props.remainingMs, props.sessionId, props.freeze],
    { freeze: props.freeze, paused: props.paused },
  );

  return (
    <div className="fp-face fp-face-movement">
      <canvas ref={canvasRef} aria-label="Exposed watch movement" />
    </div>
  );
}

function paintMovement(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  props: FaceProps,
  elapsedSec: number,
  layout: ReturnType<typeof layoutGears>,
  sprites: Map<string, HTMLCanvasElement>,
): void {
  ctx.clearRect(0, 0, w, h);
  const scale = Math.min(w, h) / 1000;
  ctx.save();
  ctx.translate(w / 2, h / 2 + 8);
  ctx.scale(scale, scale);
  ctx.translate(-500, -510);

  const angles = gearAngles(elapsedSec);
  const barrel = layout.barrel;
  const center = layout.center;
  const third = layout.third;
  const fourth = layout.fourth;
  const escape = layout.escape;
  if (!barrel || !center || !third || !fourth || !escape) {
    ctx.restore();
    return;
  }

  ctx.fillStyle = "#0c0e13";
  ctx.fillRect(-80, -80, 1160, 1160);
  const chamber = ctx.createRadialGradient(500, 520, 80, 500, 520, 520);
  chamber.addColorStop(0, "#2a3038");
  chamber.addColorStop(0.55, "#161a20");
  chamber.addColorStop(1, "#07080c");
  ctx.beginPath();
  ctx.arc(500, 518, 448, 0, Math.PI * 2);
  ctx.fillStyle = chamber;
  ctx.fill();

  ctx.save();
  ctx.translate(500, 518);
  ctx.beginPath();
  ctx.arc(0, 0, 436, 0, Math.PI * 2);
  const plate = ctx.createRadialGradient(-120, -140, 40, 0, 0, 436);
  plate.addColorStop(0, "#5c636c");
  plate.addColorStop(0.5, "#3d434b");
  plate.addColorStop(1, "#22262c");
  ctx.fillStyle = plate;
  ctx.fill();
  drawPerlage(ctx, 430);
  ctx.restore();

  ctx.save();
  ctx.translate(barrel.x, barrel.y);
  ctx.beginPath();
  ctx.arc(0, 0, 128, 0, Math.PI * 2);
  const well = ctx.createRadialGradient(0, 0, 16, 0, 0, 128);
  well.addColorStop(0, "#1a1e24");
  well.addColorStop(1, "#0b0d11");
  ctx.fillStyle = well;
  ctx.fill();
  ctx.restore();
  blit(ctx, sprites.get("barrel"), barrel.x, barrel.y, barrel.spec, angles.barrel);
  ctx.save();
  ctx.translate(barrel.x, barrel.y);
  ctx.rotate(angles.barrel);
  drawMainspring(ctx, props.progress, 18, 100);
  ctx.restore();
  ctx.save();
  ctx.translate(barrel.x, barrel.y);
  drawPinion(ctx, 17, 12);
  drawJewel(ctx, 9);
  ctx.restore();

  blitGear(ctx, sprites, center, angles.center);
  blitGear(ctx, sprites, third, angles.third);
  blitGear(ctx, sprites, fourth, angles.fourth);
  blitGear(ctx, sprites, escape, angles.escape);

  drawPallet(ctx, escape.x + 4, escape.y - 46, angles.pallet);
  const balanceX = escape.x + 4;
  const balanceY = escape.y - 118;
  ctx.save();
  ctx.translate(balanceX, balanceY);
  drawBalance(ctx, angles.balance);
  ctx.restore();
  drawJewelCocks(ctx, [center, third, fourth, escape]);
  drawBarrelBridge(ctx, barrel);
  drawBalanceCock(ctx, balanceX, balanceY);

  const screws: Array<[number, number, number]> = [
    [214, 248, 0.2],
    [786, 236, 1.1],
    [208, 768, 0.6],
    [812, 764, 2.1],
    [500, 188, 0.4],
    [640, 790, 1.7],
    [third.x - 28, third.y - 36, 0.8],
    [fourth.x + 26, fourth.y + 30, 1.4],
    [balanceX + 40, balanceY - 34, 0.3],
  ];
  for (const [x, y, rot] of screws) {
    ctx.save();
    ctx.translate(x, y);
    drawBluedScrew(ctx, 8.2, rot);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(500, 888);
  ctx.fillStyle = "rgba(238,242,248,0.42)";
  ctx.font = "500 18px Geist, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("EXPOSED MOVEMENT  ·  4 Hz", 0, 0);
  ctx.font = "500 14px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(238,242,248,0.32)";
  ctx.fillText(`${formatRemain(props.remainingMs)} remain  ·  ${props.sessionId}`, 0, 22);
  ctx.restore();

  ctx.restore();
}

function blitGear(
  ctx: CanvasRenderingContext2D,
  sprites: Map<string, HTMLCanvasElement>,
  laid: LaidGear,
  angle: number,
): void {
  blit(ctx, sprites.get(laid.spec.id), laid.x, laid.y, laid.spec, angle);
  ctx.save();
  ctx.translate(laid.x, laid.y);
  drawPinion(ctx, Math.max(8, laid.spec.r * 0.15), 8);
  drawJewel(ctx, Math.max(5.8, laid.spec.r * 0.1));
  ctx.restore();
}

function blit(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement | undefined,
  x: number,
  y: number,
  spec: GearSpec,
  angle: number,
): void {
  if (!sprite) {
    return;
  }
  const pad = 10;
  const r = spec.r + pad;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(sprite, -r, -r, r * 2, r * 2);
  ctx.restore();
}

function drawJewelCocks(ctx: CanvasRenderingContext2D, gears: readonly LaidGear[]): void {
  for (const gear of gears) {
    ctx.save();
    ctx.translate(gear.x, gear.y);
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    const steel = ctx.createRadialGradient(-6, -6, 2, 0, 0, 18);
    steel.addColorStop(0, "#c5ccd4");
    steel.addColorStop(0.55, "#6a727c");
    steel.addColorStop(1, "#2e333a");
    ctx.fillStyle = steel;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.clip();
    drawCotes(ctx, 36, 36);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
    drawJewel(ctx, 6.6);
    ctx.restore();
  }
}

function drawBarrelBridge(ctx: CanvasRenderingContext2D, barrel: LaidGear): void {
  ctx.save();
  ctx.translate(barrel.x, barrel.y);
  ctx.beginPath();
  ctx.arc(0, 0, 156, -2.4, -0.6, false);
  ctx.arc(0, 0, 128, -0.6, -2.4, true);
  ctx.closePath();
  const steel = ctx.createLinearGradient(-140, -80, 40, 40);
  steel.addColorStop(0, "#9aa3ae");
  steel.addColorStop(1, "#3a4048");
  ctx.fillStyle = steel;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawBalanceCock(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-16, 10);
  ctx.quadraticCurveTo(-62, -6, -36, -78);
  ctx.quadraticCurveTo(-8, -118, 28, -96);
  ctx.quadraticCurveTo(62, -70, 40, -18);
  ctx.quadraticCurveTo(22, 16, -16, 10);
  ctx.closePath();
  const steel = ctx.createLinearGradient(-40, -110, 40, 20);
  steel.addColorStop(0, "#c5ccd4");
  steel.addColorStop(0.45, "#7a828c");
  steel.addColorStop(1, "#2e333a");
  ctx.fillStyle = steel;
  ctx.fill();
  ctx.save();
  ctx.clip();
  drawCotes(ctx, 180, 220);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.fillStyle = "#2a3038";
  ctx.fill();
  drawJewel(ctx, 7.4);
  ctx.restore();
}
