import type { JSX } from "react";
import { stillsExtras, toInstrumentProps } from "./adapt";
import { RecordFace as RecordInstrument } from "./record/RecordFace";
import type { FaceProps } from "./types";

export function RecordFace(props: FaceProps): JSX.Element {
  return <RecordInstrument {...toInstrumentProps(props, stillsExtras())} />;
}
