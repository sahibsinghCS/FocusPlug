import type { JSX } from "react";
import type { Decision } from "@shared/ipc";
import { cn } from "../../lib/cn";
import { Chip } from "../../components/ui";
import { decisionConsequence, decisionHeroCopy } from "./model";
import { DecisionGlyph } from "./icons";

export function DecisionHero(props: {
  decision: Decision;
  detail: string;
  sessionActive: boolean;
  strictMode?: boolean;
  usingMock?: boolean;
}): JSX.Element {
  const copy = decisionHeroCopy(props.decision, props.detail);
  const toneClass =
    copy.tone === "lime"
      ? "text-fp-lime"
      : copy.tone === "red"
        ? "text-fp-red"
        : copy.tone === "amber"
          ? "text-fp-amber"
          : "text-fp-ink";
  const glow =
    copy.tone === "lime"
      ? "shadow-[inset_0_0_80px_rgba(212,255,58,0.08)]"
      : copy.tone === "red"
        ? "shadow-[inset_0_0_80px_rgba(255,45,85,0.12)]"
        : copy.tone === "amber"
          ? "shadow-[inset_0_0_80px_rgba(255,176,32,0.1)]"
          : "shadow-none";

  return (
    <section
      className={cn(
        "fp-session-hero relative min-w-0 overflow-hidden rounded-lg border border-fp-line bg-fp-panel px-5 py-4",
        glow,
      )}
      aria-labelledby="fp-session-decision"
    >
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-fp-faint">
          Decision
        </p>
        <Chip tone={copy.tone}>{copy.verb}</Chip>
        <Chip tone={props.sessionActive ? "lime" : "mute"}>
          {props.sessionActive ? "Live" : "Standby"}
        </Chip>
        {props.strictMode !== undefined ? (
          <Chip tone={props.strictMode ? "lime" : "mute"}>
            {props.strictMode ? "Strict" : "Loose"}
          </Chip>
        ) : null}
        {props.usingMock ? <Chip tone="amber">Mock IPC</Chip> : null}
      </div>

      <div className="mt-3 flex items-center gap-4">
        <DecisionGlyph
          decision={props.decision}
          className={cn("h-14 w-14 shrink-0 sm:h-16 sm:w-16", toneClass)}
        />
        <div className="min-w-0">
          <h1
            id="fp-session-decision"
            className={cn(
              "text-[clamp(40px,6vw,72px)] font-semibold leading-[0.92] tracking-[-0.04em]",
              toneClass,
            )}
            aria-live="polite"
          >
            {copy.headline}
          </h1>
          <p className="mt-2 max-w-2xl truncate text-[15px] text-fp-ink" title={copy.explanation}>
            {copy.explanation}
          </p>
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-[13px] leading-5 text-fp-mute">
        {decisionConsequence(props.decision)}
      </p>
    </section>
  );
}
