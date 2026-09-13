import { useRef, type JSX } from "react";
import type { FaceProps } from "../instrument";
import { formatRemain } from "../derive";
import { useFaceCanvas } from "../useFaceCanvas";
import { isBurstKind } from "../events";
import { isFaceThumb } from "../thumb";
import {
  progressTheta,
  sampleTrace,
  sessionHarmonics,
  visualWraps,
  type Harmonic,
  type TraceSample,
} from "./math";

interface TraceCache {
  sessionId: string;
  harmonics: Harmonic[];
  points: TraceSample[];
  lastTheta: number;
  r0: number;
  r1: number;
  wraps: number;
}

interface Drum {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  hh: number;
  top: number;
}

const PAPER = "#efe3c4";
const INK = "#6b1520";
const BRASS = "#c4922e";

export function RecordFace(props: FaceProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<TraceCache | null>(null);

  useFaceCanvas(
    canvasRef,
    (ctx, w, h, clockMs) => {
      paintRecord(ctx, w, h, props, cacheRef, clockMs);
    },
    [
      props.progress,
      props.phase,
      props.sessionId,
      props.elapsedMs,
      props.remainingMs,
      props.events,
      props.freeze,
    ],
    { freeze: props.freeze, paused: props.paused },
  );

  return (
    <div className="fp-face fp-face-record">
      <canvas ref={canvasRef} aria-label="Seismograph record of the session" />
    </div>
  );
}

function paintRecord(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  props: FaceProps,
  cacheRef: { current: TraceCache | null },
  clockMs: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const thumb = isFaceThumb(h);
  const drum = layoutRecordDrum(w, h);

  const r0 = 0.08;
  const r1 = 0.94;
  const wraps = visualWraps(Math.max(props.progress, 0.001));
  const theta = progressTheta(props.progress);
  const harmonics = sessionHarmonics(props.sessionId);

  extendCache(cacheRef, {
    sessionId: props.sessionId,
    harmonics,
    theta,
    r0,
    r1,
    wraps,
    events: props.events,
  });

  const points = cacheRef.current?.points ?? [];
  const last = points[points.length - 1];
  const idle = props.freeze || props.paused ? 0 : clockMs / 1600;
  const viewRot = 0.42 - (last?.theta ?? theta) + idle * 0.12;
  const stylusWobble = props.freeze || props.paused ? 0 : Math.sin(clockMs / 70) * 1.8;

  drawRoom(ctx, w, h);
  drawBench(ctx, w, h, drum, thumb);
  drawUpright(ctx, drum, -1, thumb);
  drawDrumBody(ctx, drum);
  drawHelixClipped(ctx, drum, points, r0, r1, viewRot, false);
  drawHelixClipped(ctx, drum, points, r0, r1, viewRot, true);
  drawRims(ctx, drum, thumb);
  drawUpright(ctx, drum, 1, thumb);
  drawStylus(
    ctx,
    drum,
    points,
    r0,
    r1,
    viewRot,
    props.phase === "ended" || props.progress >= 0.999,
    stylusWobble,
    thumb,
  );
  if (!thumb) {
    drawPlaque(ctx, w, h, props);
  }
}

export function layoutRecordDrum(w: number, h: number): Drum {
  const min = Math.min(w, h);
  if (isFaceThumb(h)) {
    const drum: Drum = {
      cx: w * 0.5,
      cy: h * 0.52,
      rx: min * 0.4,
      ry: min * 0.15,
      hh: min * 0.82,
      top: 0,
    };
    drum.top = drum.cy - drum.hh * 0.46;
    return drum;
  }
  const drum: Drum = {
    cx: w * 0.46,
    cy: h * 0.5,
    rx: min * 0.3,
    ry: min * 0.1,
    hh: min * 0.46,
    top: 0,
  };
  drum.top = drum.cy - drum.hh * 0.42;
  return drum;
}

function paperPoint(
  drum: Drum,
  theta: number,
  z01: number,
): { x: number; y: number; front: boolean; shade: number } {
  const z = Math.max(0, Math.min(1, z01));
  const shade = Math.cos(theta);
  return {
    x: drum.cx + drum.rx * Math.sin(theta),
    y: drum.top + (1 - z) * drum.hh + drum.ry * shade,
    front: shade > -0.06,
    shade,
  };
}

function zFromRadius(radius: number, r0: number, r1: number): number {
  if (r1 <= r0) {
    return 0.2;
  }
  return 0.1 + 0.8 * Math.max(0, Math.min(1, (radius - r0) / (r1 - r0)));
}

