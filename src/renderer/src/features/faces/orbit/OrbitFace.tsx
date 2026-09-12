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

export function OrbitFace(props: FaceProps): JSX.Element {
  const box = resolveFaceBox(props.size);
  const progress = clampProgress(props.progress);
  const kills = clampKillCount(props.killCount);
  const locked = progress >= 0.995;
  const cx = box.width / 2;
  const cy = box.height / 2 + 6;
  const outer = Math.min(box.width, box.height) * 0.38;
  const inner = outer * 0.34;
  const radii = ringRadii(BODIES.length, inner, outer);
  const tick = polar(cx, cy, outer + 16, ALIGN_ANGLE);

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
        viewBox={`0 0 ${box.width} ${box.height}`}
        width={box.width}
        height={box.height}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="fp-orbit-void" cx="50%" cy="48%" r="62%">
            <stop offset="0" stopColor="#141825" />
            <stop offset="0.55" stopColor="#0a0c12" />
            <stop offset="1" stopColor="#05060a" />
          </radialGradient>
          <filter id="fp-orbit-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={box.width} height={box.height} fill="url(#fp-orbit-void)" />

        <line
          x1={cx}
          y1={cy - outer - 22}
          x2={cx}
          y2={cy - outer + 4}
          stroke={locked ? "#d4ff3a" : "rgba(238,242,248,0.35)"}
          strokeWidth="1.5"
        />
        <polygon
          points={`${tick.x},${tick.y - 5} ${tick.x - 4.5},${tick.y + 3} ${tick.x + 4.5},${tick.y + 3}`}
          fill={locked ? "#d4ff3a" : "rgba(238,242,248,0.55)"}
        />

        {radii.map((radius, i) => (
          <circle
            key={`ring-${i}`}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="rgba(170,190,220,0.16)"
            strokeWidth="1"
          />
        ))}

        {BODIES.map((body) => {
          const radius = radii[body.index] ?? outer;
          const angle = bodyAngle(body.startAngle, body.turns, progress);
          const pos = polar(cx, cy, radius, angle);
          const sweep = 0.55 + body.turns * 0.045;
          return (
            <g key={body.index}>
              <path
                d={trailPath(cx, cy, radius, angle, sweep)}
                fill="none"
                stroke={body.hue}
                strokeWidth="2.4"
                strokeLinecap="round"
                opacity={locked ? 0.2 : 0.38}
              />
              <circle cx={pos.x} cy={pos.y} r={locked ? 8 : 6.2} fill={body.glow} filter="url(#fp-orbit-glow)" />
              <circle
                cx={pos.x}
                cy={pos.y}
                r={locked ? 5.2 : 4.1}
                fill={body.hue}
                stroke="rgba(7,8,12,0.55)"
                strokeWidth="0.8"
              />
            </g>
          );
        })}

        <text x={24} y={28} className="fp-orbit-kicker" fill="rgba(155,166,184,0.8)">
          CONJUNCTION
        </text>
        <text x={24} y={52} className="fp-orbit-title" fill="#eef2f8">
          {locked ? "LOCK" : "ALIGN"}
        </text>
        <text
          x={box.width - 24}
          y={28}
          textAnchor="end"
          className="fp-orbit-kicker"
          fill="rgba(155,166,184,0.8)"
        >
          {BODIES.length} BODIES · {BODIES.map((b) => b.turns).join(" / ")} TURNS
        </text>
        <text
          x={box.width - 24}
          y={52}
          textAnchor="end"
          className="fp-orbit-readout"
          fill={locked ? "#d4ff3a" : "#eef2f8"}
        >
          {Math.round(progress * 100)}%
        </text>
        {kills > 0 ? (
          <text x={24} y={box.height - 18} className="fp-orbit-kicker" fill="rgba(255,45,85,0.7)">
            {kills} KILL{kills === 1 ? "" : "S"}
          </text>
        ) : (
          <text x={24} y={box.height - 18} className="fp-orbit-kicker" fill="rgba(155,166,184,0.55)">
            MEET AT 12 O'CLOCK
          </text>
        )}
      </svg>
    </div>
  );
}
