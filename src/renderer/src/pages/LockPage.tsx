import type { JSX, ReactNode } from "react";
import { HoldSwitch } from "../features/timer/HoldSwitch";
import { Ribbon } from "../features/timer/Ribbon";
import { faceDef } from "../features/timer/faces";
import { formatReadout, formatSpan, planFocusSec } from "../features/timer/plan";
import { positionCaption } from "../features/timer/runtime";
import type { SessionTimer } from "../features/timer/useSessionTimer";
import { cn } from "../lib/cn";
import {
  decisionLabel,
  deskPrimary,
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
 * Lock mode. The console gets out of the way and leaves one object running
 * out, whichever one you picked. A break inverts the whole room — black on
 * bone instead of bone on black — so the lock lifting is visible from the
 * doorway without a single hue being involved.
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
  const face = faceDef(timer.face);
  const progress = position?.segmentProgress ?? 0;
  const remainingSec = position?.remainingSec ?? 0;
  const totalSec = position?.segment.seconds ?? timer.plan.focusMin * 60;
  const multiRound = timer.segments.length > 1;
  // Faces carry their own palette, so a break — which inverts the room — drops
  // back to the plain readout rather than dragging a night globe onto bone.
  const showFace = !onBreak;

  return (
    <div
      data-phase={phase}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ground)] text-[color:var(--phase)]"
    >
      {showFace && face.ambient ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <face.Face
            progress={progress}
            remainingSec={remainingSec}
            totalSec={totalSec}
            className="h-full w-full"
          />
        </div>
      ) : null}

      <header className="fp-drag relative z-10 flex h-[var(--fp-rail-h)] shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full bg-current",
              paused || onBreak ? "opacity-40" : "led-live",
            )}
            aria-hidden="true"
          />
          <p className="fp-stencil fp-lock-dim">
            {paused ? "Paused — lock released" : onBreak ? "Break — lock released" : "Locked"}
          </p>
        </div>
        <p className="fp-lock-faint font-mono text-[11px] tabular">
          {paused ? "finish time on hold" : `free ${formatHmClock(timer.endsAtMs ?? Date.now())}`}
        </p>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <p
          className={cn(
            "fp-stencil fp-lock-in",
            // The field face lights the middle of the room, so its text has to
            // sit at full strength to stay legible on top of it.
            showFace && face.ambient ? "text-[color:var(--phase)]" : "fp-lock-dim",
          )}
        >
          {positionCaption(position, timer.status)}
        </p>

        {!showFace ? (
          <p className="fp-readout fp-lock-readout fp-lock-in mt-3" style={{ animationDelay: "60ms" }}>
            {formatReadout(remainingSec)}
          </p>
        ) : face.ambient ? null : (
          <div
            className="fp-lock-face fp-lock-in mt-4 flex w-full items-center justify-center"
            style={{ animationDelay: "60ms" }}
          >
            <face.Face
              progress={progress}
              remainingSec={remainingSec}
              totalSec={totalSec}
              className="h-full w-auto max-w-full"
            />
          </div>
        )}

        <p className="sr-only" aria-live="polite">
          {positionCaption(position, timer.status)}, {formatSpan(remainingSec)} remaining
        </p>

        <p
          className={cn(
            "fp-lock-in mt-6 max-w-[46ch] text-center text-[14px] leading-6",
            showFace && face.ambient ? "text-[color:var(--phase)]" : "fp-lock-dim",
          )}
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
        {multiRound ? (
          <div className="fp-lock-in w-full max-w-[760px]" style={{ animationDelay: "160ms" }}>
            <Ribbon segments={timer.segments} elapsedSec={timer.elapsedSec} variant="run" />
            <div className="fp-lock-faint mt-2 flex justify-between font-mono text-[11px] tabular">
              <span>{formatSpan(timer.elapsedSec)} in</span>
              <span>{formatSpan(timer.remainingSec)} left</span>
            </div>
          </div>
        ) : (
          // One block: the face already shows the proportion, so this is the
          // only number worth printing.
          <p className="fp-lock-faint font-mono text-[11px] tabular">
            {formatSpan(timer.remainingSec)} left
          </p>
        )}

        {!onBreak && !paused ? (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Sensor
              alert={Boolean(app.state.focus?.matchedBlock)}
              value={windowPrimary(app.state.focus)}
              detail={windowSecondary(app.state.focus)}
            />
            <Sensor
              alert={app.state.desk?.label === "away"}
              value={deskPrimary(app.state.desk)}
              detail={
                app.state.desk
                  ? `Desk AI ${formatConfidence(app.state.desk.confidence)}`
                  : "Desk AI standby"
              }
            />
            <Sensor
              alert={app.state.decision === "DISTRACTED" || app.state.decision === "AWAY"}
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
          {multiRound ? (
            <Quiet onClick={timer.skip}>{onBreak ? "Skip break" : "Skip round"}</Quiet>
          ) : null}
          <Quiet
            onClick={() => {
              void app.demoKill();
            }}
            tip="Skips the fuse: force-quit blocklist apps and cut armed plugs. Never the study PC."
          >
            <IconBolt className="h-3.5 w-3.5" />
            Demo kill
          </Quiet>
          <HoldSwitch
            label="Hold to end"
            holdingLabel="Ending…"
            tone="lock"
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
      className="relative flex h-full flex-col items-center justify-center gap-7 overflow-hidden bg-[var(--ground)] px-6 text-center text-[color:var(--phase)]"
    >
      <div className="fp-lock-in relative z-10">
        <p className="fp-stencil fp-lock-dim">Session complete</p>
        <h1 className="fp-display mt-3 text-[clamp(34px,6vw,64px)] font-semibold leading-[1.02]">
          {formatSpan(timer.workedSec)} of work.
          <br />
          <span className="fp-lock-dim">The lock is off.</span>
        </h1>
        <p className="fp-lock-dim mt-4 max-w-[52ch] text-[14px] leading-6">
          {short
            ? "You skipped part of the plan, so that is the focus time you actually served."
            : `${timer.plan.rounds} round${timer.plan.rounds === 1 ? "" : "s"} of ${timer.plan.focusMin} minutes.`}{" "}
          Everything is unblocked and any plug you armed is back on.
        </p>
      </div>

      <button
        type="button"
        onClick={timer.end}
        className="fp-btn fp-lock-btn relative z-10 h-11 w-full max-w-[320px] rounded-[var(--radius-fp)] px-4 text-[14px] font-semibold"
      >
        Back to the panel
      </button>
    </div>
  );
}

function Sensor(props: { alert: boolean; value: string; detail: string }): JSX.Element {
  return (
    <div className="flex min-w-0 max-w-[230px] items-start gap-2">
      <span
        className={cn(
          "mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full",
          props.alert ? "bg-fp-red" : "bg-current opacity-60",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 text-left">
        <p className={cn("truncate text-[12.5px] font-medium", props.alert && "text-fp-red")}>
          {props.value}
        </p>
        <p className="fp-lock-faint truncate text-[11px]">{props.detail}</p>
      </div>
    </div>
  );
}

function Quiet(props: { children: ReactNode; onClick: () => void; tip?: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-tip={props.tip}
      data-tip-up={props.tip ? "" : undefined}
      className="fp-btn fp-lock-btn inline-flex h-14 items-center justify-center gap-2 rounded-[var(--radius-fp)] px-5 text-[14px] font-medium"
    >
      {props.children}
    </button>
  );
}
