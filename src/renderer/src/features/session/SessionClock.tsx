import type { JSX } from "react";
import { cn } from "../../lib/cn";
import { padCountdown } from "../../lib/format";
import type { PrearmPlateView } from "../forecast/model";
import type { SessionClockView } from "./model";

export function SessionClock(props: {
  clock: SessionClockView;
  /** Forecast pre-arm plate — amber treatment + the 10s → 5s chip. */
  prearm?: PrearmPlateView | null;
}): JSX.Element {
  const { clock } = props;
  const prearm = props.prearm ?? null;
  const prearmed = prearm !== null;
  return (
    <section
      className={cn(
        "fp-card grid grid-cols-2 gap-3 px-4 py-3",
        prearmed && "border-fp-amber/40 shadow-[inset_0_0_40px_rgba(255,176,32,0.06)]",
      )}
      aria-label="Session clocks"
    >
      <ClockCell
        label="Elapsed"
        value={clock.elapsedLabel}
        hint={clock.elapsedSec === null ? "Start to run the clock" : "This session"}
        dominant={clock.primary === "elapsed"}
        tone="ink"
      />
      <ClockCell
        label="Fuse"
        value={
          clock.fuseLive
            ? padCountdown(clock.fuseSec)
            : prearmed
              ? `${prearm.effectiveFuseSec}s`
              : clock.fuseLabel
        }
        hint={
          clock.fuseLive
            ? "Force-quit when this hits 00"
            : prearmed
              ? prearm.label
              : "Armed length"
        }
        dominant={clock.primary === "fuse" || prearmed}
        tone={clock.fuseLive ? "red" : prearmed ? "amber" : "mute"}
        monoPop={clock.fuseLive}
        chip={!clock.fuseLive && prearmed ? prearm.chip : null}
      />
    </section>
  );
}

function ClockCell(props: {
  label: string;
  value: string;
  hint: string;
  dominant: boolean;
  tone: "ink" | "red" | "mute" | "amber";
  monoPop?: boolean;
  chip?: string | null;
}): JSX.Element {
  const color =
    props.tone === "red"
      ? "text-fp-red"
      : props.tone === "amber"
        ? "text-fp-amber"
        : props.tone === "mute"
          ? "text-fp-mute"
          : "text-fp-ink";
  return (
    <div className={cn("min-w-0", props.dominant ? "opacity-100" : "opacity-80")}>
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-fp-faint">
        {props.label}
        {props.chip ? (
          <span className="fp-forecast-prearm-chip inline-flex items-center rounded-full border border-fp-red/40 bg-fp-red/10 px-1.5 py-px font-mono text-[10px] font-bold tracking-normal text-fp-red tabular">
            FUSE {props.chip}
          </span>
        ) : null}
      </p>
      <p
        className={cn(
          "mt-1 font-mono font-bold leading-none tabular",
          props.dominant ? "text-[clamp(28px,4vw,40px)]" : "text-[clamp(18px,2.6vw,26px)]",
          color,
          props.monoPop && "fp-session-fuse-num",
        )}
      >
        {props.value}
      </p>
      <p
        className={cn(
          "mt-1.5 text-[11px]",
          props.tone === "amber" && !props.monoPop ? "text-fp-amber" : "text-fp-faint",
        )}
      >
        {props.hint}
      </p>
    </div>
  );
}
