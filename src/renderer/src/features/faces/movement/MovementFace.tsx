import { useMemo, useRef, type JSX } from "react";
import type { FaceProps } from "../types";
import { useFaceCanvas } from "../useFaceCanvas";
import { formatRemain } from "../derive";
import { gearAngles } from "./math";
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
      const elapsedSec = props.elapsedMs / 1000 + (props.freeze ? 0 : clockMs / 1000);
      paintMovement(ctx, w, h, props, elapsedSec, layout, sprites.current);
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

  drawPallet(ctx, escape.x + 6, escape.y - 50, angles.pallet);
  const balanceX = escape.x + 10;
  const balanceY = escape.y - 128;
  ctx.save();
  ctx.translate(balanceX, balanceY);
  drawBalance(ctx, angles.balance);
  ctx.restore();
  drawTrainBridge(ctx, third, fourth, escape);
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

function drawTrainBridge(
  ctx: CanvasRenderingContext2D,
  third: LaidGear,
  fourth: LaidGear,
  escape: LaidGear,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(third.x - 34, third.y - 18);
  ctx.quadraticCurveTo(third.x + 10, third.y - 48, fourth.x - 8, fourth.y - 28);
  ctx.quadraticCurveTo(escape.x - 10, escape.y - 8, escape.x + 22, escape.y - 6);
  ctx.quadraticCurveTo(escape.x + 36, escape.y + 18, fourth.x + 30, fourth.y + 22);
  ctx.quadraticCurveTo(third.x + 40, third.y + 36, third.x - 8, third.y + 28);
  ctx.closePath();
  const steel = ctx.createLinearGradient(third.x, third.y, escape.x, escape.y);
  steel.addColorStop(0, "#8b939e");
  steel.addColorStop(0.5, "#5c646e");
  steel.addColorStop(1, "#2e333a");
  ctx.fillStyle = steel;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.clip();
  ctx.translate((third.x + escape.x) / 2, (third.y + escape.y) / 2);
  drawCotes(ctx, 220, 160);
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();
}

function drawBalanceCock(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-22, 8);
  ctx.quadraticCurveTo(-48, -8, -18, -52);
  ctx.quadraticCurveTo(8, -78, 36, -42);
  ctx.quadraticCurveTo(48, -8, 20, 14);
  ctx.quadraticCurveTo(4, 20, -22, 8);
  ctx.closePath();
  const steel = ctx.createRadialGradient(-8, -20, 6, 0, 0, 70);
  steel.addColorStop(0, "#9aa3ae");
  steel.addColorStop(0.55, "#5c646e");
  steel.addColorStop(1, "#2a3038");
  ctx.fillStyle = steel;
  ctx.fill();
  ctx.save();
  ctx.clip();
  drawCotes(ctx, 140, 140);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.fillStyle = "#3a4048";
  ctx.fill();
  drawJewel(ctx, 7.2);
  ctx.restore();
}
