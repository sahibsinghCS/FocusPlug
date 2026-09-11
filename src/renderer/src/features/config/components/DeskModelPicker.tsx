import type { JSX, KeyboardEvent } from "react";
import type { DeskModelId } from "@shared/ipc";
import { cn } from "../../../lib/cn";
import { DESK_MODEL_CARDS } from "../deskModel";

export function DeskModelPicker(props: {
  value: DeskModelId;
  onChange: (id: DeskModelId) => void;
  disabled?: boolean;
}): JSX.Element {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = DESK_MODEL_CARDS.findIndex((card) => card.id === props.value);
    if (index < 0) {
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = DESK_MODEL_CARDS[(index + 1) % DESK_MODEL_CARDS.length];
      if (next) props.onChange(next.id);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = DESK_MODEL_CARDS[(index - 1 + DESK_MODEL_CARDS.length) % DESK_MODEL_CARDS.length];
      if (next) props.onChange(next.id);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Desk model"
      onKeyDown={onKeyDown}
      className="grid gap-2 md:grid-cols-3"
    >
      {DESK_MODEL_CARDS.map((card) => {
        const selected = props.value === card.id;
        return (
          <button
            key={card.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={props.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => props.onChange(card.id)}
            className={cn(
              "rounded-md border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "border-fp-lime/50 bg-fp-lime/[0.07]"
                : "border-fp-line bg-fp-elev hover:bg-fp-hover",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{card.title}</span>
              <span className="rounded border border-fp-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fp-faint">
                {card.badge}
              </span>
            </span>
            <span className="mt-1 block text-[11px] leading-snug text-fp-mute">{card.summary}</span>
            <span className="mt-1.5 block font-mono text-[10px] leading-snug text-fp-faint">
              {card.detail}
            </span>
          </button>
        );
      })}
    </div>
  );
}
