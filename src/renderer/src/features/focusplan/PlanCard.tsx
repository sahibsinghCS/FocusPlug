import { useId, useState, type CSSProperties, type JSX } from "react";
import { Chip, GhostButton, PrimaryButton } from "../../components/ui";
import { cn } from "../../lib/cn";
import { toneCard } from "../../lib/tone";
import { withEdit } from "../timer/plan";
import type { SessionTimer } from "../timer/useSessionTimer";
import { Evidence } from "./Evidence";
import { planCardView } from "./model";
import { usePlanRecommendation } from "./useFocusPlan";
import "./plan.css";

/**
 * The plan, before the switch. A recommended work length, a break, the
 * reasoning in plain language, and the evidence behind it one click away.
 *
 * Three properties this card exists to hold:
 *
 *  1. It is never empty. On a fresh install it says 25 minutes, says that is
 *     the pomodoro default and not a reading of anyone, and says what it is
 *     about to start measuring.
 *  2. It never claims what it cannot measure. Every sentence arrives from
 *     `src/shared/plan/copy.ts`, where a refused trend names the gate that
 *     stopped it instead of shrugging.
 *  3. It is an offer. The Dial below stays fully editable, the button only
 *     writes the plan, and nothing on this screen is ever enforced. There is
 *     no nag and no second prompt: disagree and the card says what your plan
 *     is, quietly, and stops talking.
 */
export function PlanCard(props: {
  timer: SessionTimer;
  className?: string;
  style?: CSSProperties;
}): JSX.Element | null {
  const { timer } = props;
  const plan = usePlanRecommendation();
  const [open, setOpen] = useState(false);
  const evidenceId = useId();

  if (plan.recommendation === null) {
    return null;
  }

  const view = planCardView(plan.recommendation, timer.plan);

  return (
    <section
      aria-label="Focus plan"
      className={cn("fp-card px-4 py-3", toneCard(view.tone), props.className)}
      style={props.style}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-fp-faint">
          {view.kicker}
        </p>
        {view.provisional ? <Chip tone="amber">Provisional</Chip> : null}
        {view.yourPlan === null ? <Chip tone="mute">matches your dial</Chip> : null}
        <GhostButton
          className="ml-auto h-7 px-2 text-[11px]"
          expanded={open}
          controls={evidenceId}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Hide the rounds" : "Why this?"}
        </GhostButton>
      </div>

      {/* The forecast panel's own split: the reading on the left, what makes
          it legible on the right. */}
      <div className="mt-2 grid gap-x-6 gap-y-3 min-[860px]:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.4fr)]">
        <div className="min-w-0">
          {/* balance, so "then 5 off." never wraps to a lonely last word */}
          <h2 className="fp-display text-[clamp(20px,2.4vw,26px)] font-semibold leading-[1.1] text-fp-ink [text-wrap:balance]">
            {view.headline}
          </h2>

          {view.matches ? null : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PrimaryButton
                onClick={() =>
                  timer.setPlan(
                    withEdit(timer.plan, { focusMin: view.focusMin, breakMin: view.breakMin }),
                  )
                }
              >
                {view.acceptLabel}
              </PrimaryButton>
              {view.yourPlan === null ? null : <Chip tone="mute">{view.yourPlan}</Chip>}
            </div>
          )}
          <p className="mt-2 max-w-[36ch] text-[12px] leading-4 text-fp-faint">
            {view.overrideLine}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[13px] leading-5 text-fp-mute">{view.reasoning}</p>

          {view.trendLine === null ? null : (
            <p className="mt-2 text-[13px] leading-5 text-fp-mute">{view.trendLine}</p>
          )}

          {view.forecastNote === null ? null : (
            <p className="mt-2 text-[12px] leading-5 text-fp-faint">{view.forecastNote}</p>
          )}
        </div>
      </div>

      {open ? (
        <Evidence
          id={evidenceId}
          rows={view.evidence}
          method={view.method}
          summary={view.evidenceSummary}
        />
      ) : null}
    </section>
  );
}
