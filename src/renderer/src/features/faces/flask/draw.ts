import { formatFaceClock } from "../clock";
import type { FacePhase } from "@shared/faces";
import { isFaceThumb } from "../thumb";
import {
  FLASK_GEOM,
  bezierPoint,
  corkSeated,
  dripPhases,
  fitFlaskView,
  leakActive,
  mouthDripStart,
  radiusAtY,
  remainingFill,
  resolveClockMs,
  streamControls,
  waterCoversSpigot,
  waterLineY,
  type FlaskGeom,
  type Point,
} from "./math";

export interface FlaskDrawInput {
  progress: number;
  phase: FacePhase;
  remainingMs: number;
  clockMs: number;
  freeze: boolean;
}

function addBottlePath(
  ctx: CanvasRenderingContext2D,
  geom: FlaskGeom,
  inset: number,
): void {
  const cx = geom.cx;
  const rx = (value: number): number => Math.max(3.2, value - inset);
  const lipY = geom.lipY + inset * 0.35;
  const baseY = geom.baseY - inset;

  ctx.moveTo(cx + rx(geom.lipRx), lipY);
  ctx.bezierCurveTo(
    cx + rx(geom.lipRx * 0.92),
    lipY + 18,
    cx + rx(geom.neckRx),
    geom.neckY - 22,
    cx + rx(geom.neckRx),
    geom.neckY,
  );
  ctx.bezierCurveTo(
    cx + rx(geom.neckRx + 2),
    geom.neckY + 28,
    cx + rx(geom.shoulderRx - 8),
    geom.shoulderY - 8,
    cx + rx(geom.shoulderRx),
    geom.shoulderY,
  );
  ctx.bezierCurveTo(
    cx + rx(geom.shoulderRx + 10),
    geom.shoulderY + 42,
    cx + rx(geom.bellyRx),
    geom.bellyY - 36,
    cx + rx(geom.bellyRx),
    geom.bellyY,
  );
  ctx.bezierCurveTo(
    cx + rx(geom.bellyRx - 2),
    geom.bellyY + 70,
    cx + rx(geom.hipRx + 4),
    geom.hipY - 24,
    cx + rx(geom.hipRx),
    geom.hipY,
  );
  ctx.bezierCurveTo(
    cx + rx(geom.hipRx - 2),
    geom.hipY + 22,
    cx + rx(geom.baseRx),
    baseY - 10,
    cx + rx(geom.baseRx - 2),
    baseY,
  );
  ctx.lineTo(cx - rx(geom.baseRx - 2), baseY);
  ctx.bezierCurveTo(
    cx - rx(geom.baseRx),
    baseY - 10,
    cx - rx(geom.hipRx - 2),
    geom.hipY + 22,
    cx - rx(geom.hipRx),
    geom.hipY,
  );
  ctx.bezierCurveTo(
    cx - rx(geom.hipRx + 4),
    geom.hipY - 24,
    cx - rx(geom.bellyRx - 2),
    geom.bellyY + 70,
    cx - rx(geom.bellyRx),
    geom.bellyY,
  );
  ctx.bezierCurveTo(
    cx - rx(geom.bellyRx),
    geom.bellyY - 36,
    cx - rx(geom.shoulderRx + 10),
    geom.shoulderY + 42,
    cx - rx(geom.shoulderRx),
    geom.shoulderY,
  );
  ctx.bezierCurveTo(
    cx - rx(geom.shoulderRx - 8),
    geom.shoulderY - 8,
    cx - rx(geom.neckRx + 2),
    geom.neckY + 28,
    cx - rx(geom.neckRx),
    geom.neckY,
  );
  ctx.bezierCurveTo(
    cx - rx(geom.neckRx),
    geom.neckY - 22,
    cx - rx(geom.lipRx * 0.92),
    lipY + 18,
    cx - rx(geom.lipRx),
    lipY,
  );
  ctx.closePath();
}

