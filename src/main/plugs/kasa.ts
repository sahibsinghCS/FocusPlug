import { createConnection } from "node:net";
import { createSocket, type RemoteInfo, type Socket as UdpSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import type { PlugDevice } from "../../shared/types.ts";
import type { PlugHost } from "./types.ts";

/** TP-Link Smart Home LAN port. Local XOR protocol — no cloud account. */
export const KASA_PORT = 9999;
export const KASA_XOR_KEY = 0xab;

const GET_SYSINFO = '{"system":{"get_sysinfo":{}}}';

export interface KasaTransport {
  send(host: string, payload: string, timeoutMs?: number): Promise<string>;
  discover(timeoutMs?: number): Promise<Array<{ host: string; body: string }>>;
}

export interface KasaSysinfo {
  alias?: string;
  deviceId?: string;
  model?: string;
  relay_state?: number;
  err_code?: number;
}

export function kasaEncrypt(plain: Buffer, firstKey = KASA_XOR_KEY): Buffer {
  const out = Buffer.alloc(plain.length);
  let key = firstKey;
  for (let i = 0; i < plain.length; i += 1) {
    const next = (plain[i] ?? 0) ^ key;
    out[i] = next;
    key = next;
  }
  return out;
}

export function kasaDecrypt(cipher: Buffer, firstKey = KASA_XOR_KEY): Buffer {
  const out = Buffer.alloc(cipher.length);
  let key = firstKey;
  for (let i = 0; i < cipher.length; i += 1) {
    const current = cipher[i] ?? 0;
    out[i] = current ^ key;
    key = current;
  }
  return out;
}

export function kasaEncodeTcp(plain: string): Buffer {
  const encrypted = kasaEncrypt(Buffer.from(plain, "utf8"));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(encrypted.length, 0);
  return Buffer.concat([header, encrypted]);
}

export function kasaDecodeTcp(packet: Buffer): string {
  if (packet.length < 4) {
    throw new Error("Kasa TCP response too short");
  }
  const length = packet.readUInt32BE(0);
  const payload = packet.subarray(4, 4 + length);
  if (payload.length < length) {
    throw new Error("Kasa TCP response truncated");
  }
  return kasaDecrypt(payload).toString("utf8");
}

export function kasaEncodeUdp(plain: string): Buffer {
  return kasaEncrypt(Buffer.from(plain, "utf8"));
}

export function kasaDecodeUdp(packet: Buffer): string {
  return kasaDecrypt(packet).toString("utf8");
}

/** Directed broadcast for one interface, e.g. 192.168.1.14/24 → 192.168.1.255. */
export function subnetBroadcast(address: string, netmask: string): string | null {
  const host = address.split(".").map(Number);
  const mask = netmask.split(".").map(Number);
  if (host.length !== 4 || mask.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const hostOctet = host[i];
    const maskOctet = mask[i];
    if (!Number.isInteger(hostOctet) || !Number.isInteger(maskOctet)) {
      return null;
    }
    octets.push(((hostOctet as number) & (maskOctet as number)) | (~(maskOctet as number) & 0xff));
  }
  return octets.join(".");
}

/**
 * Every local subnet's broadcast address, plus the global one.
 *
 * 255.255.255.255 alone leaves the interface choice to the routing table. On a
 * Windows box with VirtualBox/WSL/Hyper-V adapters that is regularly the wrong
 * one: the probe answered from 192.168.56.1 (host-only) for a device on the
 * Wi-Fi subnet, so a real plug is either missed or recorded at an address that
 * does not reach it.
 */
export function broadcastTargets(): string[] {
  const targets = new Set<string>(["255.255.255.255"]);
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || !entry.netmask) {
        continue;
      }
      const broadcast = subnetBroadcast(entry.address, entry.netmask);
      if (broadcast !== null) {
        targets.add(broadcast);
      }
    }
  }
  return [...targets];
}

export function parseKasaSysinfo(body: string): KasaSysinfo {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Kasa response was not an object");
  }
  const system = (parsed as { system?: { get_sysinfo?: unknown } }).system;
  const info = system?.get_sysinfo;
  if (typeof info !== "object" || info === null) {
    throw new Error("Kasa response missing system.get_sysinfo");
  }
  return info as KasaSysinfo;
}

export function relayStateOn(info: KasaSysinfo): boolean {
  return info.relay_state === 1;
}

function setRelayPayload(on: boolean): string {
  return JSON.stringify({ system: { set_relay_state: { state: on ? 1 : 0 } } });
}

