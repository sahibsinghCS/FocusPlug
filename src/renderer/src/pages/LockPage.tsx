import { useRef, type JSX, type ReactNode } from "react";
import { faceMeta, normalizeFaceId } from "@shared/faces";
import { pauseNotice } from "@shared/nudge";
import { FaceErrorBoundary, buildLockFaceProps, faceComponent } from "../features/faces";
import { DebriefCard } from "../features/focusplan";
import { formatFaceClock } from "../features/faces/clock";
import { useHostSize } from "../features/faces/useHostSize";
import { useLiveFaceNow } from "../features/faces/useLiveFaceNow";
import { HoldSwitch } from "../features/timer/HoldSwitch";
import { Ribbon } from "../features/timer/Ribbon";
import { formatSpan, planFocusSec } from "../features/timer/plan";
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
import "../features/faces/faces.css";

const LOCK_FACE_FALLBACK = { width: 960, height: 520 };

/**
 * Lock mode. The console gets out of the way and leaves one object running
 * out, whichever one you picked. A break inverts the whole room — black on
 * bone instead of bone on black — so the lock lifting is visible from the
 * doorway without a single hue being involved. Faces stay night instruments
 * and sit on that bone table as a mounted plate, not a leftover dark field.
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
  // Stopped by a drift main confirmed, rather than by them. The clock will sit
  // here until they say otherwise, so the screen owes them the reason.
  const drift = timer.pausedBy === null ? null : pauseNotice(timer.pausedBy);
  const phase = onBreak ? "break" : "focus";
  const armedPlugs = enabledPlugViews(app.plugs);
  const multiRound = timer.segments.length > 1;
  // Immersive faces that draw no clock of their own still owe you the number.
  const lockFace = faceMeta(normalizeFaceId(app.settings.faceId));
  const timeLeftSec = position?.remainingSec ?? timer.remainingSec;

  return (
    <div
      id="fp-lock"
      data-phase={phase}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ground)] text-[color:var(--phase)]"
    >
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
            {drift
              ? drift.kicker
              : paused
                ? "Paused — lock released"
                : onBreak
                  ? "Break — lock released"
                  : "Locked"}
          </p>
        </div>
        <p className="fp-lock-faint font-mono text-[11px] tabular">
          {paused ? "finish time on hold" : `free ${formatHmClock(timer.endsAtMs ?? Date.now())}`}
        </p>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col px-6">
        <div className="flex shrink-0 items-baseline justify-between gap-4 pt-1">
          <p className="fp-stencil fp-lock-in fp-lock-dim">{positionCaption(position, timer.status)}</p>
          {lockFace.showsTimeLeft ? null : (
            <p className="fp-lock-clock fp-lock-in font-mono tabular" data-lock-clock="" aria-hidden="true">
              {formatFaceClock(timeLeftSec * 1000)}
            </p>
          )}
        </div>

        <LockFaceStage timer={timer} />

        <p className="sr-only" aria-live="polite">
          {positionCaption(position, timer.status)}, {formatSpan(position?.remainingSec ?? timer.remainingSec)} remaining
        </p>

        <p
          className="fp-lock-in mx-auto mt-3 max-w-[46ch] shrink-0 pb-2 text-center text-[14px] leading-6 fp-lock-dim"
          style={{ animationDelay: "120ms" }}
          aria-live="polite"
        >
          {drift
            ? drift.line
            : paused
              ? "Clock stopped, nothing enforced. Resume when you are back."
              : onBreak
                ? "Blocked apps are yours again until the next round."
                : "Leave the assignment and the fuse starts."}
        </p>

        {/* The break is exactly when you want to know how the round went, and
            the lock is already off — so the debrief sits here rather than
            interrupting the round it is about. */}
        {onBreak ? (
          <div
            className="fp-lock-in mx-auto w-full max-w-[620px] shrink-0 pb-2 text-left"
            style={{ animationDelay: "160ms" }}
          >
            <DebriefCard variant="break" timer={timer} />
          </div>
        ) : null}
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

        <div className="fp-lock-bar flex flex-wrap items-center justify-center gap-2">
          {/* One obvious way back. A drift-stopped clock makes it the loud
              button on the bar, because restarting it is the only thing the
              student is here to do. */}
          {drift ? (
            <button
              type="button"
              onClick={timer.resume}
              className="fp-btn fp-lock-btn inline-flex h-14 items-center justify-center gap-2 rounded-[var(--radius-fp)] bg-fp-focus px-6 text-[14px] font-semibold text-black hover:brightness-110"
            >
              {drift.action}
            </button>
          ) : (
            <Quiet onClick={paused ? timer.resume : timer.pause}>
              {paused ? "Resume" : "Pause"}
            </Quiet>
          )}
          {/* The one door out of the sealed room that does not end the
              session: the instruments the lock face deliberately hides —
              decision, forecast, sensors, the enforcement chain. */}
          <Quiet
            onClick={timer.openConsole}
            tip="Leave the full-screen face for the instruments. The session keeps running and stays armed."
          >
            Console
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

function LockFaceStage(props: { timer: SessionTimer }): JSX.Element {
  const app = useAppState();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const size = useHostSize(stageRef, LOCK_FACE_FALLBACK);
  const faceId = normalizeFaceId(app.settings.faceId);
  const Face = faceComponent(faceId);
  const now = useLiveFaceNow();
  const face = buildLockFaceProps({
    status: props.timer.status,
    position: props.timer.position,
    elapsedSec: props.timer.elapsedSec,
    remainingSec: props.timer.remainingSec,
    planFocusMin: props.timer.plan.focusMin,
    log: app.log,
    startedAtMs: props.timer.startedAtMs,
    now,
    width: size.width,
    height: size.height,
  });

  return (
    <div
      ref={stageRef}
      className="fp-lock-stage fp-lock-in relative min-h-0 w-full flex-1"
      style={{ animationDelay: "60ms" }}
      data-face={faceId}
      data-face-paused={face.paused ? "1" : "0"}
    >
      <FaceErrorBoundary faceId={faceId}>
        <Face {...face} />
      </FaceErrorBoundary>
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

      <div className="fp-lock-in relative z-10 w-full max-w-[620px] text-left">
        <DebriefCard variant="done" timer={timer} />
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
