import type { DeskModel, DeskModelOutput } from "@shared/types";
import type { DeskDebug } from "../types";

/** Local extras only — do not fork shared DeskModel / DeskModelOutput. */
export interface DeskModelResult extends DeskModelOutput {
  debug?: Partial<DeskDebug>;
}

export interface RunnableDeskModel extends DeskModel {
  infer(frame: Parameters<DeskModel["infer"]>[0]): Promise<DeskModelOutput | DeskModelResult>;
  backend?(): string;
}
