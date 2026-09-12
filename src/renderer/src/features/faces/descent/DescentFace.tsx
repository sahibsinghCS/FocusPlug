import type { CSSProperties, JSX } from "react";
import { clampKillCount, clampProgress, phaseSine, resolveFaceBox } from "../clamp";
import type { FaceProps } from "../types";
import { bioAmount, DESCENT_ZONES, depthMeters, formatDepth, zoneAt } from "./zones";
import { FAR_SILT, MID_MOTES, NEAR_BIO } from "./particles";
import "./descent.css";

export function DescentFace(props: FaceProps): JSX.Element {
  const box = resolveFaceBox(props.size);
  const progress = clampProgress(props.progress);
  const kills = clampKillCount(props.killCount);
  const zone = zoneAt(progress);
  const depth = depthMeters(progress);
  const bio = bioAmount(progress);
  const gaugeY = 28 + progress * (box.height - 56);
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
        viewBox={`0 0 ${box.width} ${box.height}`}
        width={box.width}
        height={box.height}
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
            <stop offset="0" stopColor="#000" stopOpacity="0.35" />
            <stop offset="0.45" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.4" />
          </linearGradient>
          <radialGradient id="fp-descent-sun" cx="50%" cy="0%" r="55%">
            <stop offset="0" stopColor="#e8fff8" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#7ee0d0" stopOpacity="0.12" />
            <stop offset="1" stopColor="#7ee0d0" stopOpacity="0" />
          </radialGradient>
          <filter id="fp-descent-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        <rect width={box.width} height={box.height} fill="url(#fp-descent-water)" />
        <rect width={box.width} height={box.height} fill="url(#fp-descent-sun)" />
        <rect width={box.width} height={box.height} fill="url(#fp-descent-shaft)" />

        {DESCENT_ZONES.map((z) => {
          const y = z.start * box.height;
          const active = zone.id === z.id;
          return (
            <g key={z.id}>
              <line
                x1="0"
                x2={box.width}
                y1={y}
                y2={y}
                stroke={active ? "rgba(200,244,234,0.28)" : "rgba(170,190,220,0.1)"}
                strokeWidth={active ? 1.25 : 0.75}
              />
              <text
                x={14}
                y={y + 18}
                className="fp-descent-zone"
                fill={active ? "#e8fff8" : "rgba(238,242,248,0.42)"}
              >
                {z.name.toUpperCase()}
              </text>
              <text
                x={14}
                y={y + 32}
                className="fp-descent-zone-meta"
                fill={active ? "rgba(200,244,234,0.72)" : "rgba(155,166,184,0.45)"}
              >
                {z.depthStartM.toLocaleString("en-US")}–{z.depthEndM.toLocaleString("en-US")} m · {z.layer}
              </text>
            </g>
          );
        })}

        <SpeckLayer
          specks={FAR_SILT}
          width={box.width}
          height={box.height}
          now={props.now}
          period={4200}
          fill="rgba(190, 220, 210, 0.22)"
          opacityScale={0.45}
        />
        <SpeckLayer
          specks={MID_MOTES}
          width={box.width}
          height={box.height}
          now={props.now}
          period={2600}
          fill="rgba(160, 220, 230, 0.38)"
          opacityScale={0.7}
        />
        <SpeckLayer
          specks={NEAR_BIO}
          width={box.width}
          height={box.height}
          now={props.now}
          period={1800}
          fill={bio > 0.2 ? "#d8ffe8" : "rgba(200, 230, 220, 0.35)"}
          opacityScale={0.25 + bio * 0.85}
          glow={bio > 0.25}
        />

        <line
          x1={0}
          x2={box.width}
          y1={gaugeY}
          y2={gaugeY}
          className="fp-descent-gauge"
          stroke="#e8fff8"
          strokeWidth="1.5"
        />
        <rect
          x={box.width / 2 - 26}
          y={gaugeY - 7}
          width={52}
          height={14}
          rx={7}
          fill="#0b1c1a"
          stroke="#c8ffe6"
          strokeWidth="1.4"
        />
        <circle cx={box.width / 2} cy={gaugeY} r={3.2} fill="#c8ffe6" />

        <text
          x={box.width - 16}
          y={gaugeY - 10}
          textAnchor="end"
          className="fp-descent-readout"
          fill="#e8fff8"
        >
          {formatDepth(depth)}
        </text>
        <text
          x={box.width - 16}
          y={gaugeY + 22}
          textAnchor="end"
          className="fp-descent-readout-sub"
          fill="rgba(200,244,234,0.7)"
        >
          {zone.name} · {Math.round(progress * 100)}%
          {kills > 0 ? ` · ${kills} kill${kills === 1 ? "" : "s"}` : ""}
        </text>
      </svg>
    </div>
  );
}

function SpeckLayer(props: {
  specks: readonly { x: number; y: number; r: number; seed: number }[];
  width: number;
  height: number;
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
        const opacity = (0.22 + wave * 0.78) * props.opacityScale;
        return (
          <circle
            key={`${speck.seed}-${i}`}
            cx={8 + speck.x * (props.width - 16)}
            cy={12 + speck.y * (props.height - 24)}
            r={speck.r}
            fill={props.fill}
            opacity={opacity}
          />
        );
      })}
    </g>
  );
}
