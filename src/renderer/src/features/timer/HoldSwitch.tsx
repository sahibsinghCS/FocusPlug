import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { cn } from "../../lib/cn";

const HOLD_MS = 620;

/**
 * Throwing a breaker, not clicking a button. Locking your machine down for
 * three hours should cost a deliberate gesture, and the same gesture gets you
 * back out — which is also why a stray click can never arm or end a session.
 *
 * The commitment is on a timer and the sweep is a CSS transition: an occluded
 * window stops painting frames, and the switch has to work anyway.
 */
export function HoldSwitch(props: {
  label: string;
  holdingLabel: string;
  onComplete: () => void;
  tone?: "phase" | "danger" | "lock";
  hint?: string;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const [holding, setHolding] = useState(false);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeRef = useRef(props.onComplete);
  completeRef.current = props.onComplete;
  const danger = props.tone === "danger";
  const lock = props.tone === "lock";

  const paint = useCallback((to: number, ms: number): void => {
    const node = fillRef.current;
    if (node) {
      node.style.transition = `transform ${ms}ms linear`;
      node.style.transform = `scaleX(${to})`;
    }
  }, []);

  const cancel = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
    paint(0, 160);
  }, [paint]);

  const begin = useCallback((): void => {
    if (props.disabled || timerRef.current !== null) {
      return;
    }
    setHolding(true);
    paint(1, HOLD_MS);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      paint(0, 0);
      completeRef.current();
    }, HOLD_MS);
  }, [paint, props.disabled]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return (
    <div className={cn("min-w-0", props.className)}>
      <button
        type="button"
        disabled={props.disabled}
        onPointerDown={(event) => {
          event.preventDefault();
          begin();
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            begin();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") {
            cancel();
          }
        }}
        onBlur={cancel}
        aria-describedby={props.hint ? "fp-hold-hint" : undefined}
        className={cn(
          "fp-btn group relative flex w-full select-none items-center justify-center overflow-hidden rounded-[var(--radius-fp)] border disabled:cursor-not-allowed disabled:opacity-40",
          lock && "fp-lock-btn h-14",
          danger && "h-14 border-fp-line text-fp-mute hover:border-fp-red/40 hover:bg-fp-red/10 hover:text-fp-red",
          !lock && !danger &&
            "h-[58px] border-[1.5px] border-fp-ink/45 bg-fp-ink/[0.07] text-fp-ink hover:border-fp-ink/70 hover:bg-fp-ink/[0.13]",
        )}
      >
        <span
          ref={fillRef}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 origin-left scale-x-0",
            lock ? "fp-lock-fill" : danger ? "bg-fp-red/25" : "bg-fp-ink/20",
          )}
        />
        <span
          className={cn(
            "fp-display relative flex items-center gap-2.5 font-semibold tracking-[0.02em]",
            danger || lock ? "text-[14px]" : "text-[17px]",
          )}
        >
          <SwitchGlyph thrown={holding} className={danger || lock ? "h-4 w-4" : "h-[19px] w-[19px]"} />
          {holding ? props.holdingLabel : props.label}
        </span>
      </button>
      {props.hint ? (
        <p id="fp-hold-hint" className="fp-hold-hint mt-2.5 text-center text-[12px] text-fp-faint">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

function SwitchGlyph(props: { thrown: boolean; className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" fill="none" className={props.className} aria-hidden="true">
      <rect
        x="2.4"
        y="2.4"
        width="13.2"
        height="13.2"
        rx="3.4"
        stroke="currentColor"
        strokeWidth="1.3"
        opacity="0.55"
      />
      <rect
        x="5.6"
        y={props.thrown ? "9.2" : "4.6"}
        width="6.8"
        height="4.2"
        rx="1.4"
        fill="currentColor"
        style={{ transition: "y 140ms cubic-bezier(0.2,0.8,0.2,1)" }}
      />
    </svg>
  );
}
