import { useEffect, useState, type JSX } from "react";
import { normalizeFaceId, type FaceId } from "@shared/faces";
import { ErrorBanner } from "../components/page";
import { SetupFacePicker } from "../features/faces";
import { DebriefCard, PlanCard } from "../features/focusplan";
import { Dial } from "../features/timer/Dial";
import { HoldSwitch } from "../features/timer/HoldSwitch";
import { Ribbon } from "../features/timer/Ribbon";
import { ShapePicker } from "../features/timer/ShapePicker";
import { Stakes } from "../features/timer/Stakes";
import {
  breakCount,
  formatSpan,
  LIMITS,
  planFocusSec,
  planFromShape,
  planTotalSec,
  withEdit,
} from "../features/timer/plan";
import type { SessionTimer } from "../features/timer/useSessionTimer";
import { cn } from "../lib/cn";
import { formatHmClock } from "../lib/format";
import { useAppState } from "../state/AppState";
import "../features/timer/timer.css";

/** Re-reads the wall clock often enough that the finish time never goes stale. */
function useWallClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function SetupPage(props: { timer: SessionTimer }): JSX.Element {
  const app = useAppState();
  const { timer } = props;
  const now = useWallClock();
  const [roundsOpen, setRoundsOpen] = useState(() => timer.plan.rounds > 1);

  const totalSec = planTotalSec(timer.plan);
  const workSec = planFocusSec(timer.plan);
  const breaks = breakCount(timer.plan);
  const endsAt = now + totalSec * 1000;

  return (
    <div className="fp-plan">
      {app.error ? (
        <ErrorBanner
          title="FocusPlug error"
          message={app.error}
          hint="The plan is safe. Fix the fault and throw the switch again."
          onDismiss={app.clearError}
        />
      ) : null}

      <header className="fp-rise">
        <p className="fp-stencil">Session</p>
        <h1 className="fp-display fp-plan-hero mt-2 max-w-[20ch] font-semibold leading-[1.02] text-fp-ink">
          {formatSpan(workSec)} of work,
          <br />
          done by {formatHmClock(endsAt)}.
        </h1>
      </header>

      {/* The plan reads before you touch a dial — recommendation, reasoning,
          and the round that just ended, if one did. Nothing here is enforced.
          Both are direct children of the page's flex column: switched off they
          render nothing at all, gap included, and the screen is today's. */}
      <PlanCard timer={timer} className="fp-rise" style={{ animationDelay: "60ms" }} />
      <DebriefCard
        variant="setup"
        timer={timer}
        className="fp-rise"
        style={{ animationDelay: "90ms" }}
      />

      <section className="fp-rise" style={{ animationDelay: "120ms" }}>
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <p className="fp-stencil">Watch it run out</p>
          <p className="font-mono text-[11px] text-fp-faint tabular">live preview</p>
        </div>
        <SetupFacePicker
          value={normalizeFaceId(app.settings.faceId)}
          estimateMinutes={timer.plan.focusMin}
          onPick={(id: FaceId) => {
            void app.patchSettings({ faceId: id });
          }}
        />
      </section>

      <div
        className="fp-rise grid min-w-0 items-start gap-4 min-[900px]:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]"
        style={{ animationDelay: "180ms" }}
      >
        <div className="fp-card flex min-w-0 flex-col p-4">
          <Dial
            label="Length"
            unit="min"
            value={timer.plan.focusMin}
            min={LIMITS.focusMin.min}
            max={LIMITS.focusMin.max}
            step={LIMITS.focusMin.step}
            onChange={(focusMin) => timer.setPlan(withEdit(timer.plan, { focusMin }))}
          />

          <button
            type="button"
            aria-expanded={roundsOpen}
            aria-controls="fp-rounds"
            onClick={() => setRoundsOpen((open) => !open)}
            className="fp-btn mt-4 flex items-center justify-between gap-3 border-t border-fp-line pt-3 text-left"
          >
            <span className="fp-stencil">Rounds and breaks</span>
            <span className="flex items-center gap-2 text-[12px] text-fp-mute">
              {breaks === 0
                ? "one unbroken block"
                : `${timer.plan.rounds} rounds · ${breaks} break${breaks === 1 ? "" : "s"}`}
              <Chevron open={roundsOpen} />
            </span>
          </button>

          {roundsOpen ? (
            <div id="fp-rounds" className="mt-3 flex flex-col gap-4">
              <ShapePicker
                plan={timer.plan}
                onPick={(id) =>
                  timer.setPlan(
                    id === "custom" ? { ...timer.plan, shape: "custom" } : planFromShape(id),
                  )
                }
              />

              <div className="grid gap-4 min-[520px]:grid-cols-2">
                <Dial
                  label="Rounds"
                  unit={timer.plan.rounds === 1 ? "round" : "rounds"}
                  value={timer.plan.rounds}
                  min={LIMITS.rounds.min}
                  max={LIMITS.rounds.max}
                  step={LIMITS.rounds.step}
                  onChange={(rounds) => timer.setPlan(withEdit(timer.plan, { rounds }))}
                />
                <Dial
                  label="Break"
                  unit="min"
                  value={timer.plan.breakMin}
                  min={LIMITS.breakMin.min}
                  max={LIMITS.breakMin.max}
                  step={LIMITS.breakMin.step}
                  onChange={(breakMin) => timer.setPlan(withEdit(timer.plan, { breakMin }))}
                  hint={breaks === 0 ? "Add a round to get a break" : undefined}
                />
              </div>

              {breaks > 0 ? (
                <div>
                  <Ribbon segments={timer.segments} className="fp-plan-ribbon" />
                  <div className="mt-2 flex justify-between font-mono text-[11px] text-fp-faint tabular">
                    <span>now {formatHmClock(now)}</span>
                    <span>free {formatHmClock(endsAt)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <Stakes lists={app.lists} plugs={app.plugs} settings={app.settings} />
      </div>

      <div className="fp-rise mx-auto w-full max-w-[460px]" style={{ animationDelay: "240ms" }}>
        <HoldSwitch
          label="Hold to lock"
          holdingLabel="Locking…"
          onComplete={timer.start}
          hint={
            breaks > 0
              ? "Hold the switch for a moment. The lock lifts on its own for every break."
              : "Hold the switch for a moment. Nothing unlocks until the session is done."
          }
        />
      </div>
    </div>
  );
}

function Chevron(props: { open: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={cn("h-3 w-3 transition-transform duration-200", props.open && "rotate-180")}
    >
      <path d="M3 4.5 L6 7.5 L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
