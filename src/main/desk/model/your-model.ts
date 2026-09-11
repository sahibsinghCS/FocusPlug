import type { DeskFrame, DeskModel, DeskModelOutput } from "@shared/types";

/**
 * YOUR MODEL HERE
 *
 * Timmy: this is the ONLY file you need to edit for a new desk model.
 * Replace `infer()` — do not change `id`, the factory, analyze, or monitor.
 *
 * Input: `DeskFrame` — RGB888 or Float32, row-major (`width * height * 3`).
 * Return: `{ label: "at_desk" | "away" | "uncertain", confidence: 0..1 }`.
 *
 * Uncertain (or confidence below settings.deskThreshold) is safe: the
 * policy will not start a desk-only kill on a maybe.
 */
export class YourModel implements DeskModel {
  readonly id = "custom";

  async init(): Promise<void> {
    return;
  }

  async infer(_frame: DeskFrame): Promise<DeskModelOutput> {
    // TODO(Timmy): run your on-device model on `_frame` and return
    // a real { label, confidence }. Do not call cloud vision APIs.
    //
    // Default is uncertain so flipping deskModelId=custom cannot crash a
    // session or desk-only-kill before you implement this.
    return { label: "uncertain", confidence: 0 };
  }
}
