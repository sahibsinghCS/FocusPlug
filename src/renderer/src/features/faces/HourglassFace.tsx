import type { JSX } from "react";
import { clamp01 } from "./clock";
import type { FaceProps } from "./types";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function halfWidthAt(y: number, yNeck: number, yRim: number, neck: number, rim: number): number {
  const t = clamp01((yNeck - y) / (yNeck - yRim));
  return lerp(neck, rim, t);
}

function topSandPath(fill: number): string {
  const remaining = clamp01(fill);
  if (remaining <= 0.001) {
    return "";
  }
  const yNeck = 168;
  const yRim = 58;
  const yTop = lerp(yNeck - 3, yRim, remaining);
  const neck = 5;
  const rim = 58;
  const xL = 200 - halfWidthAt(yTop, yNeck, yRim, neck, rim);
  const xR = 200 + halfWidthAt(yTop, yNeck, yRim, neck, rim);
  return `M ${200 - neck} ${yNeck} L ${200 + neck} ${yNeck} L ${xR} ${yTop} L ${xL} ${yTop} Z`;
}

function bottomSandPath(fill: number): string {
  const piled = clamp01(fill);
  if (piled <= 0.001) {
    return "";
  }
  const yFloor = 282;
  const yNeck = 176;
  const yPeak = lerp(yFloor, yNeck + 4, piled);
  const floor = 62;
  const neck = 6;
  const t = clamp01((yFloor - yPeak) / (yFloor - yNeck));
  const half = lerp(floor, neck, t);
  return `M ${200 - floor} ${yFloor} L ${200 + floor} ${yFloor} L ${200 + half} ${yPeak} L ${200 - half} ${yPeak} Z`;
}

export function HourglassFace(props: FaceProps): JSX.Element {
  const progress = clamp01(props.progress);
  const top = topSandPath(1 - progress);
  const bottom = bottomSandPath(progress);
  const flowing = props.phase !== "idle" && progress > 0.01 && progress < 0.99;
  const phaseClass =
    props.phase === "focus" ? "is-focus" : props.phase === "break" ? "is-break" : "is-idle";

  return (
    <div
      className={`fp-hourglass ${phaseClass}`}
      data-face="hourglass"
      data-face-status="ready"
      data-phase={props.phase}
    >
      <div className="fp-hourglass-room" aria-hidden="true" />
      <div className="fp-hourglass-motes" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <svg
        className="fp-hourglass-svg"
        viewBox="0 0 400 340"
        role="img"
        aria-label={`Hourglass ${Math.round(progress * 100)} percent transferred, ${props.phase}`}
      >
        <defs>
          <radialGradient id="fp-hg-glow" cx="50%" cy="58%" r="42%">
            <stop offset="0%" stopColor="#c9a36a" stopOpacity="0.28" />
            <stop offset="55%" stopColor="#3a2a16" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#05060a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="fp-hg-wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6d5336" />
            <stop offset="45%" stopColor="#3d2c1c" />
            <stop offset="100%" stopColor="#24180f" />
          </linearGradient>
          <linearGradient id="fp-hg-brass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8a6a3a" />
            <stop offset="50%" stopColor="#e2c27a" />
            <stop offset="100%" stopColor="#6a4e28" />
          </linearGradient>
          <linearGradient id="fp-hg-sand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0d392" />
            <stop offset="55%" stopColor="#c4a05a" />
            <stop offset="100%" stopColor="#8a6a32" />
          </linearGradient>
          <linearGradient id="fp-hg-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e8eef8" stopOpacity="0.16" />
            <stop offset="50%" stopColor="#9ab0c8" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#e8eef8" stopOpacity="0.1" />
          </linearGradient>
          <clipPath id="fp-hg-glass-clip">
            <path d="M142 52 C142 52 258 52 258 52 C236 118 214 150 205 168 C214 186 236 218 258 284 C258 284 142 284 142 284 C164 218 186 186 195 168 C186 150 164 118 142 52 Z" />
          </clipPath>
        </defs>

        <rect width="400" height="340" fill="url(#fp-hg-glow)" />
        <ellipse cx="200" cy="308" rx="92" ry="10" fill="#000" opacity="0.45" />

        <rect x="118" y="36" width="164" height="14" rx="3" fill="url(#fp-hg-wood)" />
        <rect x="118" y="290" width="164" height="16" rx="3" fill="url(#fp-hg-wood)" />
        <rect x="128" y="34" width="144" height="5" rx="1.5" fill="url(#fp-hg-brass)" />
        <rect x="128" y="303" width="144" height="5" rx="1.5" fill="url(#fp-hg-brass)" />
        <rect x="124" y="48" width="10" height="244" rx="2" fill="url(#fp-hg-wood)" />
        <rect x="266" y="48" width="10" height="244" rx="2" fill="url(#fp-hg-wood)" />

        <g clipPath="url(#fp-hg-glass-clip)">
          {bottom ? <path d={bottom} fill="url(#fp-hg-sand)" /> : null}
          {top ? <path d={top} fill="url(#fp-hg-sand)" /> : null}
          {flowing ? (
            <g className="fp-hourglass-stream">
              <rect x="198.4" y="166" width="3.2" height="16" fill="#e8c878" />
              <circle cx="200" cy="174" r="1.3" fill="#f6e2a8" />
              <circle className="fp-hourglass-grain" cx="199.2" cy="180" r="1.1" fill="#d4b46a" />
              <circle className="fp-hourglass-grain g2" cx="200.8" cy="186" r="0.9" fill="#f0d392" />
            </g>
          ) : null}
        </g>

        <path
          d="M142 52 C142 52 258 52 258 52 C236 118 214 150 205 168 C214 186 236 218 258 284 C258 284 142 284 142 284 C164 218 186 186 195 168 C186 150 164 118 142 52 Z"
          fill="url(#fp-hg-glass)"
          stroke="rgba(232,220,190,0.38)"
          strokeWidth="1.4"
        />
        <path
          d="M150 64 C168 70 186 74 200 74 C214 74 232 70 250 64"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1.1"
          fill="none"
        />
        <path
          d="M196 168 H204"
          stroke="rgba(232,220,190,0.55)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <div className="fp-hourglass-meta">
        <p className="fp-hourglass-kicker">{props.phase === "idle" ? "At rest" : "Sand"}</p>
        <p className="fp-hourglass-read">{Math.round(progress * 100)}% transferred</p>
      </div>
    </div>
  );
}
