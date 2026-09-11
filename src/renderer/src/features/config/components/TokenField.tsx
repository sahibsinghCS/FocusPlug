import { useState, type JSX, type KeyboardEvent } from "react";
import { cn } from "../../../lib/cn";
import { commitTokenDraft } from "../lists";

export function TokenField(props: {
  id: string;
  tokens: readonly string[];
  onChange: (tokens: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  ariaLabel?: string;
}): JSX.Element {
  const [draft, setDraft] = useState("");

  function commit(raw: string = draft): void {
    const next = commitTokenDraft(props.tokens, raw);
    setDraft("");
    if (next.length !== props.tokens.length || next.some((token, i) => token !== props.tokens[i])) {
      props.onChange(next);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      if (draft.trim().length > 0) {
        event.preventDefault();
        commit();
      }
      return;
    }
    if (event.key === "Backspace" && draft.length === 0 && props.tokens.length > 0) {
      event.preventDefault();
      props.onChange(props.tokens.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-8 min-w-0 flex-wrap items-center gap-1 rounded-md border bg-fp-elev px-1.5 py-1",
        props.invalid ? "border-fp-red/60" : "border-fp-line",
        props.disabled && "opacity-40",
      )}
    >
      <ul className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Match tokens">
        {props.tokens.map((token) => (
          <li key={token}>
            <span className="inline-flex items-center gap-0.5 rounded border border-fp-line bg-white/5 py-0.5 pl-1.5 pr-0.5 font-mono text-[11px] text-fp-ink">
              {token}
              <button
                type="button"
                disabled={props.disabled}
                aria-label={`Remove token ${token}`}
                onClick={() => props.onChange(props.tokens.filter((item) => item !== token))}
                className="rounded px-1 text-[10px] text-fp-faint hover:text-fp-red"
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <input
        id={props.id}
        value={draft}
        disabled={props.disabled}
        placeholder={props.tokens.length === 0 ? props.placeholder : "Add token"}
        aria-label={props.ariaLabel ?? "Add match token"}
        aria-invalid={props.invalid ?? false}
        aria-describedby={props.describedBy}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim().length > 0) {
            commit();
          }
        }}
        className="h-6 min-w-[8rem] flex-1 bg-transparent font-mono text-[12px] text-fp-ink outline-none placeholder:text-fp-faint"
      />
    </div>
  );
}
