import { lerp } from "../canvas";
import { springTurns, TRAIN } from "./math";

export interface GearSpec {
  id: string;
  teeth: number;
  r: number;
  spokes: number;
  brass: boolean;
  club?: boolean;
  /** Punch a hole so a mainspring (or jewel) stays visible. */
  open?: number;
}

export const PITCH_FACTOR = 0.905;

export const GEARS: readonly GearSpec[] = [
  { id: "barrel", teeth: TRAIN.barrelTeeth, r: 142, spokes: 0, brass: true, open: 0.74 },
  { id: "center", teeth: TRAIN.centerTeeth, r: 80, spokes: 5, brass: true },
  { id: "third", teeth: TRAIN.thirdTeeth, r: 62, spokes: 4, brass: true },
  { id: "fourth", teeth: TRAIN.fourthTeeth, r: 48, spokes: 4, brass: true },
  { id: "escape", teeth: TRAIN.escapeTeeth, r: 38, spokes: 3, brass: false, club: true },
];

export interface LaidGear {
  spec: GearSpec;
  x: number;
  y: number;
}

export function meshDistance(a: GearSpec, b: GearSpec): number {
  return (a.r + b.r) * PITCH_FACTOR;
}

/** Pitch-aware layout so neighbouring wheels actually mesh. */
export function layoutGears(): Record<string, LaidGear> {
  const barrel = { spec: GEARS[0]!, x: 400, y: 555 };
  const center = place(barrel, GEARS[1]!, -0.18);
  const third = place(center, GEARS[2]!, -1.46);
  const fourth = place(third, GEARS[3]!, 0.7);
  const escape = place(fourth, GEARS[4]!, -1.5);
  return {
    barrel,
    center,
    third,
    fourth,
    escape,
  };
}

function place(from: LaidGear, spec: GearSpec, angle: number): LaidGear {
  const dist = meshDistance(from.spec, spec);
  return {
    spec,
    x: from.x + Math.cos(angle) * dist,
    y: from.y + Math.sin(angle) * dist,
  };
}

export function makeGearSprite(spec: GearSpec, dpr = 2): HTMLCanvasElement {
  const pad = 10;
  const size = Math.ceil((spec.r + pad) * 2 * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("gear sprite context missing");
  }
  ctx.scale(dpr, dpr);
  ctx.translate(spec.r + pad, spec.r + pad);
  drawGearBody(ctx, spec);
  return canvas;
}

function metalFill(ctx: CanvasRenderingContext2D, r: number, brass: boolean): CanvasGradient {
  const g = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.08, 0, 0, r);
  if (brass) {
    g.addColorStop(0, "#f3d68a");
    g.addColorStop(0.38, "#c89632");
    g.addColorStop(0.78, "#8a5e16");
    g.addColorStop(1, "#4a320c");
  } else {
    g.addColorStop(0, "#e8edf4");
    g.addColorStop(0.42, "#9aa3ae");
    g.addColorStop(1, "#3a4048");
  }
  return g;
}

function drawGearBody(ctx: CanvasRenderingContext2D, spec: GearSpec): void {
  const rOuter = spec.r;
  const rRoot = spec.club ? rOuter * 0.72 : rOuter * 0.84;
  const rRim = spec.club ? rOuter * 0.6 : rOuter * 0.68;
  const rHub = Math.max(10, rOuter * 0.17);

  ctx.save();
  toothPath(ctx, spec.teeth, rOuter, rRoot, spec.club === true);
  ctx.fillStyle = metalFill(ctx, rOuter, spec.brass);
  ctx.fill();
  ctx.strokeStyle = spec.brass ? "rgba(70,44,8,0.5)" : "rgba(16,20,26,0.55)";
  ctx.lineWidth = 0.85;
  ctx.stroke();

  if (spec.spokes > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < spec.spokes; i += 1) {
      const a0 = (i / spec.spokes) * Math.PI * 2 + 0.22;
      const a1 = ((i + 1) / spec.spokes) * Math.PI * 2 - 0.22;
      ctx.beginPath();
      ctx.arc(0, 0, rRim - 1.2, a0, a1);
      ctx.arc(0, 0, rHub + 3.2, a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, rRim - 0.4, 0, Math.PI * 2);
    ctx.strokeStyle = spec.brass ? "rgba(255,220,140,0.28)" : "rgba(230,236,244,0.22)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  if (spec.open && spec.open > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(0, 0, spec.r * spec.open, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, spec.r * spec.open + 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,220,140,0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (!spec.open) {
    const hub = ctx.createRadialGradient(-3, -3, 1, 0, 0, rHub);
    hub.addColorStop(0, "#dfe5ee");
    hub.addColorStop(1, "#5a616c");
    ctx.fillStyle = hub;
    ctx.beginPath();
    ctx.arc(0, 0, rHub, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function toothPath(
  ctx: CanvasRenderingContext2D,
  teeth: number,
  rOuter: number,
  rRoot: number,
  club: boolean,
): void {
  ctx.beginPath();
  for (let i = 0; i < teeth; i += 1) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 1) / teeth) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const span = a1 - a0;
    if (club) {
      const base0 = a0 + span * 0.22;
      const base1 = a1 - span * 0.22;
      const tip = mid;
      const clubR = rOuter * 1.02;
      if (i === 0) {
        ctx.moveTo(Math.cos(a0) * rRoot, Math.sin(a0) * rRoot);
      } else {
        ctx.lineTo(Math.cos(a0) * rRoot, Math.sin(a0) * rRoot);
      }
      ctx.lineTo(Math.cos(base0) * (rOuter * 0.9), Math.sin(base0) * (rOuter * 0.9));
      ctx.quadraticCurveTo(
        Math.cos(tip) * clubR,
        Math.sin(tip) * clubR,
        Math.cos(base1) * (rOuter * 0.9),
        Math.sin(base1) * (rOuter * 0.9),
      );
      ctx.lineTo(Math.cos(a1) * rRoot, Math.sin(a1) * rRoot);
    } else {
      const tip0 = a0 + span * 0.18;
      const tip1 = a1 - span * 0.18;
      if (i === 0) {
        ctx.moveTo(Math.cos(a0) * rRoot, Math.sin(a0) * rRoot);
      } else {
        ctx.lineTo(Math.cos(a0) * rRoot, Math.sin(a0) * rRoot);
      }
      ctx.lineTo(Math.cos(tip0) * rOuter, Math.sin(tip0) * rOuter);
      ctx.arc(0, 0, rOuter, tip0, tip1);
      ctx.lineTo(Math.cos(a1) * rRoot, Math.sin(a1) * rRoot);
    }
  }
  ctx.closePath();
}

