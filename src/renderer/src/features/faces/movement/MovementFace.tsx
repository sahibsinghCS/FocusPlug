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

  drawBridge(ctx, 248, 338, 268, 372, 0.15);
  drawBridge(ctx, 430, 430, 420, 250, -0.08);
  drawBridge(ctx, 690, 250, 250, 210, 0.22);

  const barrel = layout.barrel;
  if (barrel) {
    ctx.save();
    ctx.translate(barrel.x, barrel.y);
    ctx.beginPath();
    ctx.arc(0, 0, 132, 0, Math.PI * 2);
    const well = ctx.createRadialGradient(0, 0, 20, 0, 0, 132);
    well.addColorStop(0, "#1a1e24");
    well.addColorStop(1, "#0b0d11");
    ctx.fillStyle = well;
    ctx.fill();
    ctx.restore();
    blit(ctx, sprites.get("barrel"), barrel.x, barrel.y, barrel.spec, angles.barrel);
    ctx.save();
    ctx.translate(barrel.x, barrel.y);
    ctx.rotate(angles.barrel);
    drawMainspring(ctx, props.progress, 20, 108);
    ctx.restore();
    ctx.save();
    ctx.translate(barrel.x, barrel.y);
    drawPinion(ctx, 18, 12);
    drawJewel(ctx, 9.5);
    ctx.restore();
  }

  blitGear(ctx, sprites, layout.center, angles.center);
  blitGear(ctx, sprites, layout.third, angles.third);
  blitGear(ctx, sprites, layout.fourth, angles.fourth);
  blitGear(ctx, sprites, layout.escape, angles.escape);

  const escape = layout.escape;
  if (escape) {
    drawPallet(ctx, escape.x + 28, escape.y - 58, angles.pallet);
    ctx.save();
    ctx.translate(escape.x + 42, escape.y - 132);
    drawBalance(ctx, angles.balance);
    ctx.restore();
  }

  const screws: Array<[number, number, number]> = [
    [210, 250, 0.2],
    [790, 230, 1.1],
    [200, 760, 0.6],
    [820, 770, 2.1],
    [500, 188, 0.4],
    [640, 760, 1.7],
  ];
  for (const [x, y, rot] of screws) {
    ctx.save();
    ctx.translate(x, y);
    drawBluedScrew(ctx, 8.6, rot);
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
  laid: { spec: GearSpec; x: number; y: number } | undefined,
  angle: number,
): void {
  if (!laid) {
    return;
  }
  blit(ctx, sprites.get(laid.spec.id), laid.x, laid.y, laid.spec, angle);
  ctx.save();
  ctx.translate(laid.x, laid.y);
  drawPinion(ctx, Math.max(9, laid.spec.r * 0.16), 8);
  drawJewel(ctx, Math.max(6.2, laid.spec.r * 0.1));
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

function drawBridge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  roundRect(ctx, 0, 0, w, h, 28);
  const steel = ctx.createLinearGradient(0, 0, w, 0);
  steel.addColorStop(0, "#6a717c");
  steel.addColorStop(0.5, "#b4bcc8");
  steel.addColorStop(1, "#3e444c");
  ctx.fillStyle = steel;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, 4, 4, w - 8, h - 8, 24);
  ctx.clip();
  ctx.translate(w / 2, h / 2);
  drawCotes(ctx, w, h);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}
