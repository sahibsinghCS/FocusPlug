import type { CSSProperties, JSX } from "react";
import { clampKillCount, clampProgress, resolveFaceBox } from "../clamp";
import type { VisualFaceProps } from "../visual";
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
const VW = 1280;
const VH = 380;

export function OrbitFace(props: VisualFaceProps): JSX.Element {
  const box = resolveFaceBox(props.size);
  const progress = clampProgress(props.progress);
  const kills = clampKillCount(props.killCount);
  const locked = progress >= 0.995;
  const cx = 640;
  const cy = 198;
  const outer = 148;
  const inner = 48;
  const radii = ringRadii(BODIES.length, inner, outer);
  const tick = polar(cx, cy, outer + 18, ALIGN_ANGLE);

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
      data-face-status="ready"
      data-phase={props.phase}
      data-locked={locked ? "1" : "0"}
    >
      <svg
        className="fp-orbit-svg"
        viewBox={`0 0 ${VW} ${VH}`}
        width={box.width}
        height={box.height}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="fp-orbit-void" cx="50%" cy="52%" r="58%">
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

        <circle cx={cx} cy={cy} r={outer + 22} fill="none" stroke="rgba(170,190,220,0.16)" strokeWidth="8" />
        <circle
          cx={cx}
          cy={cy}
          r={outer + 22}
          fill="none"
          stroke={locked ? "#d4ff3a" : "#7aa2ff"}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(outer + 22) * Math.PI * 2}`}
          strokeDashoffset={`${(outer + 22) * Math.PI * 2 * (1 - progress)}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />

        <line
          x1={cx}
          y1={cy - outer - 28}
          x2={cx}
          y2={cy + outer + 6}
          stroke={locked ? "rgba(212,255,58,0.2)" : "rgba(238,242,248,0.08)"}
          strokeWidth="2"
          strokeDasharray="4 10"
        />
        <rect
          x={cx - 22}
          y={cy - outer - 40}
          width="44"
          height="18"
          rx="4"
          fill={locked ? "#d4ff3a" : "#161a24"}
          stroke={locked ? "#d4ff3a" : "rgba(238,242,248,0.45)"}
        />
        <text x={cx} y={cy - outer - 27} textAnchor="middle" className="fp-orbit-locktag" fill={locked ? "#07080c" : "#eef2f8"}>
          LOCK
        </text>
        <polygon
          points={`${tick.x},${tick.y - 6} ${tick.x - 5},${tick.y + 4} ${tick.x + 5},${tick.y + 4}`}
          fill={locked ? "#d4ff3a" : "#eef2f8"}
        />

        {radii.map((radius, i) => {
          const ghost = polar(cx, cy, radius, ALIGN_ANGLE);
          return (
            <g key={`ring-${i}`}>
              <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(170,190,220,0.26)" strokeWidth="1.3" />
              <circle cx={ghost.x} cy={ghost.y} r={3.4} fill={locked ? "#d4ff3a" : "rgba(212,255,58,0.45)"} />
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
                strokeWidth="4.5"
                strokeLinecap="round"
                opacity={locked ? 0.18 : 0.28}
              />
              <path
                d={trailPath(cx, cy, radius, angle, sweep * 0.42)}
                fill="none"
                stroke={body.hue}
                strokeWidth="3"
                strokeLinecap="round"
                opacity={locked ? 0.35 : 0.7}
              />
              <circle cx={pos.x} cy={pos.y} r={locked ? 11 : 9} fill={body.glow} filter="url(#fp-orbit-glow)" />
              <circle cx={pos.x} cy={pos.y} r={locked ? 6.5 : 5.5} fill={body.hue} stroke="#07080c" strokeWidth="1.1" />
            </g>
          );
        })}

        <text x={36} y={42} className="fp-orbit-kicker" fill="rgba(155,166,184,0.85)">
          CONJUNCTION
        </text>
        <text x={36} y={76} className="fp-orbit-title" fill="#eef2f8">
          {locked ? "LOCK" : "ALIGN"}
        </text>
        <text x={36} y={VH - 28} className="fp-orbit-kicker" fill={kills > 0 ? "rgba(255,45,85,0.75)" : "rgba(155,166,184,0.6)"}>
          {kills > 0 ? `${kills} KILL${kills === 1 ? "" : "S"}` : "MEET AT 12 O'CLOCK"}
        </text>

        <text x={VW - 36} y={42} textAnchor="end" className="fp-orbit-kicker" fill="rgba(155,166,184,0.85)">
          {BODIES.length} BODIES · {BODIES.map((b) => b.turns).join(" / ")} TURNS
        </text>
        <text x={VW - 36} y={76} textAnchor="end" className="fp-orbit-readout" fill={locked ? "#d4ff3a" : "#eef2f8"}>
          {Math.round(progress * 100)}%
        </text>
      </svg>
    </div>
  );
}
