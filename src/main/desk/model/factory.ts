import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { DeskModelFactory } from "@shared/ipc";
import type { DeskModel, DeskModelId } from "@shared/types";
import { BlazeFaceDeskModel } from "./blazeface-adapter";
import { StubDeskModel } from "./stub";
import { YourModel } from "./your-model";

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
