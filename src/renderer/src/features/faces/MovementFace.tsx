import type { JSX } from "react";
import { stillsExtras, toInstrumentProps } from "./adapt";
import { MovementFace as MovementInstrument } from "./movement/MovementFace";
import type { FaceProps } from "./types";

export function MovementFace(props: FaceProps): JSX.Element {
  return <MovementInstrument {...toInstrumentProps(props, stillsExtras())} />;
}
