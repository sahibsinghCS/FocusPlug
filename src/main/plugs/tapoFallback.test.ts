import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMockTapoServer } from "../../../scripts/mock-tapo-device.ts";
import { KasaPlugHost, type KasaTransport } from "./kasa.ts";
import { KlapPool, klapCredentialsFromEnv } from "./klap.ts";
import type { PlugDevice } from "../../shared/types.ts";

const USERNAME = "user@example.com";
const PASSWORD = "hunter2";

const device: PlugDevice = {
  id: "lamp",
  name: "Desk lamp",
  protocol: "kasa",
  address: "127.0.0.1",
  enabled: true,
  isStudyPc: false,
};

/** A plug that keeps 9999 closed, which is exactly what a Tapo does. */
const refusesLegacy: KasaTransport = {
  send: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:9999")),
  discover: async () => [],
};

let server: Server | undefined;

function start(deviceOn = true): Promise<number> {
  return new Promise((resolve) => {
    server = createMockTapoServer({ username: USERNAME, password: PASSWORD, deviceOn });
    server.listen(0, "127.0.0.1", () => {
      resolve((server!.address() as AddressInfo).port);
    });
  });
}

afterEach(async () => {
  const current = server;
  server = undefined;
  if (current) {
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
});

describe("Kasa host falling back to KLAP", () => {
  it("reads state over KLAP when the legacy protocol is refused", async () => {
    const port = await start(true);
    const host = new KasaPlugHost(
      refusesLegacy,
      new KlapPool({ username: USERNAME, password: PASSWORD }, port),
    );

    expect(await host.query(device)).toBe(true);
  });

  it("cuts and restores power over KLAP, which is what Demo Kill needs", async () => {
    const port = await start(true);
    const host = new KasaPlugHost(
      refusesLegacy,
      new KlapPool({ username: USERNAME, password: PASSWORD }, port),
    );

    expect(await host.setPower(device, false)).toBe(false);
    expect(await host.query(device)).toBe(false);
    expect(await host.setPower(device, true)).toBe(true);
    expect(await host.query(device)).toBe(true);
  });

  it("says how to configure credentials when there is no fallback", async () => {
    const host = new KasaPlugHost(refusesLegacy, null);

    await expect(host.query(device)).rejects.toThrow(/FOCUSPLUG_TAPO_USERNAME/u);
    await expect(host.setPower(device, false)).rejects.toThrow(/KLAP/u);
  });

  it("never reaches KLAP when the legacy protocol answers", async () => {
    let sent = 0;
    const legacy: KasaTransport = {
      send: async (_host, payload) => {
        sent += 1;
        if (payload.includes("set_relay_state")) {
          return JSON.stringify({ system: { set_relay_state: { err_code: 0 } } });
        }
        return JSON.stringify({
          system: { get_sysinfo: { alias: "Old plug", relay_state: 1, err_code: 0 } },
        });
      },
      discover: async () => [],
    };
    // A pool pointed at a dead port: touching it at all would throw.
    const host = new KasaPlugHost(legacy, new KlapPool({ username: "x", password: "y" }, 9));

    expect(await host.query(device)).toBe(true);
    expect(sent).toBeGreaterThan(0);
  });
});

describe("klapCredentialsFromEnv", () => {
  it("accepts FocusPlug, Tapo and Kasa spellings", () => {
    expect(klapCredentialsFromEnv({ FOCUSPLUG_TAPO_USERNAME: "a@b.c", FOCUSPLUG_TAPO_PASSWORD: "p" }))
      .toEqual({ username: "a@b.c", password: "p" });
    expect(klapCredentialsFromEnv({ TAPO_EMAIL: "a@b.c", TAPO_PASSWORD: "p" })).toEqual({
      username: "a@b.c",
      password: "p",
    });
    expect(klapCredentialsFromEnv({ KASA_USERNAME: "a@b.c", KASA_PASSWORD: "p" })).toEqual({
      username: "a@b.c",
      password: "p",
    });
  });

  it("treats missing or blank values as not configured", () => {
    expect(klapCredentialsFromEnv({})).toBeNull();
    expect(klapCredentialsFromEnv({ TAPO_EMAIL: "a@b.c" })).toBeNull();
    expect(klapCredentialsFromEnv({ TAPO_EMAIL: "  ", TAPO_PASSWORD: "p" })).toBeNull();
  });
});
