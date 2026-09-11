import type { AppSettings } from "../../shared/ipc.ts";
import type { PlugDevice } from "../../shared/types.ts";
import { normalizePlugs, normalizeSettings } from "../store/appStore.ts";
import type { PlugStore } from "./types.ts";

export interface SettingsSource {
  loadSettings(): AppSettings;
  saveSettings(settings: AppSettings): void;
}

/** PlugStore backed by AppSettings.plugs (frozen persistence path). */
export class SettingsPlugStore implements PlugStore {
  constructor(private readonly settings: SettingsSource) {}

  loadPlugs(): PlugDevice[] {
    return normalizePlugs(this.settings.loadSettings().plugs);
  }

  savePlugs(devices: PlugDevice[]): void {
    const current = this.settings.loadSettings();
    this.settings.saveSettings(
      normalizeSettings({
        ...current,
        plugs: devices,
      }),
    );
  }
}

export function createSettingsPlugStore(settings: SettingsSource): SettingsPlugStore {
  return new SettingsPlugStore(settings);
}
