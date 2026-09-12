import type { CSSProperties, JSX } from "react";
import { clampProgress } from "../clamp";

export function PlainBar(props: { progress: number; width: number; height: number }): JSX.Element {
  const progress = clampProgress(props.progress);
  const style = {
    width: props.width,
    height: props.height,
    "--bar-p": String(progress),
  } as CSSProperties;

  return (
    <div className="fp-plain-bar" style={style} role="img" aria-label={`Progress ${Math.round(progress * 100)} percent`}>
      <p className="fp-plain-bar-kicker">PROGRESS</p>
      <p className="fp-plain-bar-title">Session</p>
      <div className="fp-plain-bar-track">
        <div className="fp-plain-bar-fill" />
      </div>
      <p className="fp-plain-bar-readout">{Math.round(progress * 100)}%</p>
    </div>
  );
}
