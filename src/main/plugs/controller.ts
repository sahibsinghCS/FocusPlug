import { randomUUID } from "node:crypto";
import type { PlugController as PlugControllerSeam } from "../../shared/ipc.ts";
import type { PlugDevice, PlugProtocol, PlugSnapshot } from "../../shared/types.ts";
import { createHttpPlugHost } from "./http.ts";
import { createKasaPlugHost } from "./kasa.ts";
import { createMockPlugHost } from "./mock.ts";
import { assertControllable, inspectControllable, isControllable } from "./protect.ts";
import type { PlugHost, PlugStore } from "./types.ts";

export interface PlugControllerOptions {
  store: PlugStore;
  hosts?: Partial<Record<PlugProtocol, PlugHost>>;
  now?: () => number;
  idFactory?: () => string;
}

const PROTOCOLS: readonly PlugProtocol[] = ["kasa", "http", "mock"];

function isPlugProtocol(value: unknown): value is PlugProtocol {
  return typeof value === "string" && (PROTOCOLS as readonly string[]).includes(value);
}

function cloneDevice(device: PlugDevice): PlugDevice {
  return {
    id: device.id,
    name: device.name,
    protocol: device.protocol,
    address: device.address,
    enabled: device.enabled,
    isStudyPc: false,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : String(error);
}

/**
 * Persisted plug registry + power control. on/off always pass through protect.
 * Plugs are optional: an empty store is a valid boot state.
 */
export class PlugController implements PlugControllerSeam {
  private readonly store: PlugStore;
  private readonly hosts: Record<PlugProtocol, PlugHost>;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options: PlugControllerOptions) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.hosts = {
      mock: options.hosts?.mock ?? createMockPlugHost(),
      kasa: options.hosts?.kasa ?? createKasaPlugHost(),
      http: options.hosts?.http ?? createHttpPlugHost(),
    };
  }

  async list(): Promise<PlugDevice[]> {
    return this.store.loadPlugs().map(cloneDevice);
  }

  add(raw: unknown): PlugDevice {
    const device = this.normalizeDevice(raw);
    assertControllable(device);
    const current = this.store.loadPlugs();
    if (current.some((entry) => entry.id === device.id)) {
      throw new Error(`Plug id already exists: ${device.id}`);
    }
    this.store.savePlugs([...current, device]);
    return cloneDevice(device);
  }

  remove(id: string): PlugDevice[] {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error("Unknown plug id: (empty)");
    }
    const current = this.store.loadPlugs();
    const next = current.filter((device) => device.id !== id);
    if (next.length === current.length) {
      throw new Error(`Unknown plug id: ${id}`);
    }
    this.store.savePlugs(next);
    return next.map(cloneDevice);
  }

  async discover(): Promise<PlugDevice[]> {
    const host = this.hosts.kasa;
    if (!host.discover) {
      return [];
    }
    try {
      return await host.discover();
    } catch (error) {
      console.error("Plug discover failed:", errorMessage(error));
      return [];
    }
  }

  async on(ids: string[]): Promise<PlugSnapshot[]> {
    return this.setPower(ids, true);
  }

  async off(ids: string[]): Promise<PlugSnapshot[]> {
    return this.setPower(ids, false);
  }

  /**
   * Demo Kill / session path: cut enabled secondary plugs.
   * Skips study-PC / localhost / empty-address devices instead of throwing.
   */
  async cutSecondary(ids?: string[]): Promise<PlugSnapshot[]> {
    const devices = await this.resolveCutTargets(ids);
    const snaps: PlugSnapshot[] = [];
    for (const device of devices) {
      if (!isControllable(device)) {
        const verdict = inspectControllable(device);
        snaps.push({
          ts: this.now(),
          deviceId: device.id,
          online: false,
          powerOn: null,
          error: verdict.ok ? "not controllable" : verdict.reason,
        });
        continue;
      }
      snaps.push(await this.applyPower(device, false));
    }
    return snaps;
  }

  async snapshot(ids?: string[]): Promise<PlugSnapshot[]> {
    const devices = this.resolveSnapshotTargets(ids);
    const snaps: PlugSnapshot[] = [];
    for (const device of devices) {
      snaps.push(await this.queryDevice(device));
    }
    return snaps;
  }

  private async setPower(ids: string[], on: boolean): Promise<PlugSnapshot[]> {
    if (!Array.isArray(ids)) {
      throw new Error("ids must be an array of plug ids");
    }
    const devices = ids.map((id) => this.require(id));
    for (const device of devices) {
      assertControllable(device);
    }
    const snaps: PlugSnapshot[] = [];
    for (const device of devices) {
      snaps.push(await this.applyPower(device, on));
    }
    return snaps;
  }

  private async applyPower(device: PlugDevice, on: boolean): Promise<PlugSnapshot> {
    const ts = this.now();
    try {
      const powerOn = await this.hostFor(device).setPower(device, on);
      return { ts, deviceId: device.id, online: true, powerOn };
    } catch (error) {
      return {
        ts,
        deviceId: device.id,
        online: false,
        powerOn: null,
        error: errorMessage(error),
      };
    }
  }

  private async queryDevice(device: PlugDevice): Promise<PlugSnapshot> {
    const ts = this.now();
    try {
      const powerOn = await this.hostFor(device).query(device);
      return { ts, deviceId: device.id, online: true, powerOn };
    } catch (error) {
      return {
        ts,
        deviceId: device.id,
        online: false,
        powerOn: null,
        error: errorMessage(error),
      };
    }
  }

  private hostFor(device: PlugDevice): PlugHost {
    return this.hosts[device.protocol];
  }

  private require(id: string): PlugDevice {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error("Unknown plug id: (empty)");
    }
    const device = this.store.loadPlugs().find((entry) => entry.id === id);
    if (!device) {
      throw new Error(`Unknown plug id: ${id}`);
    }
    return cloneDevice(device);
  }

  private resolveSnapshotTargets(ids?: string[]): PlugDevice[] {
    if (ids === undefined) {
      return this.store.loadPlugs().map(cloneDevice);
    }
    if (!Array.isArray(ids)) {
      throw new Error("ids must be an array of plug ids");
    }
    return ids.map((id) => this.require(id));
  }

  private async resolveCutTargets(ids?: string[]): Promise<PlugDevice[]> {
    const listed = await this.list();
    if (ids === undefined) {
      return listed.filter((device) => device.enabled);
    }
    return listed.filter((device) => ids.includes(device.id));
  }

  private normalizeDevice(raw: unknown): PlugDevice {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("plug must be an object");
    }
    const draft = raw as Record<string, unknown>;
    if (typeof draft.name !== "string" || draft.name.trim().length === 0) {
      throw new Error("plug name is required");
    }
    if (!isPlugProtocol(draft.protocol)) {
      throw new Error('plug protocol must be "kasa", "http", or "mock"');
    }
    if (typeof draft.address !== "string") {
      throw new Error("plug address is required");
    }
    const id =
      typeof draft.id === "string" && draft.id.trim().length > 0
        ? draft.id.trim()
        : this.idFactory();
    let address = draft.address.trim();
    if (draft.protocol === "mock" && address.length === 0) {
      address = "mock";
    }
    return {
      id,
      name: draft.name.trim(),
      protocol: draft.protocol,
      address,
      enabled: draft.enabled !== false,
      isStudyPc: false,
    };
  }
}

export function createPlugController(options: PlugControllerOptions): PlugController {
  return new PlugController(options);
}
