import type { JSX } from "react";
import { Led } from "../../components/ui";
import { cn } from "../../lib/cn";
import { toneCard } from "../../lib/tone";
import type { SensorCardView } from "./model";

export function SensorRail(props: { sensors: readonly SensorCardView[] }): JSX.Element {
  return (
    <section aria-label="Live sensors">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="fp-section-label">Live sensors</p>
        <p className="text-[11px] text-fp-faint">Foreground · Desk AI · Plugs</p>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-3">
        {props.sensors.map((sensor) => (
          <SensorCard key={sensor.id} sensor={sensor} />
        ))}
      </div>
    </section>
  );
}

function SensorCard(props: { sensor: SensorCardView }): JSX.Element {
  const { sensor } = props;
  const body = (
    <>
      <div className="flex items-center gap-2">
        <Led tone={sensor.tone} live={sensor.live} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fp-faint">
          {sensor.label}
        </p>
        <p className="ml-auto truncate font-mono text-[10px] uppercase tracking-[0.08em] text-fp-faint">
          {sensor.meta}
        </p>
      </div>
      <p className="mt-2 truncate text-[16px] font-semibold tracking-tight" title={sensor.title}>
        {sensor.title}
      </p>
      <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-fp-mute" title={sensor.body}>
        {sensor.body}
      </p>
    </>
  );
  const classes = cn("fp-card min-w-0 px-4 py-3", toneCard(sensor.tone));
  if (sensor.href) {
    return (
      <a href={sensor.href} className={cn(classes, "transition hover:bg-fp-hover")}>
        {body}
      </a>
    );
  }
  return <article className={classes}>{body}</article>;
}
