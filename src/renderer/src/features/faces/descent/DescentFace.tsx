import type { CSSProperties, JSX } from "react";
import { clampKillCount, clampProgress, phaseSine, resolveFaceBox } from "../clamp";
import type { FaceProps } from "../types";
import { bioAmount, DESCENT_ZONES, depthMeters, formatDepth, zoneAt } from "./zones";
import { FAR_SILT, MID_MOTES, NEAR_BIO } from "./particles";
import "./descent.css";

const VW = 960;
const VH = 640;

export function DescentFace(props: FaceProps): JSX.Element {
  const box = resolveFaceBox(props.size);
  const progress = clampProgress(props.progress);
  const kills = clampKillCount(props.killCount);
  const zone = zoneAt(progress);
  const depth = depthMeters(progress);
  const bio = bioAmount(progress);
  const gaugeY = 36 + progress * (VH - 72);
  const label = `${zone.name} · ${formatDepth(depth)}`;

  const style = {
    width: box.width,
    height: box.height,
    "--fp-descent-p": String(progress),
  } as CSSProperties;

  return (
    <div
      className="fp-descent"
      style={style}
      role="img"
      aria-label={`Descent ${Math.round(progress * 100)} percent. ${label}`}
      data-face="descent"
      data-phase={props.phase}
      data-zone={zone.id}
    >
      <svg
        className="fp-descent-svg"
        viewBox={`0 0 ${VW} ${VH}`}
        width={box.width}
        height={box.height}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="fp-descent-water" x1="0" y1="0" x2="0" y2="1">
            {DESCENT_ZONES.flatMap((z) => [
              <stop key={`${z.id}-top`} offset={`${z.start * 100}%`} stopColor={z.top} />,
              <stop key={`${z.id}-bot`} offset={`${z.end * 100}%`} stopColor={z.bottom} />,
            ])}
          </linearGradient>
          <linearGradient id="fp-descent-shaft" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity="0.42" />
            <stop offset="0.42" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.48" />
          </linearGradient>
          <radialGradient id="fp-descent-sun" cx="50%" cy="0%" r="48%">
            <stop offset="0" stopColor="#f4fffb" stopOpacity="0.7" />
            <stop offset="0.4" stopColor="#7ee0d0" stopOpacity="0.18" />
            <stop offset="1" stopColor="#7ee0d0" stopOpacity="0" />
          </radialGradient>
          <filter id="fp-descent-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
          <filter id="fp-descent-gauge" x="-20%" y="-80%" width="140%" height="260%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={VW} height={VH} fill="url(#fp-descent-water)" />
        <rect width={VW} height={VH} fill="url(#fp-descent-sun)" />
        {[0.18, 0.32, 0.5, 0.68].map((x) => (
          <polygon
            key={x}
            points={`${VW * x},0 ${VW * x - 10},0 ${VW * x - 28},210 ${VW * x + 8},210`}
            fill="rgba(232,255,248,0.07)"
          />
        ))}
        <rect width={VW} height={VH} fill="url(#fp-descent-shaft)" />

        {DESCENT_ZONES.map((z) => {
          const y = z.start * VH;
          const active = zone.id === z.id;
          return (
            <g key={z.id}>
              <line
                x1="0"
                x2={VW}
                y1={y}
                y2={y}
                stroke={active ? "rgba(200,244,234,0.38)" : "rgba(170,190,220,0.16)"}
                strokeWidth={active ? 1.6 : 1}
              />
              <text x={16} y={y + 22} className="fp-descent-zone" fill={active ? "#f4fffb" : "rgba(238,242,248,0.55)"}>
                {z.name.toUpperCase()}
              </text>
              <text
                x={16}
                y={y + 38}
                className="fp-descent-zone-meta"
                fill={active ? "rgba(200,244,234,0.78)" : "rgba(155,166,184,0.5)"}
              >
                {z.depthStartM.toLocaleString("en-US")}–{z.depthEndM.toLocaleString("en-US")} m
              </text>
              <text
                x={16}
                y={y + 52}
                className="fp-descent-zone-meta"
                fill={active ? "rgba(200,244,234,0.55)" : "rgba(155,166,184,0.38)"}
              >
                {z.layer}
              </text>
            </g>
          );
        })}

        {Array.from({ length: 13 }, (_, i) => {
          const y = 36 + (i / 12) * (VH - 72);
          return (
            <g key={`tick-${i}`}>
              <line x1={VW - 18} x2={VW - 8} y1={y} y2={y} stroke="rgba(232,255,248,0.22)" strokeWidth="1" />
            </g>
          );
        })}

        <SpeckLayer
          specks={FAR_SILT}
          now={props.now}
          period={4200}
          fill="rgba(190, 220, 210, 0.38)"
          opacityScale={0.7}
        />
        <SpeckLayer
          specks={MID_MOTES}
          now={props.now}
          period={2600}
          fill="rgba(170, 230, 235, 0.55)"
          opacityScale={0.85}
        />
        <SpeckLayer
          specks={NEAR_BIO}
          now={props.now}
          period={1800}
          fill={bio > 0.2 ? "#e8fff4" : "rgba(200, 230, 220, 0.4)"}
          opacityScale={0.35 + bio * 0.95}
          glow={bio > 0.2}
        />

        <g filter="url(#fp-descent-gauge)">
          <line x1={0} x2={VW} y1={gaugeY} y2={gaugeY} stroke="#e8fff8" strokeWidth="2" />
          <rect x={VW / 2 - 34} y={gaugeY - 9} width={68} height={18} rx={9} fill="#071412" stroke="#c8ffe6" strokeWidth="1.6" />
          <circle cx={VW / 2} cy={gaugeY} r={4} fill="#c8ffe6" />
        </g>

        <text x={VW - 22} y={gaugeY - 14} textAnchor="end" className="fp-descent-readout" fill="#e8fff8">
          {formatDepth(depth)}
        </text>
        <text x={VW - 22} y={gaugeY + 26} textAnchor="end" className="fp-descent-readout-sub" fill="rgba(200,244,234,0.75)">
          {zone.name} · {Math.round(progress * 100)}%
          {kills > 0 ? ` · ${kills} kill${kills === 1 ? "" : "s"}` : ""}
        </text>
      </svg>
    </div>
  );
}

function SpeckLayer(props: {
  specks: readonly { x: number; y: number; r: number; seed: number }[];
  now: number;
  period: number;
  fill: string;
  opacityScale: number;
  glow?: boolean;
}): JSX.Element {
  return (
    <g filter={props.glow ? "url(#fp-descent-soft)" : undefined}>
      {props.specks.map((speck, i) => {
        const wave = 0.5 + 0.5 * phaseSine(props.now, speck.seed, props.period);
        const opacity = (0.28 + wave * 0.72) * props.opacityScale;
        return (
          <circle
            key={`${speck.seed}-${i}`}
            cx={14 + speck.x * (VW - 28)}
            cy={20 + speck.y * (VH - 40)}
            r={speck.r}
            fill={props.fill}
            opacity={opacity}
          />
        );
      })}
    </g>
  );
}
