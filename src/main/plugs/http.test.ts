import { describe, expect, it } from "vitest";
import { HttpPlugHost, httpCommandUrl, inferPowerFromBody } from "./http.ts";
import type { PlugDevice } from "./types.ts";

describe("HttpPlugHost", () => {
  const device: PlugDevice = {
    id: "strip",
    name: "LED strip",
    protocol: "http",
    address: "192.168.1.77",
    isStudyPc: false,
    enabled: true,
  };

  it("POSTs {address}/on and {address}/off", async () => {
    const calls: string[] = [];
    let on = true;
    const host = new HttpPlugHost({
      fetch: async (url) => {
        calls.push(url);
        if (url.endsWith("/off")) {
          on = false;
        }
        if (url.endsWith("/on")) {
          on = true;
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ on }),
        };
      },
    });
    expect(await host.setPower(device, false)).toBe(false);
    expect(await host.query(device)).toBe(false);
    expect(await host.setPower(device, true)).toBe(true);
    expect(calls).toEqual([
      "http://192.168.1.77/off",
      "http://192.168.1.77/status",
      "http://192.168.1.77/on",
    ]);
    expect(httpCommandUrl("http://192.168.1.77/", "on")).toBe("http://192.168.1.77/on");
  });

  it("errors when address is empty", async () => {
    const host = new HttpPlugHost({
      fetch: async () => ({ ok: true, status: 200, text: async () => "ok" }),
    });
    await expect(host.setPower({ ...device, address: "  " }, true)).rejects.toThrow(/empty/);
  });

  it("infers power tokens from HTTP bodies", () => {
    expect(inferPowerFromBody("ON")).toBe(true);
    expect(inferPowerFromBody("off")).toBe(false);
    expect(inferPowerFromBody('{"POWER":"ON"}')).toBe(true);
    expect(inferPowerFromBody('{"on":false}')).toBe(false);
    expect(inferPowerFromBody("maybe")).toBeNull();
  });
});
