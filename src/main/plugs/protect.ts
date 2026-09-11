import type { PlugProtectVerdict } from "./types.ts";

/** Runtime plug record. Persisted devices are always `isStudyPc: false`. */
export interface ProtectablePlug {
  id: string;
  name: string;
  protocol: string;
  address: string;
  isStudyPc: unknown;
}

/** Names that mark the study machine. Never power these. */
const STUDY_PC_NAME = /study[\s._-]*pc\b/i;

const LOOPBACK_HOST = /^(localhost|::1|0\.0\.0\.0|::)$/i;

export class PlugProtectError extends Error {
  readonly code = "PLUG_PROTECT";

  constructor(message: string) {
    super(message);
    this.name = "PlugProtectError";
  }
}

export function looksLikeStudyPcName(value: string): boolean {
  return STUDY_PC_NAME.test(value.trim());
}

export function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!trimmed) {
    return false;
  }
  if (LOOPBACK_HOST.test(trimmed)) {
    return true;
  }
  return trimmed.startsWith("127.");
}

export function hostnameFromAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) {
    return "";
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return "";
    }
  }
  const bracketed = trimmed.match(/^\[([^\]]+)\](?::\d+)?(?:\/.*)?$/);
  if (bracketed?.[1]) {
    return bracketed[1];
  }
  if (/^\d{1,3}(\.\d{1,3}){3}(?::\d+)?$/.test(trimmed) || !trimmed.includes(":")) {
    return (trimmed.split(":")[0] ?? trimmed).trim();
  }
  return trimmed.split("%")[0]?.trim() ?? trimmed;
}

/**
 * Hard deny list for secondary-fun-device control.
 * Refuses study-PC devices, study-pc names, empty addresses, and localhost
 * on real (non-mock) adapters.
 */
export function inspectControllable(device: ProtectablePlug): PlugProtectVerdict {
  if (device.isStudyPc !== false) {
    return {
      ok: false,
      reason: `Refused to control study PC plug "${device.name}" (${device.id})`,
    };
  }
  if (looksLikeStudyPcName(device.name) || looksLikeStudyPcName(device.id)) {
    return {
      ok: false,
      reason: `Refused to control study-PC-named device "${device.name}" (${device.id})`,
    };
  }
  const address = device.address.trim();
  if (!address) {
    return {
      ok: false,
      reason: `Refused to control plug "${device.name}" with empty address`,
    };
  }
  if (device.protocol !== "mock" && isLoopbackHost(hostnameFromAddress(address))) {
    return {
      ok: false,
      reason: `Refused to control localhost as study machine (${device.name})`,
    };
  }
  return { ok: true };
}

export function assertControllable(device: ProtectablePlug): void {
  const verdict = inspectControllable(device);
  if (!verdict.ok) {
    throw new PlugProtectError(verdict.reason);
  }
}

export function isControllable(device: ProtectablePlug): boolean {
  return inspectControllable(device).ok;
}
