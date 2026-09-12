import type { JSX } from "react";
import { stillsExtras, toInstrumentProps } from "./adapt";
import { LineFace as LineInstrument } from "./line/LineFace";
import type { FaceProps } from "./types";

export function LineFace(props: FaceProps): JSX.Element {
  return <LineInstrument {...toInstrumentProps(props, stillsExtras())} />;
}
