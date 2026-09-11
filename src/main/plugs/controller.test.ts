import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FocusPlugStore } from "../store/appStore.ts";
import { PlugController } from "./controller.ts";
import { MemoryPlugStore } from "./memoryStore.ts";
import { MockPlugHost } from "./mock.ts";
import { PlugProtectError } from "./protect.ts";
import { SettingsPlugStore } from "./settingsStore.ts";
import type { PlugDevice } from "./types.ts";

function lamp(id = "lamp"): PlugDevice {
  return {
    id,
    name: "Fun lamp",
    protocol: "mock",
    address: "mock",
    isStudyPc: false,
    enabled: true,
  };
}

describe("MockPlugHost + PlugController", () => {
  it("off toggles mock power, then on restores it", async () => {
    const host = new MockPlugHost().seed("lamp", true);
    const controller = new PlugController({
      store: new MemoryPlugStore([lamp()]),
      hosts: { mock: host },
    });

    expect(host.getPower("lamp")).toBe(true);
    const off = await controller.off(["lamp"]);
    expect(off).toMatchObject([{ deviceId: "lamp", online: true, powerOn: false }]);
    expect(host.getPower("lamp")).toBe(false);

    const on = await controller.on(["lamp"]);
    expect(on).toMatchObject([{ deviceId: "lamp", online: true, powerOn: true }]);
    expect(host.getPower("lamp")).toBe(true);

    const snap = await controller.snapshot(["lamp"]);
    expect(snap).toHaveLength(1);
    expect(snap[0]?.powerOn).toBe(true);
    expect(snap[0]?.deviceId).toBe("lamp");
  });

  it("protect blocks study PC devices on add and off", async () => {
    const host = new MockPlugHost();
    const controller = new PlugController({
      store: new MemoryPlugStore(),
      hosts: { mock: host },
    });

    expect(() =>
      controller.add({
        id: "study",
        name: "study-pc",
        protocol: "mock",
        address: "mock",
        enabled: true,
        isStudyPc: false,
      }),
    ).toThrow(PlugProtectError);

    expect(() =>
      controller.add({
        name: "study-pc",
        protocol: "kasa",
        address: "192.168.1.8",
      }),
    ).toThrow(/study-PC-named/i);

    const poisoned: PlugDevice[] = [
      {
        id: "study-pc",
        name: "Homework box",
        protocol: "mock",
        address: "mock",
        isStudyPc: false,
        enabled: true,
      },
      lamp(),
    ];
    const store = new MemoryPlugStore(poisoned);
    const guarded = new PlugController({ store, hosts: { mock: host.seed("lamp", true) } });
    await expect(guarded.off(["study-pc"])).rejects.toThrow(PlugProtectError);
    expect(host.getPower("lamp")).toBe(true);

    const cut = await guarded.cutSecondary();
    expect(cut.some((row) => row.deviceId === "study-pc" && row.error)).toBe(true);
    expect(
      cut.some((row) => row.deviceId === "lamp" && row.online && row.powerOn === false),
    ).toBe(true);
    expect(host.getPower("lamp")).toBe(false);
  });

  it("unknown id errors cleanly", async () => {
    const controller = new PlugController({
      store: new MemoryPlugStore([lamp()]),
      hosts: { mock: new MockPlugHost() },
    });
    await expect(controller.off(["missing"])).rejects.toThrow(/Unknown plug id: missing/);
    await expect(controller.on(["nope"])).rejects.toThrow(/Unknown plug id: nope/);
    await expect(controller.snapshot(["ghost"])).rejects.toThrow(/Unknown plug id: ghost/);
    expect(() => controller.remove("ghost")).toThrow(/Unknown plug id: ghost/);
  });

  it("boots with zero plugs and persists add/remove via settings.plugs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focusplug-plugs-"));
    const appStore = new FocusPlugStore(dir);
    expect(appStore.loadSettings().plugs).toEqual([]);

    const controller = new PlugController({
      store: new SettingsPlugStore(appStore),
      hosts: { mock: new MockPlugHost() },
      idFactory: () => "lamp-1",
    });
    expect(await controller.list()).toEqual([]);
    const added = controller.add({
      name: "RGB strip",
      protocol: "mock",
      address: "mock",
    });
    expect(added.id).toBe("lamp-1");
    expect(new FocusPlugStore(dir).loadSettings().plugs).toEqual([added]);

    const remaining = controller.remove("lamp-1");
    expect(remaining).toEqual([]);
    expect(new FocusPlugStore(dir).loadSettings().plugs).toEqual([]);
  });
});
