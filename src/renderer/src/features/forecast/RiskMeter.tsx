import type { JSX } from "react";
import type { ForecastEvent, ForecastSnapshot } from "@shared/ipc";
import { cn } from "../../lib/cn";
import {
  meterView,
  riskAngle,
  sparklineView,
  type RiskPoint,
} from "./model";

/**
 * 180° arc gauge — needle on smoothed risk, threshold ticks at the LIVE
 * settings values (the judge watches the needle approach a consequence), and
 * a 60 s sparkline with nudge ▲ / pre-arm ◆ / drift ✖ markers underneath.
 * Warm-up renders the needle ghosted with "warming up · n/15 s".
 */

const CX = 110;
const CY = 112;
const R = 84;

/** Gauge angle in degrees: −90 (risk 0) … +90 (risk 1), 0 at 12 o'clock. */
function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.sin(rad), y: CY - radius * Math.cos(rad) };
}

function arcPath(fromRisk: number, toRisk: number, radius: number): string {
  const a = polar(riskAngle(fromRisk), radius);
  const b = polar(riskAngle(toRisk), radius);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

const ZONE_CALM = "rgba(154, 166, 184, 0.30)";
const ZONE_ELEVATED = "rgba(255, 176, 32, 0.55)";
const ZONE_PREARM = "rgba(255, 45, 85, 0.65)";

function bandStroke(band: "calm" | "elevated" | "prearm", ready: boolean): string {
  if (!ready) return "var(--color-fp-faint)";
  if (band === "prearm") return "var(--color-fp-red)";
  if (band === "elevated") return "var(--color-fp-amber)";
  return "var(--color-fp-mute)";
}

export function RiskMeter(props: {
  snapshot: ForecastSnapshot | null;
  nudgeRisk: number;
  prearmRisk: number;
  history: readonly RiskPoint[];
  events: readonly ForecastEvent[];
}): JSX.Element {
  const view = meterView(props.snapshot, {
    nudgeRisk: props.nudgeRisk,
    prearmRisk: props.prearmRisk,
  });
  const needleColor = bandStroke(view.band, view.ready);
  const nowTs =
    props.snapshot?.ts ?? props.history[props.history.length - 1]?.ts ?? 0;
  const spark = sparklineView(props.history, props.events, {
    nowTs,
    width: 220,
    height: 44,
    nudgeRisk: props.nudgeRisk,
    prearmRisk: props.prearmRisk,
  });

  return (
    <div className="flex min-w-0 flex-col items-center" data-band={view.band}>
      <svg viewBox="0 0 220 136" className="w-full max-w-[280px]" role="img" aria-label={`Drift risk ${view.percentLabel}`}>
        {/* Fixed threshold zones: slate → amber → red. */}
        <path d={arcPath(0, props.nudgeRisk, R)} fill="none" stroke={ZONE_CALM} strokeWidth="9" strokeLinecap="round" />
        <path d={arcPath(props.nudgeRisk, props.prearmRisk, R)} fill="none" stroke={ZONE_ELEVATED} strokeWidth="9" />
        <path d={arcPath(props.prearmRisk, 1, R)} fill="none" stroke={ZONE_PREARM} strokeWidth="9" strokeLinecap="round" />

        {/* Threshold ticks at the live settings values. */}
        {view.ticks.map((tick) => {
          const angle = riskAngle(tick.risk);
          const inner = polar(angle, R - 9);
          const outer = polar(angle, R + 9);
          const label = polar(angle, R + 20);
          return (
            <g key={tick.label}>
              <line
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="var(--color-fp-ink)"
                strokeOpacity="0.7"
                strokeWidth="1.5"
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="var(--color-fp-faint)"
                fontSize="8"
                letterSpacing="0.08em"
                style={{ textTransform: "uppercase" }}
              >
                {tick.label}
              </text>
            </g>
          );
        })}

        {/* Needle — CSS-transitioned rotation, ghosted during warm-up. */}
        <g
          className="fp-forecast-needle"
          style={{
            transform: `rotate(${view.angleDeg}deg)`,
            transformOrigin: `${CX}px ${CY}px`,
            opacity: view.ready ? 1 : 0.35,
          }}
        >
          <line x1={CX} y1={CY} x2={CX} y2={CY - R + 16} stroke={needleColor} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx={CX} cy={CY} r="4.5" fill={needleColor} />
        </g>

        {/* Big percentage + caption inside the dial. */}
        <text
          x={CX}
          y={CY - 18}
          textAnchor="middle"
          className="tabular"
          fill={view.ready ? "var(--color-fp-ink)" : "var(--color-fp-faint)"}
          fontFamily="var(--font-mono)"
          fontWeight="700"
          fontSize="30"
        >
          {view.percentLabel}
        </text>
        <text
          x={CX}
          y={CY + 16}
          textAnchor="middle"
          fill="var(--color-fp-faint)"
          fontSize="9"
          letterSpacing="0.14em"
          style={{ textTransform: "uppercase" }}
        >
          {view.caption}
        </text>
      </svg>

      {view.warmupLabel ? (
        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fp-amber" role="status">
          {view.warmupLabel}
        </p>
      ) : (
        <p
          className={cn(
            "mt-0.5 font-mono text-[11px] uppercase tracking-[0.16em]",
            view.band === "prearm"
              ? "text-fp-red"
              : view.band === "elevated"
                ? "text-fp-amber"
                : "text-fp-mute",
          )}
        >
          {view.band === "prearm" ? "pre-armed" : view.band === "elevated" ? "elevated" : "calm"}
        </p>
      )}

      {/* 60 s risk sparkline with event markers. */}
      <svg viewBox="0 0 220 48" className="mt-2 w-full max-w-[280px]" aria-hidden="true">
        <line x1="0" x2="220" y1={spark.nudgeY} y2={spark.nudgeY} stroke="var(--color-fp-amber)" strokeOpacity="0.35" strokeDasharray="3 3" strokeWidth="1" />
        <line x1="0" x2="220" y1={spark.prearmY} y2={spark.prearmY} stroke="var(--color-fp-red)" strokeOpacity="0.35" strokeDasharray="3 3" strokeWidth="1" />
        {spark.empty ? null : (
          <path d={spark.path} fill="none" stroke="var(--color-fp-blue)" strokeWidth="1.6" strokeLinejoin="round" />
        )}
        {spark.markers.map((marker, index) => {
          if (marker.kind === "nudge") {
            return (
              <path
                key={index}
                d={`M ${marker.x} ${marker.y - 4} L ${marker.x + 3.5} ${marker.y + 2.5} L ${marker.x - 3.5} ${marker.y + 2.5} Z`}
                fill="var(--color-fp-amber)"
              />
            );
          }
          if (marker.kind === "prearm") {
            return (
              <path
                key={index}
                d={`M ${marker.x} ${marker.y - 4.5} L ${marker.x + 4} ${marker.y} L ${marker.x} ${marker.y + 4.5} L ${marker.x - 4} ${marker.y} Z`}
                fill="var(--color-fp-red)"
              />
            );
          }
          return (
            <g key={index} stroke="var(--color-fp-red)" strokeWidth="1.6">
              <line x1={marker.x - 3} y1={marker.y - 3} x2={marker.x + 3} y2={marker.y + 3} />
              <line x1={marker.x - 3} y1={marker.y + 3} x2={marker.x + 3} y2={marker.y - 3} />
            </g>
          );
        })}
      </svg>
      <p className="mt-1 flex items-center gap-3 text-[10px] text-fp-faint">
        <span>last 60 s</span>
        <span className="text-fp-amber">▲ nudge</span>
        <span className="text-fp-red">◆ pre-arm</span>
        <span className="text-fp-red">✖ drift</span>
      </p>
    </div>
  );
}
