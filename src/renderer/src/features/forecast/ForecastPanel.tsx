import type { JSX } from "react";
import type { ForecastEvent, ForecastSnapshot } from "@shared/ipc";
import { cn } from "../../lib/cn";
import { Chip } from "../../components/ui";
import { bandLabel, bandTone, type RiskPoint } from "./model";
import { RiskMeter } from "./RiskMeter";
import { InternalsPanel } from "./InternalsPanel";
import "./forecast.css";

export interface ForecastPanelProps {
  snapshot: ForecastSnapshot | null;
  events: readonly ForecastEvent[];
  history: readonly RiskPoint[];
  enabled: boolean;
  prearmEnabled: boolean;
  sessionActive: boolean;
  nudgeRisk: number;
  prearmRisk: number;
  /** Foreground process name when it is a grey (unlisted) app. */
  greyApp?: string;
}

/**
 * The co-star instrument: Decision is the verdict, Forecast predicts the next
 * verdict. Left — the risk meter against the live thresholds; right — the
 * model internals that make the prediction legible. Pre-arm turns the whole
 * frame hot (the fuse it shortens is real).
 */
export function ForecastPanel(props: ForecastPanelProps): JSX.Element {
  const { snapshot } = props;
  const live = props.enabled && props.sessionActive && snapshot !== null;
  const band = live && snapshot.ready ? snapshot.band : null;

  return (
    <section
      aria-label="Focus Forecast"
      className={cn(
        "fp-card px-4 py-3",
        band === "prearm" && "fp-forecast-prearm-card border-fp-red/40",
        band === "elevated" && "border-fp-amber/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-fp-faint">
          Focus Forecast
        </p>
        {band ? <Chip tone={bandTone(band)}>{bandLabel(band)}</Chip> : null}
        {live && snapshot !== null && !snapshot.ready ? (
          <Chip tone="mute">Warming up</Chip>
        ) : null}
        {!props.enabled ? <Chip tone="mute">Off</Chip> : null}
        {props.enabled && !props.prearmEnabled ? <Chip tone="mute">Nudge-only</Chip> : null}
        <p className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-fp-faint">
          {snapshot
            ? `v ${snapshot.modelVersion} · ${snapshot.paramCount} params · horizon ${snapshot.horizonSec} s`
            : "TinyMLP 18→12→1 · on-device"}
        </p>
      </div>

      {!props.enabled ? (
        <PanelNote text="Forecast off — sessions run exactly as before: base fuse, no nudges. Re-enable in Settings." />
      ) : !props.sessionActive ? (
        <PanelNote text="Standby — the risk model runs while a session is live. 15 s warm-up, then a prediction every second." />
      ) : snapshot === null ? (
        <PanelNote text="Waiting for the first telemetry frame…" />
      ) : (
        <div className="mt-2 grid gap-4 min-[860px]:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.55fr)]">
          <RiskMeter
            snapshot={snapshot}
            nudgeRisk={props.nudgeRisk}
            prearmRisk={props.prearmRisk}
            history={props.history}
            events={props.events}
          />
          <InternalsPanel snapshot={snapshot} events={props.events} greyApp={props.greyApp} />
        </div>
      )}
    </section>
  );
}

function PanelNote(props: { text: string }): JSX.Element {
  return <p className="mt-3 pb-1 text-[12px] text-fp-mute">{props.text}</p>;
}
