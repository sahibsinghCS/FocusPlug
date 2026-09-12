import type { JSX, KeyboardEvent } from "react";
import type { PlugProtocol } from "@shared/ipc";
import { cn } from "../../../lib/cn";
import { PROTOCOL_CARDS } from "../plugs";

export function ProtocolPicker(props: {
  value: PlugProtocol;
  onChange: (protocol: PlugProtocol) => void;
  disabled?: boolean;
}): JSX.Element {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = PROTOCOL_CARDS.findIndex((card) => card.id === props.value);
    if (index < 0) {
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = PROTOCOL_CARDS[(index + 1) % PROTOCOL_CARDS.length];
      if (next) props.onChange(next.id);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = PROTOCOL_CARDS[(index - 1 + PROTOCOL_CARDS.length) % PROTOCOL_CARDS.length];
      if (next) props.onChange(next.id);
    }
    if (event.key === "Home") {
      event.preventDefault();
      const first = PROTOCOL_CARDS[0];
      if (first) props.onChange(first.id);
    }
    if (event.key === "End") {
      event.preventDefault();
      const last = PROTOCOL_CARDS[PROTOCOL_CARDS.length - 1];
      if (last) props.onChange(last.id);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Plug protocol"
      onKeyDown={onKeyDown}
      className="grid gap-2 sm:grid-cols-3"
    >
      {PROTOCOL_CARDS.map((card) => {
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
              "rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "border-fp-focus/50 bg-fp-focus/[0.07]"
                : "border-fp-line bg-fp-elev hover:bg-fp-hover",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{card.title}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fp-faint">
                {card.id}
              </span>
            </span>
            <span className="mt-1 block text-[11px] leading-snug text-fp-mute">{card.summary}</span>
          </button>
        );
      })}
    </div>
  );
}
