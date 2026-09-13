import type { JSX } from "react";
import { useOptionalAppState } from "../../state/AppState";
import { toFlightClock } from "./flight/clock";
import { FlightFace as FlightInstrument } from "./flight/FlightFace";
import { parseFlightPreview } from "./flight/preview";
import { resolveFlightRoutePicker } from "./flight/routePicker";
import { isFaceThumb } from "./thumb";
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
    paused: extras.freeze || props.paused || undefined,
    reducedMotion: extras.reducedMotion,
    settings,
    estimateMinutes: extras.estimateMinutes,
  });
  const thumb = isFaceThumb(props.height);
  const compact = props.height > 0 && props.height < 400;
  // Lock never opts in (showRoutePicker stays false). Settings has its own
  // picker. Stills may opt in with ?picker=dep|arr.
  const showRoutePicker = resolveFlightRoutePicker({
    showRoutePicker: extras.picker !== null,
  });
  return (
    <div
      className="fp-flight-slot"
      data-face="flight"
      data-face-status="ready"
      data-phase={props.phase}
    >
      <FlightInstrument
        clock={clock}
        variant={thumb ? "sticker" : extras.variant}
        idleOverride={extras.idleOverride}
        compact={compact}
        showRoutePicker={showRoutePicker}
        routePickerOpen={showRoutePicker && !thumb ? extras.picker : null}
        onRouteChange={
          showRoutePicker && app
            ? (next) => {
                void app.patchSettings({ flightDep: next.dep, flightArr: next.arr });
              }
            : undefined
        }
      />
    </div>
  );
}