function paintRoom(ctx: CanvasRenderingContext2D, w: number, h: number, phase: FacePhase): void {
  const night = ctx.createLinearGradient(0, 0, 0, h);
  night.addColorStop(0, "#0a0c12");
  night.addColorStop(0.55, "#05060a");
  night.addColorStop(1, "#030308");
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, w, h);

  const spot = ctx.createRadialGradient(w * 0.5, h * 0.28, 8, w * 0.5, h * 0.42, Math.max(w, h) * 0.42);
  const glow =
    phase === "break"
      ? "rgba(255, 70, 100, 0.14)"
      : phase === "focus"
        ? "rgba(170, 210, 255, 0.16)"
        : "rgba(150, 170, 200, 0.1)";
  spot.addColorStop(0, glow);
  spot.addColorStop(0.45, "rgba(20, 28, 40, 0.12)");
  spot.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);
}

function paintShelf(ctx: CanvasRenderingContext2D, geom: FlaskGeom, wetX: number, clockMs: number, leaking: boolean): void {
  const y = geom.shelfY;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.ellipse(geom.cx, y + 10, 92, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  const wood = ctx.createLinearGradient(geom.cx - 130, y, geom.cx + 130, y + 18);
  wood.addColorStop(0, "#1a140f");
  wood.addColorStop(0.45, "#2a2118");
  wood.addColorStop(1, "#14100c");
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.ellipse(geom.cx + 8, y + 6, 118, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(90, 70, 48, 0.45)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (leaking) {
    const pulse = 0.55 + 0.45 * Math.sin(clockMs / 180);
    const wet = ctx.createRadialGradient(wetX, y + 2, 2, wetX, y + 2, 28);
    wet.addColorStop(0, `rgba(125, 211, 252, ${0.42 * pulse})`);
    wet.addColorStop(0.45, "rgba(56, 189, 248, 0.16)");
    wet.addColorStop(1, "rgba(14, 116, 144, 0)");
    ctx.fillStyle = wet;
    ctx.beginPath();
    ctx.ellipse(wetX, y + 3, 34, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(186, 230, 253, ${0.28 + 0.2 * pulse})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i += 1) {
      const ring = 6 + ((clockMs / 140 + i * 7) % 18);
      ctx.beginPath();
      ctx.ellipse(wetX, y + 3, ring, ring * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function paintCork(
  ctx: CanvasRenderingContext2D,
  geom: FlaskGeom,
  seated: boolean,
): void {
  ctx.save();
  if (!seated) {
    ctx.translate(geom.cx + 36, geom.corkTop - 10);
    ctx.rotate(-0.42);
    ctx.translate(-geom.cx, -geom.corkTop);
  }
  const cork = ctx.createLinearGradient(geom.cx - 18, geom.corkTop, geom.cx + 18, geom.corkBot);
  cork.addColorStop(0, "#f0d2a0");
  cork.addColorStop(0.3, "#c48a48");
  cork.addColorStop(1, "#6a3c18");
  ctx.fillStyle = cork;
  ctx.beginPath();
  ctx.moveTo(geom.cx - geom.corkRx + 1, geom.corkTop + 4);
  ctx.quadraticCurveTo(geom.cx, geom.corkTop - 8, geom.cx + geom.corkRx - 1, geom.corkTop + 4);
  ctx.lineTo(geom.cx + geom.corkRx + 3, geom.corkBot);
  ctx.quadraticCurveTo(geom.cx, geom.corkBot + 6, geom.cx - geom.corkRx - 3, geom.corkBot);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(60, 32, 12, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "#e8c888";
  ctx.beginPath();
  ctx.ellipse(geom.cx, geom.corkTop + 3, geom.corkRx - 2, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 220, 170, 0.4)";
  ctx.beginPath();
  ctx.moveTo(geom.cx - 7, geom.corkTop + 12);
  ctx.lineTo(geom.cx - 5, geom.corkBot - 8);
  ctx.stroke();
  ctx.restore();
}

function paintSpigot(ctx: CanvasRenderingContext2D, geom: FlaskGeom): Point {
  const attachR = radiusAtY(geom.spigotY, geom, 0);
  const x0 = geom.cx + attachR - 3;
  const y = geom.spigotY;
  const x1 = x0 + geom.spigotLength;

  const brass = ctx.createLinearGradient(x0, y - 14, x0, y + 16);
  brass.addColorStop(0, "#f8e6b0");
  brass.addColorStop(0.4, "#d4a84a");
  brass.addColorStop(1, "#5a3a0c");
  ctx.fillStyle = brass;
  ctx.beginPath();
  ctx.roundRect(x0, y - 6, geom.spigotLength - 6, 13, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 230, 160, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(x1 - 12, y - 1, 13, 16, 4);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(x0 + 10, y - 12, 6.5, 8.5, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#2a1c08";
  ctx.beginPath();
  ctx.arc(x0 + 10, y - 12, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#c4a050";
  ctx.beginPath();
  ctx.arc(x1 - 6, y + 15, 3.2, 0, Math.PI * 2);
  ctx.fill();

  return { x: x1 - 5, y: y + 16 };
}

function paintWater(
  ctx: CanvasRenderingContext2D,
  geom: FlaskGeom,
  fill: number,
  phase: FacePhase,
  clockMs: number,
): void {
  const surface = waterLineY(fill, geom);
  const ripple = Math.sin(clockMs / 220) * 1.4;
  const waterY = surface + ripple;
  const rx = radiusAtY(waterY, geom, geom.innerInset + 1);

  ctx.save();
  ctx.beginPath();
  addBottlePath(ctx, geom, geom.innerInset);
  ctx.clip();

  const deep = phase === "break" ? "#3f0a18" : "#042033";
  const mid = phase === "break" ? "#be123c" : "#0369a1";
  const top = phase === "break" ? "#fda4af" : "#7dd3fc";

  const body = ctx.createLinearGradient(geom.cx, waterY, geom.cx, geom.baseY);
  body.addColorStop(0, top);
  body.addColorStop(0.12, mid);
  body.addColorStop(0.55, phase === "break" ? "#881337" : "#0c4a6e");
  body.addColorStop(1, deep);
  ctx.fillStyle = body;
  ctx.fillRect(geom.cx - 120, waterY, 240, geom.baseY - waterY + 12);

  const shade = ctx.createLinearGradient(geom.cx - rx, waterY, geom.cx + rx, waterY);
  shade.addColorStop(0, "rgba(255, 255, 255, 0.16)");
  shade.addColorStop(0.45, "rgba(255, 255, 255, 0)");
  shade.addColorStop(0.72, "rgba(0, 20, 40, 0.18)");
  shade.addColorStop(1, "rgba(0, 10, 24, 0.28)");
  ctx.fillStyle = shade;
  ctx.fillRect(geom.cx - rx, waterY, rx * 2, geom.baseY - waterY);

  ctx.fillStyle = "rgba(224, 246, 255, 0.72)";
  ctx.beginPath();
  ctx.ellipse(geom.cx, waterY, rx - 1, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(geom.cx, waterY, rx - 1.5, 7, 0, Math.PI * 1.02, Math.PI * 1.98);
  ctx.stroke();

  ctx.strokeStyle = "rgba(8, 47, 73, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(geom.cx, waterY + 1.2, rx - 2, 4.4, 0, 0.15, Math.PI - 0.15);
  ctx.stroke();

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#e0f2fe";
  ctx.beginPath();
  ctx.ellipse(geom.cx - rx * 0.35, waterY + 18, rx * 0.28, 7, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const bubbles = [
    { x: -18, y: 28, r: 1.4, d: 0 },
    { x: 12, y: 46, r: 1.1, d: 220 },
    { x: -6, y: 72, r: 0.9, d: 440 },
    { x: 20, y: 90, r: 1.2, d: 110 },
  ];
  for (const bubble of bubbles) {
    const rise = ((clockMs + bubble.d) / 16) % 90;
    const by = waterY + bubble.y - rise * 0.15;
    if (by < waterY + 4 || by > geom.baseY - 12) {
      continue;
    }
    ctx.fillStyle = "rgba(224, 246, 255, 0.45)";
    ctx.beginPath();
    ctx.arc(geom.cx + bubble.x, by, bubble.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function paintGlass(ctx: CanvasRenderingContext2D, geom: FlaskGeom): void {
  ctx.save();
  ctx.beginPath();
  addBottlePath(ctx, geom, 0);
  const glass = ctx.createLinearGradient(geom.cx - 90, geom.lipY, geom.cx + 90, geom.baseY);
  glass.addColorStop(0, "rgba(186, 210, 230, 0.16)");
  glass.addColorStop(0.4, "rgba(80, 110, 140, 0.08)");
  glass.addColorStop(1, "rgba(40, 60, 80, 0.14)");
  ctx.fillStyle = glass;
  ctx.fill();

  ctx.beginPath();
  addBottlePath(ctx, geom, 0);
  addBottlePath(ctx, geom, geom.innerInset);
  const wall = ctx.createLinearGradient(geom.cx - 80, 0, geom.cx + 80, 0);
  wall.addColorStop(0, "rgba(226, 240, 255, 0.38)");
  wall.addColorStop(0.35, "rgba(148, 180, 210, 0.12)");
  wall.addColorStop(0.7, "rgba(20, 32, 48, 0.2)");
  wall.addColorStop(1, "rgba(200, 220, 240, 0.22)");
  ctx.fillStyle = wall;
  ctx.fill("evenodd");

  ctx.beginPath();
  addBottlePath(ctx, geom, 0);
  ctx.strokeStyle = "rgba(226, 240, 255, 0.82)";
  ctx.lineWidth = 2.8;
  ctx.stroke();

  ctx.beginPath();
  addBottlePath(ctx, geom, geom.innerInset);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.restore();

  const rim = ctx.createLinearGradient(geom.cx - 22, geom.lipY - 6, geom.cx + 22, geom.lipY + 8);
  rim.addColorStop(0, "rgba(255, 255, 255, 0.15)");
  rim.addColorStop(0.5, "rgba(226, 240, 255, 0.85)");
  rim.addColorStop(1, "rgba(140, 170, 200, 0.35)");
  ctx.strokeStyle = rim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(geom.cx, geom.lipY, geom.lipRx + 1, 5.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(12, 16, 22, 0.35)";
  ctx.beginPath();
  ctx.ellipse(geom.cx, geom.lipY + 1, geom.lipRx - 4, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  addBottlePath(ctx, geom, 1);
  ctx.clip();
  const spec = ctx.createLinearGradient(geom.cx - 58, geom.neckY, geom.cx - 20, geom.baseY);
  spec.addColorStop(0, "rgba(255, 255, 255, 0)");
  spec.addColorStop(0.25, "rgba(255, 255, 255, 0.28)");
  spec.addColorStop(0.4, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = spec;
  ctx.fillRect(geom.cx - 70, geom.lipY, 36, geom.baseY - geom.lipY);
  ctx.restore();

  ctx.strokeStyle = "rgba(226, 240, 255, 0.18)";
  ctx.lineWidth = 1;
  const marks = [0.2, 0.4, 0.6, 0.8];
  for (const mark of marks) {
    const y = waterLineY(mark, geom);
    const r = radiusAtY(y, geom, 2);
    ctx.beginPath();
    ctx.moveTo(geom.cx - r + 6, y);
    ctx.lineTo(geom.cx - r + 16, y);
    ctx.stroke();
  }
}

function paintRivulet(
  ctx: CanvasRenderingContext2D,
  geom: FlaskGeom,
  fill: number,
  clockMs: number,
): void {
  const y0 = waterLineY(fill, geom) + 3;
  const r0 = radiusAtY(y0, geom, 1);
  const x0 = geom.cx + r0 - 1;
  const y1 = geom.spigotY + 4;
  const wobble = Math.sin(clockMs / 160) * 1.4;
  ctx.save();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.55)";
  ctx.lineWidth = 2.1;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.bezierCurveTo(x0 + 3 + wobble, y0 + 24, x0 + 6, y1 - 20, x0 + 2, y1);
  ctx.stroke();
  ctx.strokeStyle = "rgba(224, 246, 255, 0.35)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();
}

function paintStream(
  ctx: CanvasRenderingContext2D,
  clockMs: number,
  fromMouth: boolean,
): void {
  const stream = streamControls();
  const wobble = Math.sin(clockMs / 130) * 2.2;
  const c1 = { x: stream.c1.x + wobble, y: stream.c1.y };
  const c2 = { x: stream.c2.x - wobble * 0.6, y: stream.c2.y };

  const ribbon = ctx.createLinearGradient(stream.start.x, stream.start.y, stream.end.x, stream.end.y);
  ribbon.addColorStop(0, "rgba(224, 246, 255, 0.98)");
  ribbon.addColorStop(0.35, "rgba(56, 189, 248, 0.95)");
  ribbon.addColorStop(1, "rgba(14, 165, 233, 0.35)");

  ctx.save();
  ctx.strokeStyle = ribbon;
  ctx.lineWidth = 7.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(stream.start.x, stream.start.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, stream.end.x, stream.end.y);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  const drops = dripPhases(clockMs, 5, 860);
  for (const phase of drops) {
    const p = bezierPoint(stream.start, c1, c2, stream.end, phase);
    const r = 4.6 + (1 - phase) * 2.4;
    ctx.fillStyle = `rgba(186, 230, 253, ${0.98 - phase * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * 0.7, r * 1.25, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.beginPath();
    ctx.ellipse(p.x - 0.8, p.y - 1.1, r * 0.28, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (fromMouth) {
    const mouth = mouthDripStart();
    const mouthDrops = dripPhases(clockMs + 180, 3, 640);
    ctx.save();
    ctx.strokeStyle = "rgba(125, 211, 252, 0.8)";
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(mouth.x, mouth.y);
    ctx.quadraticCurveTo(mouth.x + 10, mouth.y + 18, mouth.x + 8, mouth.y + 40);
    ctx.stroke();
    for (const phase of mouthDrops) {
      const y = mouth.y + 10 + phase * 42;
      ctx.fillStyle = "rgba(186, 230, 253, 0.92)";
      ctx.beginPath();
      ctx.ellipse(mouth.x + 8 + Math.sin(phase * 8) * 1.6, y, 2.4, 3.6, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function paintMeta(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fill: number,
  remainingMs: number,
  leaking: boolean,
  phase: FacePhase,
): void {
  const label = leaking ? "LEAKING" : phase === "idle" ? "SEALED" : "EMPTY";
  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(107, 118, 138, 0.95)";
  ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("FLASK", w - 22, h - 42);
  ctx.fillStyle = "#eef2f8";
  ctx.font = "600 15px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`${Math.round(fill * 100)}% remain · ${formatFaceClock(remainingMs)}`, w - 22, h - 24);
  ctx.fillStyle = leaking ? "#7dd3fc" : "#6b768a";
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(label, w - 22, h - 10);
  ctx.restore();
}

export function drawFlaskFace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: FlaskDrawInput,
): void {
  if (width < 8 || height < 8) {
    return;
  }
  const fill = remainingFill(input.progress);
  const leaking = leakActive(input.phase, fill);
  const clockMs = resolveClockMs(input.clockMs, input.freeze);
  const seated = corkSeated(input.phase, leaking);
  const geom = FLASK_GEOM;
  const view = fitFlaskView(width, height);

  ctx.clearRect(0, 0, width, height);
  paintRoom(ctx, width, height, input.phase);

  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);

  const stream = streamControls(geom);
  paintShelf(ctx, geom, stream.end.x, clockMs, leaking);
  paintCork(ctx, geom, seated);
  paintWater(ctx, geom, fill, input.phase, clockMs);
  paintGlass(ctx, geom);
  if (leaking && waterCoversSpigot(fill, geom)) {
    paintRivulet(ctx, geom, fill, clockMs);
  }
  paintSpigot(ctx, geom);
  if (leaking) {
    paintStream(ctx, clockMs, !seated);
  }

  ctx.restore();
  if (!isFaceThumb(height)) {
    paintMeta(ctx, width, height, fill, input.remainingMs, leaking, input.phase);
  }
}
