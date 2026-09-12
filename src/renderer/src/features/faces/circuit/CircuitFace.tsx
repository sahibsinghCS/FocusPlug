import type { CSSProperties, JSX } from "react";
import { clampKillCount, clampProgress, resolveFaceBox } from "../clamp";
import type { VisualFaceProps } from "../visual";
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
const COPY_Y = 344;

export function CircuitFace(props: VisualFaceProps): JSX.Element {
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
      data-face-status="ready"
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
            <circle cx="1" cy="1" r="0.8" fill="rgba(90, 160, 110, 0.16)" />
          </pattern>
          <filter id="fp-circuit-blur" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.6" />
          </filter>
          <filter id="fp-circuit-led" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="fp-circuit-wash" cx="18%" cy="20%" r="82%">
            <stop offset="0" stopColor="#163024" />
            <stop offset="0.55" stopColor="#0b1410" />
            <stop offset="1" stopColor="#07080c" />
          </radialGradient>
        </defs>

        <rect width={CIRCUIT_VIEW.width} height={CIRCUIT_VIEW.height} fill="url(#fp-circuit-wash)" />
        <rect width={CIRCUIT_VIEW.width} height={CIRCUIT_VIEW.height} fill="url(#fp-circuit-grid)" />
        <rect x="0" y="0" width={CIRCUIT_VIEW.width} height="7" fill="#d4ff3a" opacity="0.85" />

        <text x={28} y={42} className="fp-circuit-word" fill="#eef2f8">
          FocusPlug
        </text>
        <text x={28} y={64} className="fp-circuit-silk" fill="#d4ff3a">
          SESSION FUSE
        </text>
        <text
          x={CIRCUIT_VIEW.width - 28}
          y={38}
          textAnchor="end"
          className="fp-circuit-readout"
          fill={complete ? "#d4ff3a" : "#eef2f8"}
        >
          {Math.round(progress * 100)}%
        </text>
        <text
          x={CIRCUIT_VIEW.width - 28}
          y={60}
          textAnchor="end"
          className="fp-circuit-silk"
          fill={complete ? "#d4ff3a" : "#ff2d55"}
        >
          {complete ? "LOCK" : "FUSE LIVE"}
        </text>

        <KillRail x={800} y={208} width={180} />
        <path d={CIRCUIT_D} className="fp-circuit-trace" />
        <path d={CIRCUIT_D} className="fp-circuit-glow" />
        <path d={CIRCUIT_D} className="fp-circuit-live" />
        <path d={CIRCUIT_D} className="fp-circuit-head" />

        <PlugInlet origin={CIRCUIT_START} />
        <HeroFuse x={500} y={168} />

        {VIAS.map((pt, i) => (
          <g key={`via-${i}`}>
            <circle cx={pt.x} cy={pt.y} r="7" fill="#c9a24a" stroke="#8a7038" strokeWidth="1.1" />
            <circle cx={pt.x} cy={pt.y} r="3" fill="#0a120e" />
          </g>
        ))}

        <rect x={CIRCUIT_END.x - 8} y={CIRCUIT_END.y - 8} width="16" height="16" rx="2" fill="#d4b46a" stroke="#8a7038" />

        <g filter="url(#fp-circuit-led)">
          <circle cx={CIRCUIT_END.x + 28} cy={CIRCUIT_END.y} r="16" className="fp-circuit-led-core" />
          <circle cx={CIRCUIT_END.x + 23} cy={CIRCUIT_END.y - 5} r="4.5" fill="rgba(255,255,255,0.4)" />
        </g>
        <text
          x={CIRCUIT_END.x + 28}
          y={CIRCUIT_END.y + 36}
          textAnchor="middle"
          className="fp-circuit-silk"
          fill={complete ? "#d4ff3a" : "#ff2d55"}
        >
          {complete ? "ON" : "ARM"}
        </text>

        <text x={28} y={COPY_Y} className="fp-circuit-silk" fill="rgba(238,242,248,0.55)">
          Force-quit blocked apps · cut armed plugs
        </text>
        <text x={28} y={COPY_Y + 22} className="fp-circuit-silk" fill="rgba(155,166,184,0.5)">
          NEVER POWER OFF THE STUDY PC
        </text>
        <text
          x={CIRCUIT_VIEW.width - 28}
          y={COPY_Y + 22}
          textAnchor="end"
          className="fp-circuit-silk"
          fill="rgba(155,166,184,0.5)"
        >
          {kills > 0 ? `${kills} APP KILL${kills === 1 ? "" : "S"} + PLUGS CUT` : "APP KILL + PLUGS CUT"}
        </text>
      </svg>
    </div>
  );
}

function PlugInlet(props: { origin: { x: number; y: number } }): JSX.Element {
  const { x, y } = props.origin;
  return (
    <g>
      <rect x={x - 86} y={y - 48} width="76" height="96" rx="10" fill="#101812" stroke="#d4b46a" strokeWidth="2" />
      <rect x={x - 60} y={y - 26} width="9" height="18" rx="2" fill="#d4b46a" />
      <rect x={x - 40} y={y - 26} width="9" height="18" rx="2" fill="#d4b46a" />
      <circle cx={x - 46} cy={y + 16} r="6" fill="#d4b46a" />
      <text x={x - 46} y={y + 62} textAnchor="middle" className="fp-circuit-silk" fill="rgba(212,180,106,0.8)">
        PLUG
      </text>
    </g>
  );
}

function HeroFuse(props: { x: number; y: number }): JSX.Element {
  return (
    <g>
      <rect x={props.x - 12} y={props.y - 22} width="14" height="44" rx="3" fill="#d4b46a" />
      <rect x={props.x + 246} y={props.y - 22} width="14" height="44" rx="3" fill="#d4b46a" />
      <rect
        x={props.x + 2}
        y={props.y - 26}
        width={244}
        height="52"
        rx="14"
        fill="rgba(200, 230, 210, 0.07)"
        stroke="rgba(238,242,248,0.35)"
        strokeWidth="1.8"
      />
      <path
        d={`M ${props.x + 22} ${props.y} C ${props.x + 70} ${props.y - 16}, ${props.x + 120} ${props.y + 18}, ${props.x + 168} ${props.y} S ${props.x + 230} ${props.y - 8}, ${props.x + 236} ${props.y}`}
        fill="none"
        stroke="#eef2f8"
        strokeWidth="2.4"
      />
      <text x={props.x + 124} y={props.y - 36} textAnchor="middle" className="fp-circuit-silk" fill="#eef2f8">
        FUSE
      </text>
    </g>
  );
}

function KillRail(props: { x: number; y: number; width: number }): JSX.Element {
  const ticks = [0, 1, 2, 3, 4, 5];
  return (
    <g>
      <rect
        x={props.x - 8}
        y={props.y - 14}
        width={props.width + 16}
        height="28"
        rx="3"
        fill="rgba(212, 255, 58, 0.04)"
        stroke="rgba(212,180,106,0.35)"
        strokeWidth="1.2"
      />
      {ticks.map((i) => (
        <line
          key={i}
          x1={props.x + 14 + i * 28}
          x2={props.x + 14 + i * 28}
          y1={props.y - 8}
          y2={props.y + 8}
          stroke="rgba(212,180,106,0.35)"
          strokeWidth="1.2"
        />
      ))}
      <text x={props.x + props.width / 2} y={props.y + 36} textAnchor="middle" className="fp-circuit-silk" fill="rgba(255,45,85,0.8)">
        KILL RAIL
      </text>
    </g>
  );
}
