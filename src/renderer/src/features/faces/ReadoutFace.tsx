import type { JSX } from "react";
import { clamp01, formatFaceClock, formatFacePercent } from "./clock";
import type { FaceProps } from "./types";

const TICKS = 12;

export function ReadoutFace(props: FaceProps): JSX.Element {
  const progress = clamp01(props.progress);
  const elapsed = formatFaceClock(props.elapsedMs);
  const remaining = formatFaceClock(props.remainingMs);
  const phaseLabel = props.phase === "focus" ? "FOCUS" : props.phase === "break" ? "BREAK" : "STANDBY";
  const primary = props.phase === "break" ? remaining : elapsed;
  const primaryHint = props.phase === "break" ? "Remaining on break" : "Elapsed this session";
  const secondary = props.phase === "break" ? elapsed : remaining;
  const secondaryHint = props.phase === "break" ? "Elapsed" : "Remaining on block";

  return (
    <div
      className={`fp-readout is-${props.phase}`}
      data-face="readout"
      data-face-status="ready"
      data-phase={props.phase}
    >
      <div className="fp-readout-grid" aria-hidden="true" />
      <header className="fp-readout-head">
        <p className="fp-readout-kicker">Readout</p>
        <p className="fp-readout-phase">{phaseLabel}</p>
        <p className="fp-readout-id">{props.sessionId}</p>
      </header>

      <div className="fp-readout-clock" aria-label={`${primaryHint}: ${primary}`}>
        <p className="fp-readout-digits tabular">{primary}</p>
        <p className="fp-readout-hint">{primaryHint}</p>
      </div>

      <div className="fp-readout-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="fp-readout-fill" style={{ width: formatFacePercent(progress) }} />
        <span className="fp-readout-needle" style={{ left: formatFacePercent(progress) }} aria-hidden="true" />
        <div className="fp-readout-ticks" aria-hidden="true">
          {Array.from({ length: TICKS + 1 }, (_, index) => (
            <span key={index} data-major={index % 3 === 0 ? "1" : "0"} />
          ))}
        </div>
      </div>

      <footer className="fp-readout-foot">
        <div>
          <p className="fp-readout-label">{secondaryHint}</p>
          <p className="fp-readout-sec tabular">{secondary}</p>
        </div>
        <div>
          <p className="fp-readout-label">Block</p>
          <p className="fp-readout-sec tabular">{props.estimateMinutes ?? 50}m</p>
        </div>
        <div>
          <p className="fp-readout-label">Kills</p>
          <p className={`fp-readout-sec tabular ${props.killCount > 0 ? "is-hot" : ""}`}>
            {String(props.killCount).padStart(2, "0")}
          </p>
        </div>
        <div>
          <p className="fp-readout-label">Clock</p>
          <p className="fp-readout-sec tabular">
            {props.now.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </footer>
    </div>
  );
}
