import type { JSX } from "react";
import type { FaceProps } from "./types";
import { formatRemain } from "./derive";
import { isBurstKind } from "./events";

/** Control still for the Record A/B — a competent progress bar, not a strawman. */
export function ProgressBarFace(props: FaceProps): JSX.Element {
  const pct = Math.max(0, Math.min(100, props.progress * 100));
  return (
    <div className="fp-face fp-face-bar" aria-label="Session progress bar">
      <div className="fp-face-bar-inner">
        <p className="fp-face-bar-kicker">Session progress</p>
        <p className="fp-face-bar-title">{Math.round(pct)}%</p>
        <p className="fp-face-bar-meta">
          {formatRemain(props.remainingMs)} remain · {props.sessionId}
        </p>
        <div className="fp-face-bar-track">
          <div className="fp-face-bar-fill" style={{ width: `${pct}%` }} />
          {props.events.filter((event) => isBurstKind(event.kind)).map((event) => (
            <span
              key={`${event.ts}-${event.kind}`}
              className={`fp-face-bar-tick fp-face-bar-tick-${event.kind}`}
              style={{ left: `${Math.min(100, event.at * 100)}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
