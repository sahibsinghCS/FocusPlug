import { isIP } from "node:net";
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

const LOOPBACK_HOST = /^(localhost\.?|::1|0\.0\.0\.0|::)$/i;

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
  // IPv4-mapped IPv6 loopback (::ffff:127.0.0.1 / ::ffff:7f00:1) and the
  // IPv4-translated SIIT form (::ffff:0:127.0.0.1 / ::ffff:0:7f00:1).
  const mapped = trimmed.match(/^::ffff:(?:0:)?([0-9a-f:.]+)$/);
  if (mapped?.[1]) {
    return mapped[1].startsWith("127.") || /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(mapped[1]);
  }
  return trimmed.startsWith("127.");
}

/**
 * Canonicalize a bare IPv6 literal by round-tripping through WHATWG URL so
 * non-canonical loopback spellings ("0:0:0:0:0:0:0:1", "0::1", "::0:0:0:1")
 * come back as "::1" and cannot slip past isLoopbackHost(). Anything that is
 * not a valid IPv6 literal passes through unchanged.
 */
function canonicalizeIpv6Literal(candidate: string): string {
  const bare = candidate.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 6) {
    return candidate;
  }
  try {
    return new URL(`http://[${bare}]`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return bare;
  }
}

export function hostnameFromAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) {
    return "";
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      return new URL(trimmed).hostname.replace(/^\[|\]$/g, "");
    } catch {
      return "";
    }
  }
  // WHATWG URL parsing normalizes host:port, paths, trailing dots, octal/hex
  // IPv4 and bracketed IPv6 forms so none of them slip past the loopback check.
  try {
    return new URL(`http://${trimmed}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    // Not URL-parseable: bare IPv6 literals and zone-id forms land here.
  }
  const withoutZone = trimmed.split("%")[0]?.trim() ?? "";
  const bracketed = withoutZone.match(/^\[([^\]]+)\]/);
  if (bracketed?.[1]) {
    return canonicalizeIpv6Literal(bracketed[1]);
  }
  if (withoutZone.split(":").length > 2) {
    return canonicalizeIpv6Literal(withoutZone);
  }
  return withoutZone.split(":")[0]?.split("/")[0]?.trim() ?? "";
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
