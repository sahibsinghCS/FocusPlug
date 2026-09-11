import type { JSX } from "react";
import { cn } from "../../lib/cn";
import { padCountdown } from "../../lib/format";
import type { SessionClockView } from "./model";

export function SessionClock(props: { clock: SessionClockView }): JSX.Element {
  const { clock } = props;
  return (
    <section
      className="fp-card grid grid-cols-2 gap-3 px-4 py-3"
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
        value={clock.fuseLive ? padCountdown(clock.fuseSec) : clock.fuseLabel}
        hint={clock.fuseLive ? "Force-quit when this hits 00" : "Armed length"}
        dominant={clock.primary === "fuse"}
        tone={clock.fuseLive ? "red" : "mute"}
        monoPop={clock.fuseLive}
      />
    </section>
  );
}

function ClockCell(props: {
  label: string;
  value: string;
  hint: string;
  dominant: boolean;
  tone: "ink" | "red" | "mute";
  monoPop?: boolean;
}): JSX.Element {
  const color =
    props.tone === "red" ? "text-fp-red" : props.tone === "mute" ? "text-fp-mute" : "text-fp-ink";
  return (
    <div className={cn("min-w-0", props.dominant ? "opacity-100" : "opacity-80")}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fp-faint">
        {props.label}
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
      <p className="mt-1.5 text-[11px] text-fp-faint">{props.hint}</p>
    </div>
  );
}
