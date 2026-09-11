import type { PlugDevice } from "../../shared/types.ts";
import type { PlugHost } from "./types.ts";

/**
 * In-memory plug host for tests and CI. Power state is per device id.
 * Never talks to the network.
 */
export class MockPlugHost implements PlugHost {
  readonly protocol = "mock" as const;
  private readonly power = new Map<string, boolean>();

  seed(id: string, on = true): this {
    this.power.set(id, on);
    return this;
  }

  getPower(id: string): boolean | undefined {
    return this.power.get(id);
  }

  clear(): void {
    this.power.clear();
  }

  async setPower(device: PlugDevice, on: boolean): Promise<boolean> {
    this.power.set(device.id, on);
    return on;
  }

  async query(device: PlugDevice): Promise<boolean | null> {
    return this.power.has(device.id) ? (this.power.get(device.id) ?? null) : null;
  }
}

export function createMockPlugHost(): MockPlugHost {
  return new MockPlugHost();
}
