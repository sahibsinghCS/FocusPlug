import { describe, expect, it } from "vitest";
import { STUDY_PC_WARNING } from "../../lib/plugsUi";
import {
  formatProbe,
  hostnameFromAddress,
  isLoopbackHost,
  plugReturned,
  protocolCard,
  validatePlugDraft,
} from "./plugs";

describe("config plugs", () => {
  it("explains each frozen protocol", () => {
    expect(protocolCard("kasa").addressPlaceholder).toBe("192.168.1.50");
    expect(protocolCard("http").summary).toMatch(/Tasmota/);
    expect(protocolCard("mock").summary).toMatch(/filming/);
  });

  it("blocks empty fields, study-PC names, and loopback on real adapters", () => {
    expect(validatePlugDraft({ name: "", address: "192.168.1.4", protocol: "kasa" })?.field).toBe(
      "name",
    );
    expect(validatePlugDraft({ name: "Study PC", address: "192.168.1.4", protocol: "kasa" })).toEqual(
      { field: "name", message: STUDY_PC_WARNING },
    );
    expect(
      validatePlugDraft({ name: "Lamp", address: "127.0.0.1", protocol: "kasa" })?.message,
    ).toMatch(/study machine/);
    expect(
      validatePlugDraft({ name: "Lamp", address: "http://localhost/on", protocol: "http" })?.field,
    ).toBe("address");
    expect(validatePlugDraft({ name: "Lamp", address: "not-an-ip", protocol: "kasa" })?.field).toBe(
      "address",
    );
    expect(validatePlugDraft({ name: "Lamp", address: "192.168.1.50", protocol: "kasa" })).toBeNull();
    expect(validatePlugDraft({ name: "Strip", address: "192.168.1.77", protocol: "http" })).toBeNull();
    expect(validatePlugDraft({ name: "Lamp", address: "mock://lamp", protocol: "mock" })).toBeNull();
    expect(validatePlugDraft({ name: "Lamp", address: "127.0.0.1", protocol: "mock" })).toBeNull();
  });

  it("parses hosts the same way protect does for common addresses", () => {
    expect(hostnameFromAddress("192.168.1.50")).toBe("192.168.1.50");
    expect(hostnameFromAddress("http://192.168.1.77/on")).toBe("192.168.1.77");
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("192.168.1.50")).toBe(false);
  });

  it("formats returned snapshots without inventing power", () => {
    expect(
      formatProbe({ ts: 1, deviceId: "lamp", online: true, powerOn: false }),
    ).toBe("online · power off");
    expect(
      formatProbe({
        ts: 1,
        deviceId: "lamp",
        online: false,
        powerOn: null,
        error: "plug driver not implemented",
      }),
    ).toBe("offline · power unknown · plug driver not implemented");
    expect(plugReturned([{ id: "lamp" }], "lamp")).toBe(true);
    expect(plugReturned([{ id: "lamp" }], "fan")).toBe(false);
  });
});
