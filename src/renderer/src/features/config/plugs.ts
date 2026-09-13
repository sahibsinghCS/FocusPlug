import type { PlugProtocol, PlugSnapshot } from "@shared/ipc";
import { looksLikeStudyPc, STUDY_PC_WARNING, type PlugView } from "../../lib/plugsUi";

export type PlugField = "name" | "address" | "protocol";

export interface PlugFieldError {
  field: PlugField;
  message: string;
}

export interface ProtocolCardCopy {
  id: PlugProtocol;
  title: string;
  summary: string;
  addressLabel: string;
  addressHelp: string;
  addressPlaceholder: string;
}

const LOOPBACK_HOST = /^(localhost|::1|0\.0\.0\.0|::)$/i;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

export const PLUG_ONBOARDING_STEPS: readonly { title: string; detail: string }[] = [
  {
    title: "Same LAN",
    detail: "Plug and this PC share Wi-Fi. No vendor cloud login.",
  },
  {
    title: "Copy the address",
    detail: "Kasa/HTTP use the router DHCP IPv4. Mock can be any id.",
  },
  {
    title: "Name a fun device",
    detail: "Lamp, speaker, game-PC PSU — never the study machine.",
  },
  {
    title: "Probe, then arm",
    detail: "Test off/on reads live status. Kill/Demo Kill cut armed outlets.",
  },
];

export const PROTOCOL_CARDS: readonly ProtocolCardCopy[] = [
  {
    id: "kasa",
    title: "Kasa",
    summary: "TP-Link HS100/HS103/KP105-class. Local TCP/UDP 9999. No cloud.",
    addressLabel: "LAN IPv4",
    addressHelp: "Router DHCP or the Kasa app LAN IP. Example 192.168.1.50 — not localhost.",
    addressPlaceholder: "192.168.1.50",
  },
  {
    id: "http",
    title: "HTTP",
    summary: "POST {address}/on and {address}/off. Tasmota, Shelly, DIY.",
    addressLabel: "Host or URL",
    addressHelp: "IPv4 or http(s) URL. Status is queried at {address}/status.",
    addressPlaceholder: "192.168.1.77",
  },
  {
    id: "mock",
    title: "Mock",
    summary: "In-memory host for filming and CI. Never talks to the network.",
    addressLabel: "Mock id",
    addressHelp: "Any non-empty id such as mock://lamp. Safe to add on this PC.",
    addressPlaceholder: "mock://lamp",
  },
];

export function protocolCard(protocol: PlugProtocol): ProtocolCardCopy {
  const found = PROTOCOL_CARDS.find((card) => card.id === protocol);
  if (!found) {
    throw new Error(`Unknown plug protocol: ${protocol}`);
  }
  return found;
}

export function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (trimmed.length === 0) {
    return false;
  }
  if (LOOPBACK_HOST.test(trimmed)) {
    return true;
  }
  return trimmed.startsWith("127.");
}

export function hostnameFromAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
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

export function ipv4Host(host: string): boolean {
  return IPV4.test(host.trim());
}

export function validatePlugDraft(input: {
  name: string;
  address: string;
  protocol: PlugProtocol;
}): PlugFieldError | null {
  const name = input.name.trim();
  const address = input.address.trim();
  if (name.length === 0) {
    return { field: "name", message: "Name is required" };
  }
  if (looksLikeStudyPc(name)) {
    return { field: "name", message: STUDY_PC_WARNING };
  }
  if (address.length === 0) {
    return { field: "address", message: "Address is required" };
  }
  const host = hostnameFromAddress(address);
  if (input.protocol !== "mock" && isLoopbackHost(host.length > 0 ? host : address)) {
    return {
      field: "address",
      message: "Localhost is treated as the study machine — use a LAN address",
    };
  }
  if (input.protocol === "kasa") {
    const ip = host.includes(":") ? (host.split(":")[0] ?? host) : host;
    if (!ipv4Host(ip)) {
      return { field: "address", message: "Kasa needs a LAN IPv4 such as 192.168.1.50" };
    }
  }
  if (input.protocol === "http" && host.length === 0) {
    return { field: "address", message: "HTTP needs a host or URL" };
  }
  return null;
}

export function plugReturned(plugs: readonly { id: string }[], id: string): boolean {
  return plugs.some((plug) => plug.id === id);
}

export function formatProbe(snap: PlugSnapshot): string {
  const parts: string[] = [];
  parts.push(snap.online ? "online" : "offline");
  if (snap.powerOn === true) {
    parts.push("power on");
  } else if (snap.powerOn === false) {
    parts.push("power off");
  } else {
    parts.push("power unknown");
  }
  if (snap.error && snap.error.trim().length > 0) {
    parts.push(snap.error.trim());
  }
  return parts.join(" · ");
}

export function plugStateLabel(plug: PlugView): {
  online: string;
  power: string;
  tone: "focus" | "red" | "warn" | "mute";
} {
  if (!plug.probed) {
    return { online: "Not tested", power: "—", tone: "mute" };
  }
  if (plug.error) {
    return { online: "Error", power: plug.error, tone: "red" };
  }
  if (!plug.online) {
    return { online: "Offline", power: plug.powerOn === false ? "Power off" : "Unknown", tone: "mute" };
  }
  if (plug.powerOn === true) {
    return { online: "Online", power: "Power on", tone: "focus" };
  }
  if (plug.powerOn === false) {
    return { online: "Online", power: "Power off", tone: "red" };
  }
  return { online: "Online", power: "Unknown", tone: "warn" };
}
