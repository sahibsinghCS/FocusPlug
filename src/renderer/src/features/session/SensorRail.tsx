import type { JSX } from "react";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/format";
import type { SensorCardView } from "./model";

export function SensorRail(props: { sensors: readonly SensorCardView[] }): JSX.Element {
  return (
    <section aria-label="Live sensors">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fp-faint">
          Live sensors
        </p>
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
  return (
    <article
      className={cn(
        "min-w-0 rounded-xl border bg-fp-panel px-4 py-3",
        sensor.tone === "red"
          ? "border-fp-red/35"
          : sensor.tone === "lime"
            ? "border-fp-lime/20"
            : sensor.tone === "amber"
              ? "border-fp-amber/25"
              : "border-fp-line",
      )}
    >
      <div className="flex items-center gap-2">
        <SensorLed tone={sensor.tone} live={sensor.live} />
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
    </article>
  );
}

function SensorLed(props: { tone: Tone; live: boolean }): JSX.Element {
  const color =
    props.tone === "lime"
      ? "bg-fp-lime shadow-[0_0_8px_rgba(212,255,58,0.85)]"
      : props.tone === "red"
        ? "bg-fp-red shadow-[0_0_8px_rgba(255,45,85,0.9)]"
        : props.tone === "amber"
          ? "bg-fp-amber shadow-[0_0_8px_rgba(255,176,32,0.85)]"
          : "bg-zinc-600";
  return (
    <span
      className={cn("inline-block h-1.5 w-1.5 rounded-full", color, props.live && "fp-session-led-live")}
      aria-hidden="true"
    />
  );
}
