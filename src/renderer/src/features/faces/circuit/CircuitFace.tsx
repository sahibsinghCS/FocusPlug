import type { CSSProperties, JSX } from "react";
import { clampKillCount, clampProgress, resolveFaceBox } from "../clamp";
import type { FaceProps } from "../types";
import {
  CIRCUIT_D,
  CIRCUIT_END,
  CIRCUIT_LENGTH,
  CIRCUIT_POINTS,
  CIRCUIT_START,
  CIRCUIT_VIEW,
  viaPoints,
} from "./path";
import "./circuit.css";

const VIAS = viaPoints(CIRCUIT_POINTS);

export function CircuitFace(props: FaceProps): JSX.Element {
  const box = resolveFaceBox(props.size);
  const progress = clampProgress(props.progress);
  const kills = clampKillCount(props.killCount);
  const complete = progress >= 0.995;
  const style = {
    width: box.width,
    height: box.height,
    "--circuit-progress": String(progress),
    "--circuit-length": String(CIRCUIT_LENGTH),
  } as CSSProperties;

  return (
    <div
      className="fp-circuit"
      style={style}
      role="img"
      aria-label={`Circuit ${Math.round(progress * 100)} percent. ${complete ? "Fuse locked, LED green." : "Current charging the fuse rail."}`}
      data-face="circuit"
      data-phase={props.phase}
      data-complete={complete ? "1" : "0"}
    >
      <svg
        className="fp-circuit-svg"
        viewBox={`0 0 ${CIRCUIT_VIEW.width} ${CIRCUIT_VIEW.height}`}
        width={box.width}
        height={box.height}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <pattern id="fp-circuit-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.7" fill="rgba(80, 140, 100, 0.16)" />
          </pattern>
          <filter id="fp-circuit-blur" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <filter id="fp-circuit-led" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="fp-circuit-wash" cx="30%" cy="20%" r="80%">
            <stop offset="0" stopColor="#163322" />
            <stop offset="0.55" stopColor="#0b1610" />
            <stop offset="1" stopColor="#07080c" />
          </radialGradient>
        </defs>

        <rect width={CIRCUIT_VIEW.width} height={CIRCUIT_VIEW.height} fill="url(#fp-circuit-wash)" />
        <rect width={CIRCUIT_VIEW.width} height={CIRCUIT_VIEW.height} fill="url(#fp-circuit-grid)" />
        <rect
          x="18"
          y="16"
          width={CIRCUIT_VIEW.width - 36}
          height={CIRCUIT_VIEW.height - 32}
          rx="10"
          fill="none"
          stroke="rgba(80, 140, 100, 0.28)"
          strokeWidth="1.25"
        />

        <circle cx="40" cy="38" r="7" fill="none" stroke="#2a4a38" strokeWidth="3" />
        <circle cx={CIRCUIT_VIEW.width - 40} cy="38" r="7" fill="none" stroke="#2a4a38" strokeWidth="3" />
        <circle cx="40" cy={CIRCUIT_VIEW.height - 38} r="7" fill="none" stroke="#2a4a38" strokeWidth="3" />
        <circle
          cx={CIRCUIT_VIEW.width - 40}
          cy={CIRCUIT_VIEW.height - 38}
          r="7"
          fill="none"
          stroke="#2a4a38"
          strokeWidth="3"
        />

        <text x="64" y="48" className="fp-circuit-word" fill="#eef2f8">
          FocusPlug
        </text>
        <text x="64" y="70" className="fp-circuit-silk" fill="rgba(155,166,184,0.72)">
          FUSE RAIL · REV C
        </text>
        <text
          x={CIRCUIT_VIEW.width - 64}
          y="48"
          textAnchor="end"
          className="fp-circuit-readout"
          fill={complete ? "#d4ff3a" : "#eef2f8"}
        >
          {Math.round(progress * 100)}%
        </text>
        <text
          x={CIRCUIT_VIEW.width - 64}
          y="70"
          textAnchor="end"
          className="fp-circuit-silk"
          fill="rgba(155,166,184,0.72)"
        >
          {complete ? "LOCK" : "ARMING"}
        </text>

        <text x="64" y="118" className="fp-circuit-silk" fill="rgba(212,180,106,0.7)">
          PLUG
        </text>
        <text x="390" y="168" className="fp-circuit-silk" fill="rgba(155,166,184,0.55)">
          FUSE
        </text>
        <text x="820" y="128" className="fp-circuit-silk" fill="rgba(155,166,184,0.55)">
          LED
        </text>
        <text x="64" y="508" className="fp-circuit-silk" fill="rgba(155,166,184,0.45)">
          NEVER POWER OFF THE STUDY PC
        </text>
        <text
          x={CIRCUIT_VIEW.width - 64}
          y="508"
          textAnchor="end"
          className="fp-circuit-silk"
          fill="rgba(155,166,184,0.45)"
        >
          {kills > 0 ? `${kills} KILL${kills === 1 ? "" : "S"} LOGGED` : "KILL RAIL STANDBY"}
        </text>

        <PlugHeader origin={CIRCUIT_START} />
        <FuseBody x={420} y={280} />

        <path d={CIRCUIT_D} className="fp-circuit-trace" />
        <path d={CIRCUIT_D} className="fp-circuit-glow" />
        <path d={CIRCUIT_D} className="fp-circuit-live" />
        <path d={CIRCUIT_D} className="fp-circuit-head" />

        {CIRCUIT_POINTS.map((pt, i) => (
          <rect
            key={`pad-${i}`}
            x={pt.x - 7}
            y={pt.y - 7}
            width="14"
            height="14"
            rx="1.5"
            fill="#d4b46a"
            stroke="#8a7038"
            strokeWidth="0.8"
          />
        ))}

        {VIAS.map((pt, i) => (
          <g key={`via-${i}`}>
            <circle cx={pt.x} cy={pt.y} r="7" fill="#c9a24a" stroke="#8a7038" strokeWidth="1" />
            <circle cx={pt.x} cy={pt.y} r="3.1" fill="#0a120e" />
          </g>
        ))}

        <g filter="url(#fp-circuit-led)">
          <circle cx={CIRCUIT_END.x + 28} cy={CIRCUIT_END.y} r="16" className="fp-circuit-led-core" />
          <circle
            cx={CIRCUIT_END.x + 22}
            cy={CIRCUIT_END.y - 5}
            r="4"
            fill="rgba(255,255,255,0.45)"
          />
        </g>
        <rect
          x={CIRCUIT_END.x + 10}
          y={CIRCUIT_END.y - 22}
          width="36"
          height="44"
          rx="4"
          fill="none"
          stroke="rgba(212,180,106,0.55)"
          strokeWidth="1.2"
        />
      </svg>
    </div>
  );
}

function PlugHeader(props: { origin: { x: number; y: number } }): JSX.Element {
  const { x, y } = props.origin;
  return (
    <g>
      <rect x={x - 54} y={y - 46} width="44" height="92" rx="4" fill="#121a16" stroke="#d4b46a" strokeWidth="1.6" />
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={x - 46}
          y={y - 32 + i * 22}
          width="28"
          height="10"
          rx="1"
          fill="#d4b46a"
        />
      ))}
    </g>
  );
}

function FuseBody(props: { x: number; y: number }): JSX.Element {
  return (
    <g>
      <rect
        x={props.x - 18}
        y={props.y - 28}
        width="136"
        height="56"
        rx="8"
        fill="rgba(10, 18, 14, 0.55)"
        stroke="rgba(212,180,106,0.45)"
        strokeWidth="1.4"
      />
      <path
        d={`M ${props.x + 8} ${props.y} C ${props.x + 28} ${props.y - 16}, ${props.x + 48} ${props.y + 16}, ${props.x + 70} ${props.y} S ${props.x + 100} ${props.y - 12}, ${props.x + 112} ${props.y}`}
        fill="none"
        stroke="#d4b46a"
        strokeWidth="2.2"
      />
    </g>
  );
}
