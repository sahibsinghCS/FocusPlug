import type { DeskFrame, DeskModel, DeskModelOutput } from "@shared/types";

/**
 * Safe no-op desk model. Always uncertain — policy must not desk-only-kill.
 */
export class StubDeskModel implements DeskModel {
  readonly id = "stub";

  async init(): Promise<void> {
    return;
  }

  async infer(_frame: DeskFrame): Promise<DeskModelOutput> {
    return { label: "uncertain", confidence: 0 };
  }
}
