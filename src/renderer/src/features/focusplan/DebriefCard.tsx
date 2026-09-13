import { useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { debriefFor } from "@shared/plan";
import { Chip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { useAppState } from "../../state/AppState";
import { formatSpan } from "../timer/plan";
import type { SessionTimer } from "../timer/useSessionTimer";
import { HoldSparkline } from "./HoldSparkline";
import {
  holdSparkline,
  isFreshDebrief,
  newestRound,
  sessionRollup,
  signalPhraseFor,
} from "./model";
import { usePlanRecommendation } from "./useFocusPlan";
import "./plan.css";

/**
 * The post-round debrief: where the risk peaked, the drift rhythm, what the
 * round cost, the headline number with its trend, and what to try next.
 *
 * One component, three existing homes and no new route — the break panel, the
 * finished panel, and the setup page for a round that just ended. It never
 * interrupts: there is no modal, no toast, and it renders only once a round
 * has actually closed, because a debrief of nothing is the empty state this
 * whole feature exists to avoid.
 *
 * `theNumber` is non-nullable by contract. Even the two rounds that do not
 * count — too short, or started with a blocked app already up — say plainly
 * what was and was not measured rather than going quiet.
 */
export function DebriefCard(props: {
  variant: "setup" | "break" | "done";
  timer: SessionTimer;
  className?: string;
  style?: CSSProperties;
}): JSX.Element | null {
  const app = useAppState();
  const plan = usePlanRecommendation();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  if (!app.settings.focusPlanEnabled || !plan.state.enabled) {
    return null;
  }
  const round = newestRound(plan.state.rounds);
  if (round === null) {
    return null;
  }
  if (props.variant === "setup") {
    if (dismissedKey === round.roundKey || !isFreshDebrief(round, Date.now())) {
      return null;
    }
  }

  const debrief = debriefFor({
    round,
    rounds: plan.estimatorWindow,
    forecastEnabled: app.settings.forecastEnabled,
    stretchEnabled: app.settings.focusPlanStretchEnabled,
    lifetimeRounds: plan.state.lifetimeRounds,
    signalPhrase: signalPhraseFor(round, app.forecastEvents),
  });
  const { copy } = debrief;
  const spark = holdSparkline(debrief.series, {
    medianMin: debrief.next.estimate.medianMin,
    trend: debrief.next.trend,
  });
  const lock = props.variant !== "setup";
  const rollup = props.variant === "done" ? sessionRollup(plan.state.rounds, props.timer.startedAtMs) : null;
  const compact = props.variant === "break";

  return (
    <section
      aria-label="Round debrief"
      className={cn(
        "px-4 py-3",
        lock ? "fp-plan-lock" : "fp-card",
        props.className,
      )}
      style={props.style}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p
          className={cn(
            "text-[11px] font-medium uppercase tracking-[0.22em]",
            lock ? "fp-lock-faint" : "text-fp-faint",
          )}
        >
          {copy.kicker}
        </p>
        {/* On the lock surface every colour has to be mixed out of --phase, or
            it reads as a hole in the bone room a break paints. The console
            chip is the console's; the lock gets the same word in phase ink. */}
        {!debrief.notCounted ? null : lock ? (
          <span className="fp-lock-faint text-[10px] font-semibold uppercase tracking-[0.16em]">
            not counted
          </span>
        ) : (
          <Chip tone="mute">Not counted</Chip>
        )}
        {props.variant === "setup" ? (
          <button
            type="button"
            onClick={() => setDismissedKey(round.roundKey)}
            className="fp-btn ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-fp-faint hover:bg-white/5 hover:text-fp-ink"
          >
            Dismiss
          </button>
        ) : null}
      </div>

      <h2
        className={cn(
          "fp-display mt-2 max-w-[24ch] font-semibold leading-[1.08] [text-wrap:balance]",
          compact ? "text-[clamp(18px,2.2vw,24px)]" : "text-[clamp(20px,2.6vw,28px)]",
          lock ? null : "text-fp-ink",
        )}
      >
        {copy.headline}
      </h2>

      <dl className="mt-3 flex flex-col gap-2">
        {copy.whereItWent === null ? null : (
          <Line label="Where it went" lock={lock}>
            {copy.whereItWent}
          </Line>
        )}
        {copy.rhythm === null ? null : (
          <Line label="The rhythm" lock={lock}>
            {copy.rhythm}
          </Line>
        )}
        {compact || copy.cost === null ? null : (
          <Line label="What it cost" lock={lock}>
            {copy.cost}
          </Line>
        )}
        <Line label="The number" lock={lock}>
          {copy.theNumber}
          {spark.empty ? null : (
            <span className="mt-2 flex items-center gap-2">
              <HoldSparkline view={spark} className={lock ? "fp-lock-dim" : undefined} />
              <span className={cn("text-[11px]", lock ? "fp-lock-faint" : "text-fp-faint")}>
                {spark.caption}
              </span>
            </span>
          )}
        </Line>
        <Line label="Next round" lock={lock}>
          {copy.nextRound}
        </Line>
      </dl>

      {copy.notCountedLine === null ? null : (
        <p className={cn("mt-2 text-[12px] leading-5", lock ? "fp-lock-faint" : "text-fp-faint")}>
          {copy.notCountedLine}
        </p>
      )}

      {rollup === null ? null : (
        <div className="mt-3 border-t border-current/10 pt-3">
          <p
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.16em]",
              lock ? "fp-lock-faint" : "text-fp-faint",
            )}
          >
            This session
          </p>
          <p
            className={cn(
              "mt-1 font-mono text-[11px] tabular",
              lock ? "fp-lock-dim" : "text-fp-mute",
            )}
          >
            {rollup.rounds} {rollup.rounds === 1 ? "round" : "rounds"} · {formatSpan(rollup.servedSec)}{" "}
            served
            {rollup.firstDriftsMin.length > 0
              ? ` · first drift ${rollup.firstDriftsMin.map((m) => Math.round(m)).join(", ")} min`
              : " · no drifts"}
            {rollup.medianMin === null ? "" : ` · median ${Math.round(rollup.medianMin * 10) / 10}`}
            {rollup.kills > 0 ? ` · ${rollup.kills} ${rollup.kills === 1 ? "kill" : "kills"}` : ""}
          </p>
        </div>
      )}

      {/* No accept button here, deliberately. On the setup page the plan card
          directly above is already offering these exact minutes, and a second
          button for the same number is a nag; on a break or at the finish, a
          plan edit would resize the run that is still on screen. The offer has
          one home. */}
      <p className={cn("mt-3 text-[12px] leading-4", lock ? "fp-lock-faint" : "text-fp-faint")}>
        Nothing here left this machine.
      </p>
    </section>
  );
}

function Line(props: { label: string; lock: boolean; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt
        className={cn(
          "shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] sm:w-[104px] sm:pt-[3px]",
          props.lock ? "fp-lock-faint" : "text-fp-faint",
        )}
      >
        {props.label}
      </dt>
      <dd
        className={cn(
          "m-0 max-w-[70ch] text-[13px] leading-5",
          props.lock ? "fp-lock-dim" : "text-fp-mute",
        )}
      >
        {props.children}
      </dd>
    </div>
  );
}
