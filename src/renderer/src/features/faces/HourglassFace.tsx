import type { JSX } from "react";
import { clamp01 } from "./clock";
import type { FaceProps } from "./types";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const TOP_CHAMBER =
  "M122 30 L278 30 C250 88 222 128 207 146 L193 146 C178 128 150 88 122 30 Z";
const BOTTOM_CHAMBER =
  "M193 158 L207 158 C222 176 250 216 278 274 L122 274 C150 216 178 176 193 158 Z";

export function HourglassFace(props: FaceProps): JSX.Element {
  const progress = clamp01(props.progress);
  const topRemain = progress >= 0.999 ? 0 : Math.max(0.12, 1 - progress);
  const bottomPile = progress <= 0.001 ? 0 : Math.max(0.12, progress);
  const topSurface = lerp(146, 32, topRemain);
  const bottomPeak = lerp(272, 160, bottomPile);
  const flowing = props.phase !== "idle" && progress < 0.99;
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
        viewBox="0 0 400 300"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Hourglass ${Math.round(progress * 100)} percent transferred, ${props.phase}`}
      >
        <defs>
          <radialGradient id="fp-hg-glow" cx="50%" cy="54%" r="40%">
            <stop offset="0%" stopColor="#f0c56a" stopOpacity="0.5" />
            <stop offset="45%" stopColor="#8a5a20" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#05060a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="fp-hg-wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d2b07a" />
            <stop offset="45%" stopColor="#8a6238" />
            <stop offset="100%" stopColor="#4a3018" />
          </linearGradient>
          <linearGradient id="fp-hg-brass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8a6028" />
            <stop offset="50%" stopColor="#f0d48a" />
            <stop offset="100%" stopColor="#8a6028" />
          </linearGradient>
          <clipPath id="fp-hg-top-sand">
            <rect x="110" y={topSurface} width="180" height={Math.max(0, 148 - topSurface)} />
          </clipPath>
          <clipPath id="fp-hg-bot-sand">
            <rect x="110" y={bottomPeak} width="180" height={Math.max(0, 276 - bottomPeak)} />
          </clipPath>
        </defs>

        <rect width="400" height="300" fill="url(#fp-hg-glow)" />
        <ellipse cx="200" cy="286" rx="124" ry="12" fill="#000" opacity="0.55" />
        <ellipse cx="200" cy="284" rx="100" ry="7" fill="#5a4018" opacity="0.4" />

        <rect x="92" y="8" width="216" height="18" rx="3" fill="url(#fp-hg-wood)" />
        <rect x="92" y="274" width="216" height="18" rx="3" fill="url(#fp-hg-wood)" />
        <rect x="104" y="6" width="192" height="7" rx="1.5" fill="url(#fp-hg-brass)" />
        <rect x="104" y="285" width="192" height="7" rx="1.5" fill="url(#fp-hg-brass)" />
        <rect x="98" y="22" width="16" height="254" rx="3" fill="url(#fp-hg-wood)" />
        <rect x="286" y="22" width="16" height="254" rx="3" fill="url(#fp-hg-wood)" />
        <rect x="101" y="22" width="5" height="254" fill="#f0d48a" opacity="0.2" />
        <rect x="289" y="22" width="5" height="254" fill="#f0d48a" opacity="0.2" />

        <path d={TOP_CHAMBER} fill="#1a140c" />
        <path d={BOTTOM_CHAMBER} fill="#1a140c" />
        {topRemain > 0 ? <path d={TOP_CHAMBER} fill="#e8b43c" clipPath="url(#fp-hg-top-sand)" /> : null}
        {bottomPile > 0 ? (
          <path d={BOTTOM_CHAMBER} fill="#d4a032" clipPath="url(#fp-hg-bot-sand)" />
        ) : null}
        {flowing ? (
          <g className="fp-hourglass-stream">
            <rect x="196.6" y="146" width="6.8" height="16" fill="#ffe7a0" />
            <circle className="fp-hourglass-grain" cx="198.8" cy="160" r="1.6" fill="#ffe7a0" />
            <circle className="fp-hourglass-grain g2" cx="201.4" cy="166" r="1.3" fill="#e8b43c" />
          </g>
        ) : null}

        <path
          d="M118 24 C118 24 282 24 282 24 C252 96 222 132 208 148 C222 164 252 200 282 272 C282 272 118 272 118 272 C148 200 178 164 192 148 C178 132 148 96 118 24 Z"
          fill="rgba(242,246,255,0.06)"
          stroke="#f0d8a0"
          strokeWidth="2.4"
        />
        <path
          d="M132 40 C156 48 178 52 200 52 C222 52 244 48 268 40"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1.6"
          fill="none"
        />
        <path d="M192 148 H208" stroke="#f0d8a0" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
      <div className="fp-hourglass-meta">
        <p className="fp-hourglass-kicker">{props.phase === "idle" ? "At rest" : "Sand"}</p>
        <p className="fp-hourglass-read">{Math.round(progress * 100)}% transferred</p>
      </div>
    </div>
  );
}
