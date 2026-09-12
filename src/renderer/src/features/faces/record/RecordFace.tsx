import { useRef, type JSX } from "react";
import type { FaceProps } from "../types";
import { formatRemain } from "../derive";
import { useFaceCanvas } from "../useFaceCanvas";
import { isBurstKind } from "../events";
import {
  polarPoint,
  progressTheta,
  revolutionCount,
  sampleTrace,
  sessionHarmonics,
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
  cx: number;
  cy: number;
}

const PAPER = "#efe4c8";
const INK = "#6b1a22";
const GRID = "rgba(92, 70, 42, 0.18)";

export function RecordFace(props: FaceProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<TraceCache | null>(null);

  useFaceCanvas(
    canvasRef,
    (ctx, w, h) => {
      paintRecord(ctx, w, h, props, cacheRef);
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
): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w * 0.5;
  const cy = h * 0.5 - 8;
  const drumR = Math.min(w, h) * 0.36;
  const r0 = drumR * 0.22;
  const r1 = drumR * 0.9;
  const revs = revolutionCount(Math.max(props.progress, 0.001));
  const theta = progressTheta(props.progress);
  const harmonics = sessionHarmonics(props.sessionId);

  const housing = ctx.createLinearGradient(0, 0, 0, h);
  housing.addColorStop(0, "#2a1c16");
  housing.addColorStop(0.45, "#1a120e");
  housing.addColorStop(1, "#0d0907");
  ctx.fillStyle = housing;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#3a2a20";
  roundRectFill(ctx, w * 0.08, h * 0.07, w * 0.84, h * 0.86, 18);
  const well = ctx.createRadialGradient(cx, cy, drumR * 0.2, cx, cy, drumR * 1.35);
  well.addColorStop(0, "#4a3428");
  well.addColorStop(1, "#1a110c");
  ctx.fillStyle = well;
  ctx.beginPath();
  ctx.arc(cx, cy, drumR * 1.18, 0, Math.PI * 2);
  ctx.fill();

  const ended = props.phase === "ended" || props.progress >= 0.999;
  const paperAngle = ended ? 0 : Math.PI * 0.62 - theta;
  const stylusAngle = ended ? theta : Math.PI * 0.62;

  extendCache(cacheRef, {
    sessionId: props.sessionId,
    harmonics,
    theta,
    cx,
    cy,
    r0,
    r1,
    revs,
    events: props.events,
  });

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(paperAngle);
  ctx.translate(-cx, -cy);
  drawPaper(ctx, cx, cy, drumR, r0);
  drawInk(ctx, cacheRef.current?.points ?? []);
  ctx.restore();

  drawBezel(ctx, cx, cy, drumR);
  const tip = polarPoint(
    cx,
    cy,
    radiusFromCache(cacheRef.current, theta, r0, r1),
    ended ? theta : stylusAngle,
  );
  drawStylus(ctx, cx, cy, drumR, tip.x, tip.y, ended);

  ctx.fillStyle = "#efe4c8";
  ctx.font = `600 ${Math.max(13, Math.round(w * 0.016))}px Geist, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("THE RECORD", cx, h * 0.075);
  ctx.font = `500 ${Math.max(11, Math.round(w * 0.012))}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = "rgba(239,228,200,0.62)";
  const caption = ended
    ? `${props.sessionId}  ·  artifact of attention`
    : `${props.sessionId}  ·  ${formatRemain(props.remainingMs)} remain`;
  ctx.fillText(caption, cx, h * 0.945);

  drawEventKey(ctx, w, h, props);
}

function extendCache(
  cacheRef: { current: TraceCache | null },
  input: {
    sessionId: string;
    harmonics: Harmonic[];
    theta: number;
    cx: number;
    cy: number;
    r0: number;
    r1: number;
    revs: number;
    events: FaceProps["events"];
  },
): void {
  const current = cacheRef.current;
  const stale =
    !current ||
    current.sessionId !== input.sessionId ||
    current.cx !== input.cx ||
    current.cy !== input.cy ||
    current.r0 !== input.r0 ||
    current.r1 !== input.r1;
  if (stale) {
    cacheRef.current = {
      sessionId: input.sessionId,
      harmonics: input.harmonics,
      points: [],
      lastTheta: 0,
      r0: input.r0,
      r1: input.r1,
      cx: input.cx,
      cy: input.cy,
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
    cx: input.cx,
    cy: input.cy,
    r0: input.r0,
    r1: input.r1,
    harmonics: input.harmonics,
    events: input.events,
    revs: input.revs,
  });
  if (cache.points.length > 0 && extra[0]) {
    cache.points.push(...extra.slice(1));
  } else {
    cache.points.push(...extra);
  }
  cache.lastTheta = input.theta;
}

function radiusFromCache(
  cache: TraceCache | null,
  theta: number,
  r0: number,
  r1: number,
): number {
  const last = cache?.points[cache.points.length - 1];
  if (last) {
    return last.radius;
  }
  return r0 + (r1 - r0) * (theta / (Math.PI * 2));
}

function drawPaper(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  drumR: number,
  r0: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, drumR, 0, Math.PI * 2);
  const paper = ctx.createRadialGradient(cx - drumR * 0.2, cy - drumR * 0.25, drumR * 0.1, cx, cy, drumR);
  paper.addColorStop(0, "#f7eed6");
  paper.addColorStop(0.7, PAPER);
  paper.addColorStop(1, "#d8c7a0");
  ctx.fillStyle = paper;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, drumR - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let r = r0; r < drumR; r += drumR * 0.07) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
    ctx.lineTo(cx + Math.sin(a) * drumR, cy - Math.cos(a) * drumR);
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r0 * 0.72, 0, Math.PI * 2);
  const hub = ctx.createRadialGradient(cx - 4, cy - 5, 2, cx, cy, r0 * 0.72);
  hub.addColorStop(0, "#e6c36a");
  hub.addColorStop(1, "#8a5a18");
  ctx.fillStyle = hub;
  ctx.fill();
}

