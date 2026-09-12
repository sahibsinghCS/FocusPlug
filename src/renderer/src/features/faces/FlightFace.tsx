import type { JSX } from "react";
import { toFlightClock } from "./flight/clock";
import { FlightFace as FlightInstrument } from "./flight/FlightFace";
import { parseFlightPreview } from "./flight/preview";
import type { FaceProps } from "./types";

function stillsExtras(): {
  variant: "instrument" | "sticker";
  idleOverride?: number;
  reducedMotion: boolean;
  estimateMinutes?: number;
  settings: ReturnType<typeof parseFlightPreview>["settings"];
  freeze: boolean;
} {
  if (typeof window === "undefined") {
    return {
      variant: "instrument",
      reducedMotion: false,
      settings: {},
      freeze: false,
    };
  }
  return parseFlightPreview(window.location.search, window.location.hash);
}

/** Flight slot — real UTC terminator instrument. FaceHost owns the picker. */
export function FlightFace(props: FaceProps): JSX.Element {
  const extras = stillsExtras();
  const clock = toFlightClock(props, {
    paused: extras.freeze || undefined,
    reducedMotion: extras.reducedMotion,
    settings: extras.settings,
    estimateMinutes: extras.estimateMinutes,
  });
  const compact = props.height > 0 && props.height < 520;
  return (
    <div
      className="fp-flight-slot"
      data-face="flight"
      data-face-status="ready"
      data-phase={props.phase}
    >
      <FlightInstrument
        clock={clock}
        variant={extras.variant}
        idleOverride={extras.idleOverride}
        compact={compact}
      />
    </div>
  );
}
