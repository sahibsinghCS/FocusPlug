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
  DEAD_TRACES,
  viaPoints,
} from "./path";
import "./circuit.css";

const VIAS = viaPoints(CIRCUIT_POINTS);
const KEY_PADS = [CIRCUIT_POINTS[1], CIRCUIT_POINTS[5], CIRCUIT_POINTS[9], CIRCUIT_END].filter(
  (pt): pt is { x: number; y: number } => pt !== undefined,
);

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
          <pattern id="fp-circuit-grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.85" fill="rgba(90, 160, 110, 0.2)" />
          </pattern>
          <pattern id="fp-circuit-weave" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 8 L8 0" stroke="rgba(40,90,55,0.18)" strokeWidth="0.6" />
          </pattern>
          <filter id="fp-circuit-blur" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.4" />
          </filter>
          <filter id="fp-circuit-led" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="fp-circuit-wash" cx="28%" cy="18%" r="80%">
            <stop offset="0" stopColor="#1a3a26" />
            <stop offset="0.5" stopColor="#0c1a12" />
            <stop offset="1" stopColor="#07080c" />
          </radialGradient>
        </defs>

        <rect width={CIRCUIT_VIEW.width} height={CIRCUIT_VIEW.height} fill="url(#fp-circuit-wash)" />
        <rect width={CIRCUIT_VIEW.width} height={CIRCUIT_VIEW.height} fill="url(#fp-circuit-weave)" />
        <rect width={CIRCUIT_VIEW.width} height={CIRCUIT_VIEW.height} fill="url(#fp-circuit-grid)" />
        <rect
          x="16"
          y="14"
          width={CIRCUIT_VIEW.width - 32}
          height={CIRCUIT_VIEW.height - 28}
          rx="10"
          fill="none"
          stroke="rgba(90, 160, 110, 0.32)"
          strokeWidth="1.4"
        />

        <MountHole cx={38} cy={36} />
        <MountHole cx={CIRCUIT_VIEW.width - 38} cy={36} />
        <MountHole cx={38} cy={CIRCUIT_VIEW.height - 36} />
        <MountHole cx={CIRCUIT_VIEW.width - 38} cy={CIRCUIT_VIEW.height - 36} />

        <text x={62} y={50} className="fp-circuit-word" fill="#eef2f8">
          FocusPlug
        </text>
        <text x={62} y={74} className="fp-circuit-silk" fill="rgba(155,166,184,0.75)">
          FUSE RAIL · REV C
        </text>
        <text
          x={CIRCUIT_VIEW.width - 62}
          y={50}
          textAnchor="end"
          className="fp-circuit-readout"
          fill={complete ? "#d4ff3a" : "#eef2f8"}
        >
          {Math.round(progress * 100)}%
        </text>
        <text
          x={CIRCUIT_VIEW.width - 62}
          y={74}
          textAnchor="end"
          className="fp-circuit-silk"
          fill={complete ? "#d4ff3a" : "rgba(155,166,184,0.75)"}
        >
          {complete ? "LOCK" : "ARMING"}
        </text>

        <text x={62} y={118} className="fp-circuit-silk" fill="rgba(212,180,106,0.78)">
          PLUG
        </text>
        <text x={248} y={118} className="fp-circuit-silk" fill="rgba(155,166,184,0.5)">
          12V
        </text>
        <text x={388} y={168} className="fp-circuit-silk" fill="rgba(155,166,184,0.55)">
          FUSE
        </text>
        <text x={610} y={118} className="fp-circuit-silk" fill="rgba(155,166,184,0.5)">
          GND
        </text>
        <text x={808} y={126} className="fp-circuit-silk" fill="rgba(155,166,184,0.55)">
          LED
        </text>
        <text x={62} y={510} className="fp-circuit-silk" fill="rgba(155,166,184,0.48)">
          NEVER POWER OFF THE STUDY PC
        </text>
        <text
          x={CIRCUIT_VIEW.width - 62}
          y={510}
          textAnchor="end"
          className="fp-circuit-silk"
          fill="rgba(155,166,184,0.48)"
        >
          {kills > 0 ? `${kills} KILL${kills === 1 ? "" : "S"} LOGGED` : "KILL RAIL STANDBY"}
        </text>

        {DEAD_TRACES.map((d) => (
          <path key={d} d={d} className="fp-circuit-dead" />
        ))}

        <Chip x={300} y={400} />
        <PlugHeader origin={CIRCUIT_START} />
        <FuseBody x={420} y={280} />

        <path d={CIRCUIT_D} className="fp-circuit-trace" />
        <path d={CIRCUIT_D} className="fp-circuit-glow" />
        <path d={CIRCUIT_D} className="fp-circuit-live" />
        <path d={CIRCUIT_D} className="fp-circuit-head" />

        {KEY_PADS.map((pt, i) => (
          <rect
            key={`pad-${i}`}
            x={pt.x - 8}
            y={pt.y - 8}
            width="16"
            height="16"
            rx="2"
            fill="#d4b46a"
            stroke="#8a7038"
            strokeWidth="1"
          />
        ))}

        {VIAS.map((pt, i) => (
          <g key={`via-${i}`}>
            <circle cx={pt.x} cy={pt.y} r="8" fill="#c9a24a" stroke="#8a7038" strokeWidth="1.1" />
            <circle cx={pt.x} cy={pt.y} r="3.4" fill="#0a120e" />
          </g>
        ))}

        {[
          { x: 200, y: 470 },
          { x: 350, y: 500 },
          { x: 800, y: 390 },
          { x: 300, y: 130 },
          { x: 620, y: 70 },
        ].map((pt) => (
          <g key={`dead-via-${pt.x}-${pt.y}`}>
            <circle cx={pt.x} cy={pt.y} r="6" fill="#b89240" stroke="#7a6230" strokeWidth="1" />
            <circle cx={pt.x} cy={pt.y} r="2.6" fill="#0a120e" />
          </g>
        ))}

        <g filter="url(#fp-circuit-led)">
          <circle cx={CIRCUIT_END.x + 30} cy={CIRCUIT_END.y} r="17" className="fp-circuit-led-core" />
          <circle cx={CIRCUIT_END.x + 24} cy={CIRCUIT_END.y - 6} r="4.5" fill="rgba(255,255,255,0.42)" />
        </g>
        <rect
          x={CIRCUIT_END.x + 12}
          y={CIRCUIT_END.y - 24}
          width="38"
          height="48"
          rx="4"
          fill="none"
          stroke="rgba(212,180,106,0.6)"
          strokeWidth="1.3"
        />
      </svg>
    </div>
  );
}

