import type { PlugDevice, PlugSnapshot } from "../../shared/types.ts";
import { isControllable } from "../plugs/index.ts";

export function formatPlug(action: "off" | "on", snapshots: readonly PlugSnapshot[]): string {
  const ids =
    snapshots.length > 0 ? snapshots.map((snap) => snap.deviceId).join(", ") : "none";
  const errors = snapshots
    .filter((snap) => typeof snap.error === "string" && snap.error.length > 0)
    .map((snap) => `${snap.deviceId}: ${snap.error}`);
  const errorSuffix = errors.length > 0 ? `; errors: ${errors.join("; ")}` : "";
  return `${action} · ${ids}${errorSuffix}`;
}

function uniqueIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Enabled fun-plug ids that may be commanded.
 * Study-PC / protect-denied devices are dropped. Omitted or empty `requested`
 * expands to every commandable device (empty inventory → []).
 */
export function resolveSessionPlugIds(
  devices: readonly PlugDevice[],
  requested?: readonly string[],
): string[] {
  const commandable = devices.filter((device) => device.enabled && isControllable(device));
  const treatAsAll = requested === undefined || requested.length === 0;
  if (treatAsAll) {
    return uniqueIds(commandable.map((device) => device.id));
  }
  const wanted = new Set(uniqueIds(requested));
  return uniqueIds(
    commandable.filter((device) => wanted.has(device.id)).map((device) => device.id),
  );
}