function drawInk(ctx: CanvasRenderingContext2D, points: readonly TraceSample[]): void {
  if (points.length < 2) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    if (p) {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.strokeStyle = "rgba(60, 12, 18, 0.22)";
  ctx.lineWidth = 3.1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.45;
  ctx.stroke();
}

function drawBezel(ctx: CanvasRenderingContext2D, cx: number, cy: number, drumR: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, drumR + 14, 0, Math.PI * 2);
  ctx.arc(cx, cy, drumR + 2, 0, Math.PI * 2, true);
  const brass = ctx.createLinearGradient(cx - drumR, cy - drumR, cx + drumR, cy + drumR);
  brass.addColorStop(0, "#f0d58a");
  brass.addColorStop(0.45, "#b07a28");
  brass.addColorStop(1, "#6a4410");
  ctx.fillStyle = brass;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, drumR + 8, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,230,160,0.28)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawStylus(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  drumR: number,
  tipX: number,
  tipY: number,
  lifted: boolean,
): void {
  const pivotX = cx + drumR * 1.28;
  const pivotY = cy + drumR * 0.08;
  const endX = lifted ? tipX + 10 : tipX;
  const endY = lifted ? tipY - 14 : tipY;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = "#c5ccd4";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, 11, 0, Math.PI * 2);
  ctx.fillStyle = "#8a929c";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(pivotX + 22, pivotY + 18, 9, 0, Math.PI * 2);
  ctx.fillStyle = "#2a3038";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX + 7, endY - 11);
  ctx.lineTo(endX - 5, endY - 6);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
}

function drawEventKey(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  props: FaceProps,
): void {
  const bursts = props.events.filter((event) => isBurstKind(event.kind));
  ctx.font = `500 ${Math.max(10, Math.round(w * 0.011))}px "IBM Plex Mono", monospace`;
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(239,228,200,0.5)";
  ctx.fillText(
    bursts.length > 0
      ? `${bursts.length} bursts  ·  countdown / kill / drift`
      : "quiet baseline",
    w * 0.1,
    h * 0.945,
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