function MountHole(props: { cx: number; cy: number }): JSX.Element {
  return (
    <g>
      <circle cx={props.cx} cy={props.cy} r="9" fill="none" stroke="#2f4f3c" strokeWidth="3.2" />
      <circle cx={props.cx} cy={props.cy} r="3.4" fill="#050806" />
    </g>
  );
}

function PlugHeader(props: { origin: { x: number; y: number } }): JSX.Element {
  const { x, y } = props.origin;
  return (
    <g>
      <rect x={x - 58} y={y - 50} width="50" height="100" rx="5" fill="#101812" stroke="#d4b46a" strokeWidth="1.8" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={x - 48} y={y - 34 + i * 24} width="30" height="12" rx="1.5" fill="#d4b46a" />
      ))}
    </g>
  );
}

function FuseBody(props: { x: number; y: number }): JSX.Element {
  return (
    <g>
      <rect x={props.x - 10} y={props.y - 18} width="12" height="36" rx="2" fill="#d4b46a" />
      <rect x={props.x + 98} y={props.y - 18} width="12" height="36" rx="2" fill="#d4b46a" />
      <rect
        x={props.x + 2}
        y={props.y - 22}
        width="96"
        height="44"
        rx="12"
        fill="rgba(180, 220, 200, 0.08)"
        stroke="rgba(212,180,106,0.55)"
        strokeWidth="1.5"
      />
      <path
        d={`M ${props.x + 16} ${props.y} C ${props.x + 34} ${props.y - 14}, ${props.x + 52} ${props.y + 14}, ${props.x + 70} ${props.y}`}
        fill="none"
        stroke="#d4b46a"
        strokeWidth="2.4"
      />
    </g>
  );
}

function Chip(props: { x: number; y: number }): JSX.Element {
  const pins = [0, 1, 2, 3, 4];
  return (
    <g>
      <rect x={props.x} y={props.y} width="88" height="52" rx="3" fill="#12160f" stroke="#8a9a70" strokeWidth="1.3" />
      <circle cx={props.x + 10} cy={props.y + 10} r="2.4" fill="#d4ff3a" />
      <text x={props.x + 18} y={props.y + 32} className="fp-circuit-silk" fill="rgba(155,166,184,0.55)">
        U1
      </text>
      {pins.map((i) => (
        <g key={i}>
          <rect x={props.x - 10} y={props.y + 6 + i * 8} width="10" height="4" fill="#d4b46a" />
          <rect x={props.x + 88} y={props.y + 6 + i * 8} width="10" height="4" fill="#d4b46a" />
        </g>
      ))}
    </g>
  );
}
