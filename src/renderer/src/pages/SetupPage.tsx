import { useEffect, useState, type JSX } from "react";
import { ErrorBanner } from "../components/page";
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
  planSummary,
  planTotalSec,
  withEdit,
} from "../features/timer/plan";
import type { SessionTimer } from "../features/timer/useSessionTimer";
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
        <p className="fp-stencil">Session plan</p>
        <h1 className="fp-display fp-plan-hero mt-2 max-w-[20ch] font-semibold leading-[1.02] text-fp-ink">
          {formatSpan(workSec)} of work,
          <br />
          done by <span className="text-fp-focus">{formatHmClock(endsAt)}</span>.
        </h1>
        <p className="mt-3 text-[14px] text-fp-mute">
          {planSummary(timer.plan)} · {formatSpan(totalSec)} at the desk
        </p>
      </header>

      <section className="fp-rise" style={{ animationDelay: "60ms" }} aria-label="Session shape">
        <Ribbon segments={timer.segments} className="fp-plan-ribbon" />
        <div className="mt-2 flex items-baseline justify-between gap-4 font-mono text-[11px] text-fp-faint tabular">
          <span>now {formatHmClock(now)}</span>
          <span>free {formatHmClock(endsAt)}</span>
        </div>
      </section>

      <div
        className="fp-rise grid min-w-0 gap-4 min-[900px]:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]"
        style={{ animationDelay: "120ms" }}
      >
        <div className="fp-card flex min-w-0 flex-col gap-4 p-4">
          <ShapePicker
            plan={timer.plan}
            onPick={(id) => timer.setPlan(id === "custom" ? { ...timer.plan, shape: "custom" } : planFromShape(id))}
          />

          <div className="grid gap-4 border-t border-fp-line pt-4 min-[560px]:grid-cols-3">
            <Dial
              label="Focus"
              unit="min"
              value={timer.plan.focusMin}
              min={LIMITS.focusMin.min}
              max={LIMITS.focusMin.max}
              step={LIMITS.focusMin.step}
              onChange={(focusMin) => timer.setPlan(withEdit(timer.plan, { focusMin }))}
            />
            <Dial
              label="Break"
              unit="min"
              value={timer.plan.breakMin}
              min={LIMITS.breakMin.min}
              max={LIMITS.breakMin.max}
              step={LIMITS.breakMin.step}
              onChange={(breakMin) => timer.setPlan(withEdit(timer.plan, { breakMin }))}
            />
            <Dial
              label="Rounds"
              unit={timer.plan.rounds === 1 ? "round" : "rounds"}
              value={timer.plan.rounds}
              min={LIMITS.rounds.min}
              max={LIMITS.rounds.max}
              step={LIMITS.rounds.step}
              onChange={(rounds) => timer.setPlan(withEdit(timer.plan, { rounds }))}
              hint={breaks === 0 ? "One round, no break" : `${breaks} break${breaks === 1 ? "" : "s"}`}
            />
          </div>
        </div>

        <Stakes lists={app.lists} plugs={app.plugs} settings={app.settings} />
      </div>

      <div className="fp-rise mx-auto w-full max-w-[460px]" style={{ animationDelay: "180ms" }}>
        <HoldSwitch
          label="Hold to lock"
          holdingLabel="Locking…"
          onComplete={timer.start}
          hint={
            breaks > 0
              ? "Hold the switch for a moment. The lock lifts on its own for every break."
              : "Hold the switch for a moment. One round, no break — the lock holds the whole way."
          }
        />
      </div>
    </div>
  );
}
