import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMockTapoServer } from "../../../scripts/mock-tapo-device.ts";
import { KlapClient } from "./klap.ts";

/**
 * End-to-end over real HTTP against the KLAP simulator: handshake1, handshake2,
 * encrypted request, encrypted response, sequence numbers, session cookie.
 *
 * The simulator is not a self-graded exam: python-kasa's own KlapTransportV2
 * drives the same server through the same sequence (docs/SMART-PLUGS.md), so a
 * client that satisfies it is speaking the reference protocol.
 */
const USERNAME = "user@example.com";
const PASSWORD = "hunter2";

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

describe("KlapClient against a KLAP device", () => {
  it("handshakes and reads device state", async () => {
    const port = await start(true);
    const client = new KlapClient("127.0.0.1", { username: USERNAME, password: PASSWORD }, port);

    const info = await client.getDeviceInfo();
    expect(info["device_on"]).toBe(true);
    expect(info["model"]).toBe("P110M");
    expect(client.connected).toBe(true);
  });

  it("cuts power and restores it", async () => {
    const port = await start(true);
    const client = new KlapClient("127.0.0.1", { username: USERNAME, password: PASSWORD }, port);

    await client.setPower(false);
    expect((await client.getDeviceInfo())["device_on"]).toBe(false);

    await client.setPower(true);
    expect((await client.getDeviceInfo())["device_on"]).toBe(true);
  });

  it("reuses one handshake across many commands", async () => {
    const port = await start(true);
    const client = new KlapClient("127.0.0.1", { username: USERNAME, password: PASSWORD }, port);

    let handshakes = 0;
    const original = client.handshake.bind(client);
    client.handshake = async (): Promise<void> => {
      handshakes += 1;
      await original();
    };

    await client.getDeviceInfo();
    await client.setPower(false);
    await client.setPower(true);
    await client.getDeviceInfo();

    // Re-handshaking per command is what trips the device's auth throttle.
    expect(handshakes).toBe(1);
  });

  it("rejects wrong credentials at handshake1, before any command runs", async () => {
    const port = await start(true);
    const client = new KlapClient("127.0.0.1", { username: USERNAME, password: "wrong" }, port);

    await expect(client.getDeviceInfo()).rejects.toThrow(/challenge did not match/u);
    expect(client.connected).toBe(false);
  });
});
