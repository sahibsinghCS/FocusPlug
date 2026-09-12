import type { JSX, ReactNode } from "react";
import { Led } from "../components/ui";
import { Ribbon } from "../features/timer/Ribbon";
import { HoldSwitch } from "../features/timer/HoldSwitch";
import { formatReadout, formatSpan, planFocusSec } from "../features/timer/plan";
import { positionCaption } from "../features/timer/runtime";
import type { SessionTimer } from "../features/timer/useSessionTimer";
import { cn } from "../lib/cn";
import {
  decisionLabel,
  decisionTone,
  deskPrimary,
  deskTone,
  formatConfidence,
  formatHmClock,
  windowPrimary,
  windowSecondary,
} from "../lib/format";
import { IconBolt } from "../lib/icons";
import { enabledPlugViews } from "../lib/plugsUi";
import { useAppState } from "../state/AppState";
import "../features/timer/timer.css";

/**
 * Lock mode. The console gets out of the way: one number, the ribbon filling,
 * and — only while the lock is actually on — a quiet line proving the sensors
 * are awake. Tungsten while you work, daylight on a break, so a glance from
 * across the room tells you which one you are in.
 */
export function LockPage(props: { timer: SessionTimer }): JSX.Element {
  const app = useAppState();
  const { timer } = props;

  if (timer.status === "done") {
    return <Finished timer={timer} />;
  }

  const position = timer.position;
  const onBreak = position?.segment.kind === "break";
  const paused = timer.status === "paused";
  const phase = onBreak ? "break" : "focus";
  const armedPlugs = enabledPlugViews(app.plugs);

  return (
    <div
      data-phase={phase}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-fp-bg text-fp-ink"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="fp-lock-glow absolute left-1/2 top-1/2 h-[130vmin] w-[130vmin] -translate-x-1/2 -translate-y-1/2" />
      </div>

      <header className="fp-rail relative z-10 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Led tone={paused ? "mute" : onBreak ? "mute" : "focus"} live={!paused} />
          <p className="fp-stencil text-fp-mute">
            {paused ? "Paused — lock released" : onBreak ? "Break — lock released" : "Locked"}
          </p>
        </div>
        <p className="font-mono text-[11px] text-fp-faint tabular">
          {paused ? "finish time on hold" : `free ${formatHmClock(timer.endsAtMs ?? Date.now())}`}
        </p>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <p className="fp-stencil fp-lock-in text-[color:var(--phase)]">
          {positionCaption(position, timer.status)}
        </p>

        <p
          className="fp-readout fp-lock-readout fp-lock-in mt-3"
          style={{ animationDelay: "60ms" }}
          aria-live="off"
        >
          {formatReadout(position?.remainingSec ?? 0)}
        </p>
        <p className="sr-only" aria-live="polite">
          {positionCaption(position, timer.status)}, {formatReadout(position?.remainingSec ?? 0)}{" "}
          remaining
        </p>

        <p
          className="fp-lock-in mt-5 max-w-[46ch] text-center text-[14px] leading-6 text-fp-mute"
          style={{ animationDelay: "120ms" }}
        >
          {paused
            ? "Clock stopped, nothing enforced. Resume when you are back."
            : onBreak
              ? "Blocked apps are yours again until the next round."
              : "Leave the assignment and the fuse starts."}
        </p>
      </main>

      <footer className="relative z-10 flex shrink-0 flex-col items-center gap-5 px-6 pb-6">
        <div
          className="fp-lock-in w-full max-w-[760px]"
          style={{ animationDelay: "160ms" }}
        >
          <Ribbon segments={timer.segments} elapsedSec={timer.elapsedSec} variant="run" />
          <div className="mt-2 flex justify-between font-mono text-[11px] text-fp-faint tabular">
            <span>{formatSpan(timer.elapsedSec)} in</span>
            <span>{formatSpan(timer.remainingSec)} left</span>
          </div>
        </div>

        {!onBreak && !paused ? (
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Sensor
              tone={
                app.state.focus?.matchedBlock
                  ? "red"
                  : app.state.focus?.matchedAllow
                    ? "focus"
                    : "warn"
              }
              value={windowPrimary(app.state.focus)}
              detail={windowSecondary(app.state.focus)}
            />
            <Sensor
              tone={app.state.desk ? deskTone(app.state.desk.label) : "mute"}
              value={deskPrimary(app.state.desk)}
              detail={
                app.state.desk
                  ? `Desk AI ${formatConfidence(app.state.desk.confidence)}`
                  : "Desk AI standby"
              }
            />
            <Sensor
              tone={decisionTone(app.state.decision)}
              value={decisionLabel(app.state.decision)}
              detail={
                armedPlugs.length > 0
                  ? `${armedPlugs.length} plug${armedPlugs.length === 1 ? "" : "s"} armed`
                  : "No plugs armed"
              }
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Quiet onClick={paused ? timer.resume : timer.pause}>
            {paused ? "Resume" : "Pause"}
          </Quiet>
          <Quiet onClick={timer.skip}>{onBreak ? "Skip break" : "Skip round"}</Quiet>
          <Quiet
            onClick={() => {
              void app.demoKill();
            }}
            danger
            tip="Skips the fuse: force-quit blocklist apps and cut armed plugs. Never the study PC."
          >
            <IconBolt className="h-3.5 w-3.5" />
            Demo kill
          </Quiet>
          <HoldSwitch
            label="Hold to end"
            holdingLabel="Ending…"
            tone="danger"
            className="w-[176px]"
            onComplete={timer.end}
          />
        </div>
      </footer>
    </div>
  );
}

function Finished(props: { timer: SessionTimer }): JSX.Element {
  const { timer } = props;
  const short = timer.workedSec < planFocusSec(timer.plan) - 30;
  return (
    <div
      data-phase="done"
      className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden bg-fp-bg px-6 text-center"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="fp-lock-glow absolute left-1/2 top-1/2 h-[110vmin] w-[110vmin] -translate-x-1/2 -translate-y-1/2" />
      </div>
      <div className="fp-lock-in relative z-10">
        <p className="fp-stencil text-[color:var(--phase)]">Session complete</p>
        <h1 className="fp-display mt-3 text-[clamp(34px,6vw,64px)] font-semibold leading-[1.02]">
          <span className="text-[color:var(--phase)]">{formatSpan(timer.workedSec)}</span> of work.
          <br />
          <span className="text-fp-mute">The lock is off.</span>
        </h1>
        <p className="mt-4 max-w-[52ch] text-[14px] leading-6 text-fp-mute">
          {short
            ? "You skipped part of the plan, so that is the focus time you actually served."
            : `${timer.plan.rounds} round${timer.plan.rounds === 1 ? "" : "s"} of ${timer.plan.focusMin} minutes.`}{" "}
          Everything is unblocked and any plug you armed is back on.
        </p>
      </div>

      <div
        className="fp-lock-in relative z-10 w-full max-w-[520px]"
        style={{ animationDelay: "90ms" }}
      >
        <Ribbon segments={timer.segments} elapsedSec={timer.elapsedSec} variant="run" />
      </div>

      <div className="relative z-10 w-full max-w-[320px]">
        <button
          type="button"
          onClick={timer.end}
          className="fp-btn h-11 w-full rounded-[var(--radius-fp)] border border-fp-line-strong bg-fp-elev px-4 text-[14px] font-semibold text-fp-ink hover:bg-fp-hover"
        >
          Back to the panel
        </button>
      </div>
    </div>
  );
}

function Sensor(props: {
  tone: "focus" | "red" | "warn" | "mute";
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="flex min-w-0 max-w-[230px] items-start gap-2">
      <Led tone={props.tone} className="mt-[6px]" />
      <div className="min-w-0 text-left">
        <p className="truncate text-[12.5px] font-medium text-fp-ink">{props.value}</p>
        <p className="truncate text-[11px] text-fp-faint">{props.detail}</p>
      </div>
    </div>
  );
}

function Quiet(props: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  tip?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-tip={props.tip}
      data-tip-up={props.tip ? "" : undefined}
      className={cn(
        "fp-btn inline-flex h-14 items-center justify-center gap-2 rounded-[var(--radius-fp)] border px-5 text-[14px] font-medium",
        props.danger
          ? "border-fp-line text-fp-mute hover:border-fp-red/40 hover:bg-fp-red/10 hover:text-fp-red"
          : "border-fp-line text-fp-mute hover:border-fp-line-strong hover:bg-fp-hover hover:text-fp-ink",
      )}
    >
      {props.children}
    </button>
  );
}
