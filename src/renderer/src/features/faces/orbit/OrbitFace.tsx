import type { CSSProperties, JSX } from "react";
import { clampKillCount, clampProgress, resolveFaceBox } from "../clamp";
import type { FaceProps } from "../types";
import {
  ALIGN_ANGLE,
  bodyAngle,
  orbitBodies,
  polar,
  ringRadii,
  trailPath,
} from "./math";
import "./orbit.css";

const BODIES = orbitBodies();
const VW = 640;
const VH = 640;

export function OrbitFace(props: FaceProps): JSX.Element {
  const box = resolveFaceBox(props.size);
  const progress = clampProgress(props.progress);
  const kills = clampKillCount(props.killCount);
  const locked = progress >= 0.995;
  const cx = VW / 2;
  const cy = VH / 2 + 18;
  const outer = 214;
  const inner = 78;
  const radii = ringRadii(BODIES.length, inner, outer);
  const tick = polar(cx, cy, outer + 22, ALIGN_ANGLE);

  const style = {
    width: box.width,
    height: box.height,
    "--fp-orbit-p": String(progress),
  } as CSSProperties;

  return (
    <div
      className="fp-orbit"
      style={style}
      role="img"
      aria-label={`Orbit ${Math.round(progress * 100)} percent. ${locked ? "Bodies aligned." : "Bodies converging."}`}
      data-face="orbit"
      data-phase={props.phase}
      data-locked={locked ? "1" : "0"}
    >
      <svg
        className="fp-orbit-svg"
        viewBox={`0 0 ${VW} ${VH}`}
        width={box.width}
        height={box.height}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="fp-orbit-void" cx="50%" cy="48%" r="62%">
            <stop offset="0" stopColor="#181c2a" />
            <stop offset="0.55" stopColor="#0a0c12" />
            <stop offset="1" stopColor="#05060a" />
          </radialGradient>
          <filter id="fp-orbit-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={VW} height={VH} fill="url(#fp-orbit-void)" />

        <line x1={cx} y1={cy - outer - 28} x2={cx} y2={cy + outer + 8} stroke={locked ? "rgba(212,255,58,0.16)" : "rgba(238,242,248,0.06)"} strokeWidth="2" strokeDasharray="4 10" />
        <line x1={cx} y1={cy - outer - 28} x2={cx} y2={cy - outer + 6} stroke={locked ? "#d4ff3a" : "rgba(238,242,248,0.55)"} strokeWidth="2" />
        <polygon
          points={`${tick.x},${tick.y - 7} ${tick.x - 6},${tick.y + 4} ${tick.x + 6},${tick.y + 4}`}
          fill={locked ? "#d4ff3a" : "#eef2f8"}
        />

        {radii.map((radius, i) => {
          const ghost = polar(cx, cy, radius, ALIGN_ANGLE);
          return (
            <g key={`ring-${i}`}>
              <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(170,190,220,0.22)" strokeWidth="1.25" />
              <circle cx={ghost.x} cy={ghost.y} r={3} fill={locked ? "#d4ff3a" : "rgba(238,242,248,0.28)"} />
            </g>
          );
        })}

        {BODIES.map((body) => {
          const radius = radii[body.index] ?? outer;
          const angle = bodyAngle(body.startAngle, body.turns, progress);
          const pos = polar(cx, cy, radius, angle);
          const sweep = 0.95 + body.turns * 0.08;
          return (
            <g key={body.index}>
              <path
                d={trailPath(cx, cy, radius, angle, sweep)}
                fill="none"
                stroke={body.hue}
                strokeWidth="5"
                strokeLinecap="round"
                opacity={locked ? 0.18 : 0.28}
              />
              <path
                d={trailPath(cx, cy, radius, angle, sweep * 0.42)}
                fill="none"
                stroke={body.hue}
                strokeWidth="3.2"
                strokeLinecap="round"
                opacity={locked ? 0.35 : 0.7}
              />
              <circle cx={pos.x} cy={pos.y} r={locked ? 12 : 10} fill={body.glow} filter="url(#fp-orbit-glow)" />
              <circle cx={pos.x} cy={pos.y} r={locked ? 7 : 6} fill={body.hue} stroke="#07080c" strokeWidth="1.1" />
            </g>
          );
        })}

        <text x={28} y={36} className="fp-orbit-kicker" fill="rgba(155,166,184,0.85)">
          CONJUNCTION
        </text>
        <text x={28} y={66} className="fp-orbit-title" fill="#eef2f8">
          {locked ? "LOCK" : "ALIGN"}
        </text>
        <text x={VW - 28} y={36} textAnchor="end" className="fp-orbit-kicker" fill="rgba(155,166,184,0.85)">
          {BODIES.length} BODIES · {BODIES.map((b) => b.turns).join(" / ")} TURNS
        </text>
        <text x={VW - 28} y={66} textAnchor="end" className="fp-orbit-readout" fill={locked ? "#d4ff3a" : "#eef2f8"}>
          {Math.round(progress * 100)}%
        </text>
        <text x={28} y={VH - 22} className="fp-orbit-kicker" fill={kills > 0 ? "rgba(255,45,85,0.75)" : "rgba(155,166,184,0.6)"}>
          {kills > 0 ? `${kills} KILL${kills === 1 ? "" : "S"}` : "MEET AT 12 O'CLOCK"}
        </text>
      </svg>
    </div>
  );
}
