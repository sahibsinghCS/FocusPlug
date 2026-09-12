import type { JSX } from "react";
import { useOptionalAppState } from "../../state/AppState";
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
  picker: "dep" | "arr" | null;
} {
  if (typeof window === "undefined") {
    return {
      variant: "instrument",
      reducedMotion: false,
      settings: {},
      freeze: false,
      picker: null,
    };
  }
  return parseFlightPreview(window.location.search, window.location.hash);
}

/** Flight slot — real UTC terminator instrument. FaceHost owns the face picker. */
export function FlightFace(props: FaceProps): JSX.Element {
  const extras = stillsExtras();
  const app = useOptionalAppState();
  const settings = {
    dep: extras.settings.dep ?? app?.settings.flightDep,
    arr: extras.settings.arr ?? app?.settings.flightArr,
    depName: extras.settings.depName,
    arrName: extras.settings.arrName,
    depLat: extras.settings.depLat,
    depLon: extras.settings.depLon,
    arrLat: extras.settings.arrLat,
    arrLon: extras.settings.arrLon,
  };
  const clock = toFlightClock(props, {
    paused: extras.freeze || undefined,
    reducedMotion: extras.reducedMotion,
    settings,
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
        routePickerOpen={extras.picker}
        onRouteChange={
          app
            ? (next) => {
                void app.patchSettings({ flightDep: next.dep, flightArr: next.arr });
              }
            : undefined
        }
      />
    </div>
  );
}