export class TcpKasaTransport implements KasaTransport {
  async send(host: string, payload: string, timeoutMs = 3000): Promise<string> {
    const packet = kasaEncodeTcp(payload);
    return await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host, port: KASA_PORT });
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (error?: Error, body?: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) {
          reject(error);
          return;
        }
        resolve(body ?? "");
      };

      const timer = setTimeout(() => {
        finish(new Error(`Kasa TCP timeout after ${timeoutMs}ms (${host}:${KASA_PORT})`));
      }, timeoutMs);

      socket.on("connect", () => {
        socket.write(packet);
      });
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        const received = Buffer.concat(chunks);
        if (received.length >= 4) {
          const length = received.readUInt32BE(0);
          if (received.length >= 4 + length) {
            try {
              finish(undefined, kasaDecodeTcp(received));
            } catch (error) {
              finish(error instanceof Error ? error : new Error(String(error)));
            }
          }
        }
      });
      socket.on("error", (error: Error) => {
        finish(error);
      });
      socket.on("close", () => {
        if (!settled) {
          finish(new Error(`Kasa TCP closed before a complete reply (${host})`));
        }
      });
    });
  }

  async discover(timeoutMs = 1500): Promise<Array<{ host: string; body: string }>> {
    const request = kasaEncodeUdp(GET_SYSINFO);
    return await new Promise((resolve) => {
      let socket: UdpSocket;
      try {
        socket = createSocket("udp4");
      } catch {
        resolve([]);
        return;
      }

      const found = new Map<string, string>();
      let done = false;

      const finish = (): void => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // ignore
        }
        resolve([...found.entries()].map(([host, body]) => ({ host, body })));
      };

      const timer = setTimeout(finish, timeoutMs);

      socket.on("error", () => {
        finish();
      });
      socket.on("message", (msg: Buffer, rinfo: RemoteInfo) => {
        try {
          found.set(rinfo.address, kasaDecodeUdp(msg));
        } catch {
          // ignore undecodable replies
        }
      });
      socket.bind(() => {
        try {
          socket.setBroadcast(true);
          const targets = broadcastTargets();
          let sent = 0;
          for (const target of targets) {
            socket.send(request, 0, request.length, KASA_PORT, target, (error) => {
              sent += 1;
              // Only give up if every target failed; a host-only adapter that
              // refuses the send must not cancel the real LAN.
              if (error && sent === targets.length && found.size === 0) {
                finish();
              }
            });
          }
        } catch {
          finish();
        }
      });
    });
  }
}

export class KasaPlugHost implements PlugHost {
  readonly protocol = "kasa" as const;

  constructor(private readonly transport: KasaTransport = new TcpKasaTransport()) {}

  async setPower(device: PlugDevice, on: boolean): Promise<boolean> {
    await this.transport.send(device.address.trim(), setRelayPayload(on));
    try {
      const info = parseKasaSysinfo(await this.transport.send(device.address.trim(), GET_SYSINFO));
      return relayStateOn(info);
    } catch {
      return on;
    }
  }

  async query(device: PlugDevice): Promise<boolean | null> {
    const info = parseKasaSysinfo(await this.transport.send(device.address.trim(), GET_SYSINFO));
    if (typeof info.relay_state !== "number") {
      return null;
    }
    return relayStateOn(info);
  }

  async discover(): Promise<PlugDevice[]> {
    let replies: Array<{ host: string; body: string }> = [];
    try {
      replies = await this.transport.discover();
    } catch {
      return [];
    }
    const found = new Map<string, PlugDevice>();
    for (const reply of replies) {
      try {
        const info = parseKasaSysinfo(reply.body);
        const name = info.alias?.trim() || info.model?.trim() || `Kasa ${reply.host}`;
        const id = info.deviceId ? `kasa:${info.deviceId}` : `kasa:${reply.host}`;
        // One device can answer on several interfaces now that we broadcast to
        // each subnet; keep one entry per device, not one per route to it.
        if (found.has(id)) {
          continue;
        }
        found.set(id, {
          id,
          name,
          protocol: "kasa",
          address: reply.host,
          isStudyPc: false,
          enabled: true,
        });
      } catch {
        // skip unreadable replies
      }
    }
    return [...found.values()];
  }
}

export function createKasaPlugHost(transport?: KasaTransport): KasaPlugHost {
  return new KasaPlugHost(transport);
}
