import type { JSX } from "react";
import type { SaveStatus } from "../saveState";

export function SaveHint(props: { state: SaveStatus; savedLabel?: string }): JSX.Element | null {
  if (props.state.status === "idle") {
    return null;
  }
  if (props.state.status === "saving") {
    return (
      <p className="text-[11px] text-fp-faint" aria-live="polite">
        Saving…
      </p>
    );
  }
  if (props.state.status === "saved") {
    return (
      <p className="text-[11px] text-fp-lime" aria-live="polite">
        {props.savedLabel ?? "Saved"}
      </p>
    );
  }
  return (
    <p className="text-[11px] text-fp-red" role="alert">
      {props.state.message}
    </p>
  );
}
