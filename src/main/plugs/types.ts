import type {
  PlugController,
  PlugDevice,
  PlugProtocol,
  PlugSnapshot,
} from "../../shared/ipc.ts";

export type { PlugController, PlugDevice, PlugProtocol, PlugSnapshot };

export interface PlugHost {
  readonly protocol: PlugProtocol;
  setPower(device: PlugDevice, on: boolean): Promise<boolean>;
  query(device: PlugDevice): Promise<boolean | null>;
  discover?(): Promise<PlugDevice[]>;
}

export interface PlugStore {
  loadPlugs(): PlugDevice[];
  savePlugs(devices: PlugDevice[]): void;
}

export interface PlugProtectDenial {
  ok: false;
  reason: string;
}

export type PlugProtectVerdict = { ok: true } | PlugProtectDenial;
