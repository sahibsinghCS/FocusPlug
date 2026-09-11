import { describe, expect, it } from "vitest";
import {
  kasaDecodeTcp,
  kasaDecrypt,
  kasaEncodeTcp,
  kasaEncrypt,
  KasaPlugHost,
  parseKasaSysinfo,
  type KasaTransport,
} from "./kasa.ts";

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
