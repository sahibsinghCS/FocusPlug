import { createConnection } from "node:net";
import { createSocket, type RemoteInfo, type Socket as UdpSocket } from "node:dgram";
import type { PlugDevice } from "../../shared/types.ts";
import { hostnameFromAddress } from "./protect.ts";
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

/** Throw unless a set_relay_state reply acknowledges the switch with err_code 0. */
export function assertSetRelayAck(body: string): void {
  let errCode: unknown;
  try {
    const parsed: unknown = JSON.parse(body);
    errCode = (parsed as { system?: { set_relay_state?: { err_code?: unknown } } }).system
      ?.set_relay_state?.err_code;
  } catch {
    throw new Error("Kasa set_relay_state reply was not JSON");
  }
  if (errCode !== 0) {
    throw new Error(
      `Kasa set_relay_state failed (err_code ${typeof errCode === "number" ? errCode : "missing"})`,
    );
  }
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
          socket.send(request, 0, request.length, KASA_PORT, "255.255.255.255", (error) => {
            if (error) {
              finish();
            }
          });
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
    // Same parse as the protect layer, so the host we dial can never diverge
    // from the host the loopback hard-deny inspected.
    const host = hostnameFromAddress(device.address);
    assertSetRelayAck(await this.transport.send(host, setRelayPayload(on)));
    try {
      const info = parseKasaSysinfo(await this.transport.send(host, GET_SYSINFO));
      return relayStateOn(info);
    } catch {
      // Device ACKed the relay change (err_code 0); verification is best-effort.
      return on;
    }
  }

  async query(device: PlugDevice): Promise<boolean | null> {
    const info = parseKasaSysinfo(
      await this.transport.send(hostnameFromAddress(device.address), GET_SYSINFO),
    );
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
    const found: PlugDevice[] = [];
    for (const reply of replies) {
      try {
        const info = parseKasaSysinfo(reply.body);
        const name = info.alias?.trim() || info.model?.trim() || `Kasa ${reply.host}`;
        found.push({
          id: info.deviceId ? `kasa:${info.deviceId}` : `kasa:${reply.host}`,
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
    return found;
  }
}

export function createKasaPlugHost(transport?: KasaTransport): KasaPlugHost {
  return new KasaPlugHost(transport);
}
