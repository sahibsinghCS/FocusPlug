import type { PlugDevice } from "../../shared/types.ts";
import type { PlugStore } from "./types.ts";

/** In-memory PlugStore for unit tests. */
export class MemoryPlugStore implements PlugStore {
  private devices: PlugDevice[] = [];

  constructor(seed: PlugDevice[] = []) {
    this.devices = seed.map((device) => ({ ...device }));
  }

  loadPlugs(): PlugDevice[] {
    return this.devices.map((device) => ({ ...device }));
  }

  savePlugs(devices: PlugDevice[]): void {
    this.devices = devices.map((device) => ({ ...device }));
  }
}