export function drawJewel(ctx: CanvasRenderingContext2D, r: number): void {
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.08, 0, 0, r);
  g.addColorStop(0, "#ffe4ea");
  g.addColorStop(0.22, "#e23a58");
  g.addColorStop(0.65, "#6e1026");
  g.addColorStop(1, "#24040c");
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#d4b15a";
  ctx.lineWidth = r * 0.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-r * 0.28, -r * 0.32, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();
}

export function drawBluedScrew(ctx: CanvasRenderingContext2D, r: number, rot = 0): void {
  ctx.save();
  ctx.rotate(rot);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.28, r * 0.08, 0, 0, r);
  g.addColorStop(0, "#9ec4ff");
  g.addColorStop(0.32, "#1b4c9e");
  g.addColorStop(1, "#061018");
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(180,210,255,0.25)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.58, 0);
  ctx.lineTo(r * 0.58, 0);
  ctx.lineWidth = r * 0.2;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

export function drawPerlage(ctx: CanvasRenderingContext2D, r: number): void {
  const step = 15;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 0.85;
  for (let y = -r; y < r; y += step * 0.74) {
    const odd = Math.abs(Math.round(y / step)) % 2;
    for (let x = -r; x < r; x += step) {
      const px = x + (odd ? step / 2 : 0);
      if (px * px + y * y > (r - 3) * (r - 3)) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(px, y, step * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawCotes(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const band = 10;
  ctx.save();
  for (let y = -h / 2, i = 0; y < h / 2; y += band, i += 1) {
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    const shift = (i % 2) * 0.12;
    g.addColorStop(0, "rgba(0,0,0,0.12)");
    g.addColorStop(0.35 + shift, "rgba(255,255,255,0.16)");
    g.addColorStop(1, "rgba(0,0,0,0.1)");
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, y, w, band - 1.1);
  }
  ctx.restore();
}

export function drawMainspring(
  ctx: CanvasRenderingContext2D,
  progress: number,
  rInner: number,
  rOuter: number,
): void {
  const turns = springTurns(progress);
  const steps = Math.max(80, Math.floor(turns * 42));
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const theta = t * turns * Math.PI * 2;
    const r = rInner + (rOuter - rInner) * t;
    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "#8d96a4";
  ctx.lineWidth = 4.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.strokeStyle = "rgba(230,236,244,0.35)";
  ctx.lineWidth = 1.15;
  ctx.stroke();
}

export function drawHairspring(ctx: CanvasRenderingContext2D, angle: number): void {
  ctx.save();
  ctx.rotate(angle * 0.15);
  ctx.beginPath();
  const turns = 7.2;
  const steps = 220;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const theta = t * turns * Math.PI * 2;
    const r = lerp(3.2, 26, t);
    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "#c5ccd6";
  ctx.lineWidth = 0.85;
  ctx.stroke();
  ctx.restore();
}

export function drawBalance(ctx: CanvasRenderingContext2D, angle: number): void {
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, 68, 0, Math.PI * 2);
  ctx.arc(0, 0, 56, 0, Math.PI * 2, true);
  const rim = ctx.createLinearGradient(-68, 0, 68, 0);
  rim.addColorStop(0, "#8b949f");
  rim.addColorStop(0.45, "#f2f5f8");
  rim.addColorStop(1, "#4e555e");
  ctx.fillStyle = rim;
  ctx.fill();
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = "#c5ccd5";
    ctx.fillRect(-3.4, 10, 6.8, 48);
    ctx.restore();
  }
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(62, 0);
    drawBluedScrew(ctx, 3.3, 0.4);
    ctx.restore();
  }
  drawJewel(ctx, 6.6);
  ctx.restore();
  drawHairspring(ctx, angle);
}

export function drawPallet(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#c5ccd4";
  ctx.beginPath();
  ctx.moveTo(-34, -4);
  ctx.lineTo(-8, -8);
  ctx.lineTo(8, -8);
  ctx.lineTo(34, -4);
  ctx.lineTo(30, 8);
  ctx.lineTo(10, 6);
  ctx.lineTo(-10, 6);
  ctx.lineTo(-30, 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(20,24,30,0.25)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.save();
  ctx.translate(-26, -3);
  ctx.rotate(-0.55);
  drawJewel(ctx, 4.4);
  ctx.restore();
  ctx.save();
  ctx.translate(26, -3);
  ctx.rotate(0.55);
  drawJewel(ctx, 4.4);
  ctx.restore();
  drawJewel(ctx, 5.2);
  ctx.restore();
}

export function drawPinion(ctx: CanvasRenderingContext2D, r: number, teeth: number): void {
  toothPath(ctx, teeth, r, r * 0.62, false);
  const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 1, 0, 0, r);
  g.addColorStop(0, "#e8edf4");
  g.addColorStop(1, "#6a717c");
  ctx.fillStyle = g;
  ctx.fill();
}
