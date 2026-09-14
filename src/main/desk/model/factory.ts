import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { DeskModelFactory } from "@shared/ipc";
import type { DeskModel, DeskModelId } from "@shared/types";
import { BlazeFaceDeskModel } from "./blazeface-adapter";
import { StubDeskModel } from "./stub";
import { setPersonalAttentionHeadFile, YourModel } from "./your-model";

export function isDeskModelId(value: unknown): value is DeskModelId {
  return value === "stub" || value === "blazeface" || value === "custom";
}

export const DEFAULT_DESK_MODEL_ID: DeskModelId = DEFAULT_SETTINGS.deskModelId;

export function resolveDeskModelId(value: unknown): DeskModelId {
  return isDeskModelId(value) ? value : DEFAULT_DESK_MODEL_ID;
}

/**
 * Build a desk presence model from settings (`deskModelId`).
 * Default is BlazeFace so the Hyperbloom demo keeps working.
 * Set `deskModelId` to `"custom"` after implementing `YourModel.infer`.
 */
export function createDeskModel(id: DeskModelId = DEFAULT_DESK_MODEL_ID): DeskModel {
  switch (id) {
    case "stub":
      return new StubDeskModel();
    case "custom":
      return new YourModel();
    case "blazeface":
      return new BlazeFaceDeskModel();
  }
}

export const deskModelFactory: DeskModelFactory = {
  create: createDeskModel,
};

const shared = new Map<DeskModelId, DeskModel>();

export async function getSharedDeskModel(
  id: DeskModelId = DEFAULT_DESK_MODEL_ID,
): Promise<DeskModel> {
  const existing = shared.get(id);
  if (existing) {
    return existing;
  }
  const model = createDeskModel(id);
  await model.init();
  shared.set(id, model);
  return model;
}

/**
 * Drop the cached model instances so the next reading is taken by a freshly
 * loaded head.
 *
 * `YourModel` loads its weights once and keeps them, which is right on the
 * enforcement path and wrong the moment a refit installs — or removes — the
 * student's personal output layer. Rather than teach the model to watch a
 * file, the three events that can change which head should be running say so:
 * a refit finishing, `personalAttentionHeadEnabled` being toggled, and *Delete
 * all* taking the head away with the photographs it was fitted from. The next
 * `getSharedDeskModel()` then rebuilds and re-reads.
 *
 * Cheap by construction: the expensive part of a desk model is the BlazeFace
 * graph and the MobileNet weights, and both live in module-level singletons
 * that survive this.
 */
export function clearSharedDeskModel(): void {
  shared.clear();
}

/**
 * Point the desk model at the student's personal attention head, or take it
 * away — the one call the rest of the app makes about which head runs.
 *
 * It is here, next to the cache, because the two halves are inseparable:
 * telling `YourModel` where the file is does nothing to an instance that has
 * already loaded its weights. Idempotent — a settings save that did not move
 * the head costs nothing — and `null` (from `personalAttentionHeadEnabled:
 * false`, or an install with no personal head) is a perfectly ordinary value
 * that puts the shipped head back.
 *
 * `force: true` exists for the one thing a path cannot see. The default asks
 * *"is the model pointed at a different file?"*, which is the right question
 * for a settings save — `syncCorrectionCapture()` calls this on every one of
 * them, and re-reading the weights each time would put a file read on the
 * enforcement path for nothing. It is the WRONG question when the bytes AT
 * that path change while the path stands still: *Delete all* unlinks
 * `personal-attention-head.json` without moving anything, and a cached
 * instance would go on wearing the layer fitted from the photographs that were
 * just erased — running one head while Settings, reading the same now-missing
 * file, truthfully says "shipped". A caller that changed the FILE rather than
 * the path passes `force`, and the very next reading rebuilds.
 */
export function applyPersonalAttentionHead(
  file: string | null,
  options?: { force?: boolean },
): void {
  const moved = setPersonalAttentionHeadFile(file);
  if (moved || options?.force === true) {
    clearSharedDeskModel();
  }
}
