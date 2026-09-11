import { useEffect, useState, type JSX } from "react";
import { cn } from "../../../lib/cn";

export function ConfirmAction(props: {
  label: string;
  confirmLabel: string;
  ariaLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}): JSX.Element {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setArmed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setArmed(true)}
        aria-label={props.ariaLabel}
        className="rounded-md px-2 py-1 text-[11px] font-medium text-fp-faint transition hover:bg-white/5 hover:text-fp-red disabled:cursor-not-allowed disabled:opacity-40"
      >
        {props.label}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => {
        setArmed(false);
        props.onConfirm();
      }}
      aria-label={`${props.confirmLabel} ${props.ariaLabel}`}
      className={cn(
        "rounded-md bg-fp-red/15 px-2 py-1 text-[11px] font-semibold text-fp-red transition hover:bg-fp-red/25",
        props.disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {props.confirmLabel}
    </button>
  );
}
