import { useEffect, useState, type JSX } from "react";
import type { CorrectionVerdict } from "@shared/correction/types";
import type { PauseKind } from "@shared/nudge";
import type { RunStatus } from "../timer/runtime";
import {
  VERDICT_OUTCOME_MS,
  verdictAction,
  verdictOutcomeView,
  verdictRowView,
  type VerdictOutcomeView,
} from "./model";
import { useCorrections } from "./useCorrections";
import "./corrections.css";

/**
 * The two chips on the paused lock screen, and the sentence that follows them.
 *
 * Three controls on this screen, three meanings, and no fourth:
 *
 *  - **I was working** records `verdict: "wrong"`, arms the cooldown, retracts
 *    a false drift from Focus Plan where there is one, AND resumes the clock
 *    in the same tap. The student said the app was wrong; making them press a
 *    second button to undo the app's mistake would be the app arguing.
 *  - **You were right** records `verdict: "right"` and does NOT resume: they
 *    were on their phone, and the way back is to put it down and press the
 *    primary button, which is right there.
 *  - **Start the clock again** — `LockPage`'s existing primary, unchanged, and
 *    it records NOTHING. Silence is not a label. A student in a hurry produces
 *    no data, which is correct: a verdict they did not give is not evidence.
 *
 * Deliberately not on `NudgeOverlay`, which auto-dismisses after 12 seconds.
 * Verdict controls that vanish on a timer are a trap — the student looks up,
 * reads, reaches, and the buttons are gone. Only the CONFIRMATION fades.
 *
 * The component is a thin shell: which controls may be shown, what each tap
 * does and every sentence it prints all come out of `model.ts`, where a test
 * can drive them without a DOM.
 */
export function VerdictRow(props: {
  status: RunStatus;
  pausedBy: PauseKind | null;
  /** Called by *I was working*, in the same tap and before any write. */
  onResume: () => void;
  /** Injected by the stills script so a screenshot needs no live main. */
  now?: number;
}): JSX.Element | null {
  const corrections = useCorrections();
  const [answered, setAnswered] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<VerdictOutcomeView | null>(null);

  // Long enough to read once. It clears itself rather than sitting under a
  // running clock for the rest of the round.
  useEffect(() => {
    if (outcome === null) {
      return;
    }
    const id = setTimeout(() => setOutcome(null), VERDICT_OUTCOME_MS);
    return () => clearTimeout(id);
  }, [outcome]);

  const now = props.now ?? Date.now();
  const view = verdictRowView({
    pending: corrections.state.pending,
    status: props.status,
    pausedBy: props.pausedBy,
    now,
    answeredId: answered,
  });

  // The window lapsed, the verdict is in, or there was never a capture. Either
  // way the chips are gone — the screen must never offer a button that would
  // fail — but a sentence the student just earned outlives the resume that
  // took the paused screen away.
  if (view === null) {
    return outcome === null ? null : <Shell>{<Outcome outcome={outcome} />}</Shell>;
  }

  async function answer(verdict: CorrectionVerdict): Promise<void> {
    const pending = corrections.state.pending;
    if (pending === null) {
      return;
    }
    const action = verdictAction(pending.id, verdict);
    setAnswered(pending.id);
    // The behavioural half does not wait for a model, a write or a promise.
    // The student is the authority in the moment; the record is bookkeeping.
    if (action.resume) {
      props.onResume();
    }
    const result = action.record === null ? null : await corrections.record(action.record);
    setOutcome(
      verdictOutcomeView({
        kind: pending.kind,
        verdict,
        cooldown: result?.cooldown ?? null,
        retraction: result?.retraction ?? null,
        recorded: result?.recorded === true,
        capped: pending.capped,
        now: Date.now(),
      }),
    );
  }

  return (
    <Shell>
      <div data-verdict-row="">
        <p className="fp-lock-dim text-[13px] font-medium">{view.question}</p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={corrections.busy}
            onClick={() => {
              void answer("wrong");
            }}
            className="fp-btn fp-verdict-chip inline-flex h-11 items-center justify-center px-4 text-[13px] font-semibold"
          >
            {view.wrongLabel}
          </button>
          <button
            type="button"
            disabled={corrections.busy}
            onClick={() => {
              void answer("right");
            }}
            className="fp-btn fp-verdict-chip inline-flex h-11 items-center justify-center px-4 text-[13px] font-semibold"
          >
            {view.rightLabel}
          </button>
        </div>
        <p className="fp-lock-faint mt-2 text-[11px] leading-4">{view.note}</p>
      </div>
    </Shell>
  );
}

function Shell(props: { children: JSX.Element }): JSX.Element {
  return (
    <div
      className="fp-verdict fp-lock-in mx-auto w-full max-w-[560px] shrink-0 pb-1 text-center"
      style={{ animationDelay: "140ms" }}
    >
      {props.children}
    </div>
  );
}

function Outcome(props: { outcome: VerdictOutcomeView }): JSX.Element {
  return (
    <div data-verdict-outcome="">
      <p className="fp-lock-dim text-[13px] leading-5" aria-live="polite">
        {props.outcome.line}
      </p>
      {props.outcome.planLine === null ? null : (
        <p className="fp-lock-faint mt-1 text-[11px] leading-4">{props.outcome.planLine}</p>
      )}
    </div>
  );
}
