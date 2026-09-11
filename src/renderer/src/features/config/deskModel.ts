import type { DeskModelId } from "@shared/ipc";

export const CUSTOM_MODEL_PATH = "src/main/desk/model/your-model.ts";
export const CUSTOM_GUIDE_PATH = "docs/MODEL-SEAM.md";

export interface DeskModelCardCopy {
  id: DeskModelId;
  title: string;
  badge: string;
  summary: string;
  detail: string;
}

export const DESK_MODEL_CARDS: readonly DeskModelCardCopy[] = [
  {
    id: "blazeface",
    title: "BlazeFace",
    badge: "Default",
    summary: "Shipped on-device face presence. Demo-ready.",
    detail: "Hyperbloom path. No cloud. Uncertain never desk-only-kills.",
  },
  {
    id: "custom",
    title: "Custom",
    badge: "Seam",
    summary: "Drop-in infer() behind the same DeskModel contract.",
    detail: `${CUSTOM_MODEL_PATH} — until you replace infer(), it returns uncertain (confidence 0). Guide: ${CUSTOM_GUIDE_PATH}`,
  },
  {
    id: "stub",
    title: "Stub",
    badge: "Soak",
    summary: "Always uncertain. Never desk-only-kills.",
    detail: "Gauntlet and safe soak. Presence stays maybe so policy will not fuse on desk alone.",
  },
];

export function deskModelCard(id: DeskModelId): DeskModelCardCopy {
  const found = DESK_MODEL_CARDS.find((card) => card.id === id);
  if (!found) {
    throw new Error(`Unknown desk model id: ${id}`);
  }
  return found;
}

export interface CustomReadiness {
  state: "unprobed";
  label: string;
  detail: string;
}

/** Renderer has no infer IPC — do not invent a ready flag. */
export function customReadiness(): CustomReadiness {
  return {
    state: "unprobed",
    label: "Seam file · not probed from UI",
    detail: `No renderer channel can run infer(). Custom stays uncertain until ${CUSTOM_MODEL_PATH} is implemented. Policy will not desk-only-kill on that.`,
  };
}

export function modelReturned(returned: DeskModelId, requested: DeskModelId): boolean {
  return returned === requested;
}
