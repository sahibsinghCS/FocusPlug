import type { DeskModelId, PlugDevice, PlugProtocol, PlugSnapshot } from "@shared/ipc";

/** Exact warning copy for the plugs panel. */
export const STUDY_PC_WARNING = "Secondary fun devices only — never the study PC";

export const DESK_MODEL_IDS: readonly DeskModelId[] = ["stub", "blazeface", "custom"];
export const PLUG_PROTOCOLS: readonly PlugProtocol[] = ["kasa", "http", "mock"];

const STUDY_PC_NAME = /study[\s._-]*pc\b/i;

export interface PlugView {
  id: string;
  name: string;
  protocol: PlugProtocol;
  address: string;
  enabled: boolean;
  isStudyPc: false;
  online: boolean;
  powerOn: boolean | null;
  error?: string;
  /** True only when a PlugSnapshot was merged — never invent a probe. */
  probed: boolean;
}

export function isDeskModelId(value: unknown): value is DeskModelId {
  return typeof value === "string" && (DESK_MODEL_IDS as readonly string[]).includes(value);
}

export function isPlugProtocol(value: unknown): value is PlugProtocol {
  return typeof value === "string" && (PLUG_PROTOCOLS as readonly string[]).includes(value);
}

export function looksLikeStudyPc(value: string): boolean {
  return STUDY_PC_NAME.test(value.trim());
}

export function clonePlugDevice(device: PlugDevice): PlugDevice {
  return { ...device, isStudyPc: false };
}

export function enabledPlugDevices(devices: readonly PlugDevice[]): PlugDevice[] {
  return devices.filter((device) => device.enabled);
}

export function toPlugView(device: PlugDevice, snap?: PlugSnapshot): PlugView {
  return {
    id: device.id,
    name: device.name,
    protocol: device.protocol,
    address: device.address,
    enabled: device.enabled,
    isStudyPc: false,
    online: snap?.online ?? false,
    powerOn: snap === undefined ? null : snap.powerOn,
    error: snap?.error,
    probed: snap !== undefined,
  };
}

export function mergePlugViews(
  devices: readonly PlugDevice[],
  snapshots: Readonly<Record<string, PlugSnapshot>>,
): PlugView[] {
  return devices.map((device) => toPlugView(device, snapshots[device.id]));
}

export function enabledPlugViews(views: readonly PlugView[]): PlugView[] {
  return views.filter((plug) => plug.enabled);
}

export function summarizePlugs(views: readonly PlugView[]): string {
  if (views.length === 0) {
    return "No plugs";
  }
  const armed = enabledPlugViews(views);
  if (armed.length === 0) {
    return `${views.length} plugged in · none armed`;
  }
  const on = armed.filter((plug) => plug.powerOn === true).length;
  return `${armed.length} armed · ${on} on`;
}

export function plugKillNote(views: readonly PlugView[]): string | null {
  const armed = enabledPlugViews(views);
  if (armed.length === 0) {
    return null;
  }
  const names = armed.map((plug) => plug.name).join(", ");
  return `Kill overlay cuts ${armed.length} enabled plug${armed.length === 1 ? "" : "s"} (${names})`;
}
