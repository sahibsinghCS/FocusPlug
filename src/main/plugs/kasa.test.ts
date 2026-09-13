import { describe, expect, it } from "vitest";
import {
  broadcastTargets,
  kasaDecodeTcp,
  kasaDecrypt,
  kasaEncodeTcp,
  kasaEncrypt,
  KasaPlugHost,
  parseKasaSysinfo,
  subnetBroadcast,
  type KasaTransport,
} from "./kasa.ts";

/**
 * Discovery used to send only to 255.255.255.255, which leaves the interface to
 * the routing table. Verified against a mock device on this LAN: the datagram
 * left via the VirtualBox host-only adapter, so the reply came back as
 * 192.168.56.1 for a device actually reachable at 192.168.1.14.
 */
describe("discovery broadcast targets", () => {
  it("derives the directed broadcast for a /24", () => {
    expect(subnetBroadcast("192.168.1.14", "255.255.255.0")).toBe("192.168.1.255");
  });

  it("handles non-byte-aligned masks", () => {
    expect(subnetBroadcast("10.0.5.9", "255.255.254.0")).toBe("10.0.5.255");
    expect(subnetBroadcast("172.16.8.1", "255.240.0.0")).toBe("172.31.255.255");
  });

  it("rejects malformed input instead of inventing a target", () => {
    expect(subnetBroadcast("not-an-ip", "255.255.255.0")).toBeNull();
    expect(subnetBroadcast("192.168.1.1", "")).toBeNull();
  });

  it("always includes the global broadcast and every local subnet", () => {
    const targets = broadcastTargets();
    expect(targets).toContain("255.255.255.255");
    expect(new Set(targets).size).toBe(targets.length);
    for (const target of targets) {
      expect(target).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/u);
    }
  });
});

class MemoryKasaTransport implements KasaTransport {
  relay = 1;
  lastHost = "";
  lastPayload = "";

  async send(host: string, payload: string): Promise<string> {
    this.lastHost = host;
    this.lastPayload = payload;
    const parsed = JSON.parse(payload) as {
      system?: { set_relay_state?: { state?: number }; get_sysinfo?: unknown };
    };
    if (parsed.system?.set_relay_state) {
      this.relay = parsed.system.set_relay_state.state ?? 0;
      return JSON.stringify({ system: { set_relay_state: { err_code: 0 } } });
    }
    return JSON.stringify({
      system: {
        get_sysinfo: {
          alias: "Lava lamp",
          deviceId: "DEV1",
          model: "HS103(US)",
          relay_state: this.relay,
        },
      },
    });
  }

  async discover(): Promise<Array<{ host: string; body: string }>> {
    return [
      {
        host: "192.168.1.40",
        body: await this.send("192.168.1.40", '{"system":{"get_sysinfo":{}}}'),
      },
    ];
  }
}

describe("Kasa local LAN protocol", () => {
  it("XOR round-trips and prefixes a TCP length header", () => {
    const plain = Buffer.from('{"system":{"get_sysinfo":{}}}', "utf8");
    expect(kasaDecrypt(kasaEncrypt(plain)).equals(plain)).toBe(true);
    const tcp = kasaEncodeTcp('{"a":1}');
    expect(tcp.readUInt32BE(0)).toBe(tcp.length - 4);
    expect(kasaDecodeTcp(tcp)).toBe('{"a":1}');
  });

  it("on/off/query go through the local transport (no cloud)", async () => {
    const transport = new MemoryKasaTransport();
    const host = new KasaPlugHost(transport);
    const device = {
      id: "k1",
      name: "Lava lamp",
      protocol: "kasa" as const,
      address: "192.168.1.40",
      isStudyPc: false as const,
      enabled: true,
    };
    expect(await host.query(device)).toBe(true);
    expect(await host.setPower(device, false)).toBe(false);
    expect(transport.lastPayload).toContain("get_sysinfo");
    expect(await host.query(device)).toBe(false);
    expect(await host.setPower(device, true)).toBe(true);
    const found = await host.discover();
    expect(found).toHaveLength(1);
    expect(found[0]?.address).toBe("192.168.1.40");
    expect(found[0]?.protocol).toBe("kasa");
    expect(found[0]?.name).toBe("Lava lamp");
  });

  it("parses sysinfo relay_state", () => {
    const info = parseKasaSysinfo(
      JSON.stringify({ system: { get_sysinfo: { relay_state: 0, alias: "x" } } }),
    );
    expect(info.relay_state).toBe(0);
    expect(info.alias).toBe("x");
  });
});
