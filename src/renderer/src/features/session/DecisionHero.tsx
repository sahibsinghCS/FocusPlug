import type { JSX } from "react";
import type { Decision } from "@shared/ipc";
import { Chip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { toneCard, toneText } from "../../lib/tone";
import { decisionConsequence, decisionHeroCopy } from "./model";

/**
 * The verdict, in the largest type on the page.
 *
 * Shared because three surfaces render the same verdict against the same
 * `decisionHeroCopy`: the live console (SessionPage), the forecast preview
 * and the judge demo. `compact` drops the consequence line for the two
 * side-by-side layouts, where the clock sits in the other half of the row.
 */
export function DecisionHero(props: {
  decision: Decision;
  detail: string;
  sessionActive: boolean;
  strictMode?: boolean;
  usingMock?: boolean;
  compact?: boolean;
}): JSX.Element {
  const copy = decisionHeroCopy(props.decision, props.detail);

  return (
    <section
      className={cn("fp-card relative min-w-0 overflow-hidden px-4 py-3", toneCard(copy.tone))}
      aria-labelledby="fp-session-decision"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="fp-section-label">Decision</p>
        <Chip tone={copy.tone}>{copy.verb}</Chip>
        <Chip tone={props.sessionActive ? "focus" : "mute"}>
          {props.sessionActive ? "Live" : "Standby"}
        </Chip>
        {props.strictMode !== undefined ? (
          <Chip tone={props.strictMode ? "focus" : "mute"}>
            {props.strictMode ? "Strict" : "Loose"}
          </Chip>
        ) : null}
        {props.usingMock ? <Chip tone="warn">Mock IPC</Chip> : null}
      </div>

      <h1
        id="fp-session-decision"
        className={cn(
          "fp-display mt-2 text-[clamp(28px,4.2vw,44px)] font-semibold leading-[0.92] tracking-[-0.04em]",
          toneText(copy.tone),
        )}
        aria-live="polite"
      >
        {copy.headline}
      </h1>
      <p className="mt-2 text-[13px] leading-5 text-fp-mute">{copy.explanation}</p>
      {props.compact ? null : (
        <p className="mt-1 text-[12px] text-fp-faint">{decisionConsequence(props.decision)}</p>
      )}
    </section>
  );
}