function drawRoom(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#2c1c14");
  g.addColorStop(0.55, "#1a100c");
  g.addColorStop(1, "#0c0806");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = "#d2b080";
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 7) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(y * 0.16) * 1.4);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBench(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  drum: Drum,
  thumb: boolean,
): void {
  const x = w * 0.07;
  const y = drum.top + drum.hh + drum.ry + (thumb ? 4 : 18);
  const bw = w * 0.86;
  const bh = h * (thumb ? 0.07 : 0.09);
  const wood = ctx.createLinearGradient(x, y, x, y + bh);
  wood.addColorStop(0, "#5a3a24");
  wood.addColorStop(0.4, "#3d2618");
  wood.addColorStop(1, "#24160e");
  ctx.fillStyle = wood;
  roundRectFill(ctx, x, y, bw, bh, 8);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(drum.cx, y + 6, drum.rx * 1.05, 14, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawUpright(
  ctx: CanvasRenderingContext2D,
  drum: Drum,
  side: -1 | 1,
  thumb: boolean,
): void {
  const postW = thumb ? Math.max(8, drum.rx * 0.28) : 44;
  const gap = thumb ? drum.rx * 0.2 : 42;
  const x = drum.cx + side * (drum.rx + gap) - postW / 2;
  const y = drum.top - (thumb ? 6 : 26);
  const wood = ctx.createLinearGradient(x, y, x + postW, y);
  wood.addColorStop(0, "#3a2418");
  wood.addColorStop(0.45, "#6a4630");
  wood.addColorStop(1, "#24160e");
  ctx.fillStyle = wood;
  roundRectFill(ctx, x, y, postW, drum.hh + (thumb ? 16 : 66), thumb ? 3 : 6);
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.arc(x + postW / 2, drum.top + 4, thumb ? 4 : 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + postW / 2, drum.top + drum.hh - 4, thumb ? 4 : 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a120c";
  ctx.beginPath();
  ctx.arc(x + postW / 2, drum.top + 4, thumb ? 1.4 : 3.4, 0, Math.PI * 2);
  ctx.fill();
}

function clipCylinder(ctx: CanvasRenderingContext2D, drum: Drum, front: boolean): void {
  ctx.beginPath();
  const a0 = front ? -Math.PI / 2 - 0.04 : Math.PI / 2;
  const a1 = front ? Math.PI / 2 + 0.04 : (3 * Math.PI) / 2;
  for (let a = a0; a <= a1; a += 0.04) {
    const p = paperPoint(drum, a, 1);
    if (a === a0) {
      ctx.moveTo(p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  for (let a = a1; a >= a0; a -= 0.04) {
    const p = paperPoint(drum, a, 0);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.clip();
}

function drawDrumBody(ctx: CanvasRenderingContext2D, drum: Drum): void {
  ctx.save();
  clipCylinder(ctx, drum, false);
  ctx.fillStyle = "#cbb892";
  ctx.fillRect(drum.cx - drum.rx - 8, drum.top - 20, drum.rx * 2 + 16, drum.hh + 50);
  ctx.restore();

  ctx.save();
  clipCylinder(ctx, drum, true);
  const light = ctx.createLinearGradient(drum.cx - drum.rx, 0, drum.cx + drum.rx, 0);
  light.addColorStop(0, "#d8c49a");
  light.addColorStop(0.28, "#f7edd4");
  light.addColorStop(0.5, PAPER);
  light.addColorStop(0.78, "#e7d7b0");
  light.addColorStop(1, "#c9b48a");
  ctx.fillStyle = light;
  ctx.fillRect(drum.cx - drum.rx - 8, drum.top - 20, drum.rx * 2 + 16, drum.hh + 50);

  ctx.strokeStyle = "rgba(92, 64, 32, 0.22)";
  ctx.lineWidth = 1;
  for (let z = 0.06; z <= 0.96; z += 0.055) {
    ctx.beginPath();
    for (let a = -Math.PI / 2; a <= Math.PI / 2; a += 0.05) {
      const p = paperPoint(drum, a, z);
      if (a === -Math.PI / 2) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }
  for (let i = 0; i < 18; i += 1) {
    const a = -Math.PI / 2 + (i / 17) * Math.PI;
    const top = paperPoint(drum, a, 1);
    const bot = paperPoint(drum, a, 0);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bot.x, bot.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHelixClipped(
  ctx: CanvasRenderingContext2D,
  drum: Drum,
  points: readonly TraceSample[],
  r0: number,
  r1: number,
  viewRot: number,
  front: boolean,
): void {
  if (points.length < 2) {
    return;
  }
  ctx.save();
  clipCylinder(ctx, drum, front);
  ctx.strokeStyle = front ? INK : "rgba(107, 21, 32, 0.22)";
  ctx.lineWidth = front ? 2.15 : 1.15;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  let drawing = false;
  for (const sample of points) {
    const p = paperPoint(drum, sample.theta + viewRot, zFromRadius(sample.radius, r0, r1));
    if (p.front !== front) {
      drawing = false;
      continue;
    }
    if (!drawing) {
      ctx.moveTo(p.x, p.y);
      drawing = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawRims(ctx: CanvasRenderingContext2D, drum: Drum, thumb = false): void {
  for (const z of [0, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= 72; i += 1) {
      const a = (i / 72) * Math.PI * 2;
      const p = paperPoint(drum, a, z);
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = z === 1 ? "rgba(196, 146, 46, 0.16)" : "rgba(80, 56, 18, 0.2)";
    ctx.fill();
    ctx.strokeStyle = "#b8862a";
    ctx.lineWidth = thumb ? 3.2 : 7;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 224, 150, 0.45)";
    ctx.lineWidth = thumb ? 0.9 : 1.6;
    ctx.stroke();
  }
}

function drawStylus(
  ctx: CanvasRenderingContext2D,
  drum: Drum,
  points: readonly TraceSample[],
  r0: number,
  r1: number,
  viewRot: number,
  lifted: boolean,
  wobble: number,
  thumb = false,
): void {
  const last = points[points.length - 1];
  const z = last ? zFromRadius(last.radius, r0, r1) : 0.55;
  const tip = paperPoint(drum, (last?.theta ?? 0) + viewRot, z);
  const pivotX = drum.cx + drum.rx + (thumb ? drum.rx * 0.55 : 92);
  const pivotY = drum.top + drum.hh * 0.28;
  const endY = lifted ? tip.y - (thumb ? 6 : 14) : tip.y + 1 + wobble;

  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(tip.x + 2, endY);
  ctx.strokeStyle = "#c5ccd4";
  ctx.lineWidth = thumb ? 3 : 6;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.strokeStyle = "#8b939c";
  ctx.lineWidth = thumb ? 1.2 : 2.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(pivotX, pivotY, thumb ? 6 : 14, 0, Math.PI * 2);
  ctx.fillStyle = "#9aa3ad";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(pivotX + (thumb ? 10 : 22), pivotY + (thumb ? 12 : 26), thumb ? 5 : 11, 0, Math.PI * 2);
  ctx.fillStyle = "#2a3038";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(tip.x, endY);
  ctx.lineTo(tip.x + (thumb ? 4 : 9), endY - (thumb ? 6 : 13));
  ctx.lineTo(tip.x - (thumb ? 3 : 7), endY - (thumb ? 2 : 4));
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
}

function extendCache(
  cacheRef: { current: TraceCache | null },
  input: {
    sessionId: string;
    harmonics: Harmonic[];
    theta: number;
    r0: number;
    r1: number;
    wraps: number;
    events: FaceProps["events"];
  },
): void {
  const current = cacheRef.current;
  const stale =
    !current ||
    current.sessionId !== input.sessionId ||
    current.r0 !== input.r0 ||
    current.r1 !== input.r1 ||
    current.wraps !== input.wraps;
  if (stale) {
    cacheRef.current = {
      sessionId: input.sessionId,
      harmonics: input.harmonics,
      points: [],
      lastTheta: 0,
      r0: input.r0,
      r1: input.r1,
      wraps: input.wraps,
    };
  }
  const cache = cacheRef.current;
  if (!cache) {
    return;
  }
  if (input.theta + 1e-6 < cache.lastTheta) {
    cache.points = [];
    cache.lastTheta = 0;
  }
  if (input.theta <= cache.lastTheta + 1e-6 && cache.points.length > 0) {
    return;
  }
  const from = cache.points.length === 0 ? 0 : cache.lastTheta;
  const extra = sampleTrace({
    fromTheta: from,
    toTheta: input.theta,
    cx: 0,
    cy: 0,
    r0: input.r0,
    r1: input.r1,
    harmonics: input.harmonics,
    events: input.events,
    revs: input.wraps,
  });
  if (cache.points.length > 0 && extra[0]) {
    cache.points.push(...extra.slice(1));
  } else {
    cache.points.push(...extra);
  }
  cache.lastTheta = input.theta;
}

function drawPlaque(ctx: CanvasRenderingContext2D, w: number, h: number, props: FaceProps): void {
  const bursts = props.events.filter((event) => isBurstKind(event.kind));
  const ended = props.phase === "ended" || props.progress >= 0.999;
  ctx.textAlign = "center";
  ctx.fillStyle = "#f3e6c8";
  ctx.font = `650 ${Math.max(18, Math.round(w * 0.022))}px Geist, sans-serif`;
  ctx.fillText("THE  RECORD", w * 0.5, h * 0.075);
  ctx.font = `500 ${Math.max(12, Math.round(w * 0.013))}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = "rgba(243,230,200,0.72)";
  ctx.fillText(
    ended
      ? `${props.sessionId}   artifact of attention`
      : `${props.sessionId}   ${formatRemain(props.remainingMs)} remain`,
    w * 0.5,
    h * 0.935,
  );
  ctx.fillText(
    bursts.length > 0 ? `${bursts.length} bursts    countdown / kill / drift` : "quiet baseline",
    w * 0.5,
    h * 0.965,
  );
}

function roundRectFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
