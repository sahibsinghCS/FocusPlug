import { useEffect, useRef, type JSX } from "react";
import type { NudgeEvent, NudgeKind } from "@shared/ipc";
import { nudgeCopy } from "@shared/nudge";
import type { RunPosition } from "../timer/runtime";
import { nudgeTiming } from "./timing";

/** How long a nudge stays up when they do not dismiss it. */
export const NUDGE_VISIBLE_MS = 12_000;

const KICKER: Record<NudgeKind, string> = {
  phone: "On your phone",
  unfocused: "Drifting",
  blocked: "Blocked app",
};

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/**
 * The pull-back. Main brought the window to the front; this puts the time
 * left front and centre with a line of encouragement. Unlike the kill overlay
 * it is not a threat, so it dismisses on a click, Escape, or by itself.
 */
export function NudgeOverlay(props: {
  nudge: NudgeEvent;
  position: RunPosition | null;
  onDismiss: () => void;
}): JSX.Element {
  const { onDismiss } = props;
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
    const timeout = setTimeout(onDismiss, NUDGE_VISIBLE_MS);
    return () => clearTimeout(timeout);
  }, [props.nudge.ts, onDismiss]);

  const timing = nudgeTiming(props.position);
  const copy = nudgeCopy({ kind: props.nudge.kind, app: props.nudge.app, ...timing });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fp-nudge-title"
      aria-describedby="fp-nudge-line"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onDismiss();
        }
      }}
    >
      <div className="w-full max-w-[560px] rounded-[var(--radius-fp)] border border-fp-focus/40 bg-[#07080c] px-8 py-9 text-center text-white shadow-[0_0_80px_rgba(242,241,236,0.1)]">
        <p className="fp-stencil text-fp-focus">{KICKER[props.nudge.kind]}</p>
        <h2 id="fp-nudge-title" className="mt-3 text-[34px] font-semibold leading-tight">
          {copy.title}
        </h2>
        {timing.remainingSec !== null ? (
          <>
            <p className="fp-readout mt-5 text-[min(18vw,112px)] leading-none text-white">
              {formatClock(timing.remainingSec)}
            </p>
            <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.2em] text-zinc-400">
              {timing.until === "break" ? "to your break" : "left in this session"}
            </p>
          </>
        ) : null}
        <p id="fp-nudge-line" className="mt-6 text-[19px] font-medium text-zinc-100" aria-live="polite">
          {copy.line}
        </p>
        <button
          ref={buttonRef}
          type="button"
          onClick={onDismiss}
          className="fp-btn mt-8 inline-flex h-11 min-w-[220px] items-center justify-center rounded-[var(--radius-fp)] bg-fp-focus px-5 text-[13px] font-semibold uppercase tracking-[0.14em] text-black hover:brightness-110"
        >
          Back to it
        </button>
      </div>
    </div>
  );
}
