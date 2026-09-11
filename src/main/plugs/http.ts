import type { PlugDevice } from "../../shared/types.ts";
import type { PlugHost } from "./types.ts";

export interface HttpPlugFetch {
  (url: string, init: { method: string; signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface HttpPlugHostOptions {
  fetch?: HttpPlugFetch;
  timeoutMs?: number;
}

/**
 * Generic HTTP plug adapter. Frozen PlugDevice only has `address`, so this
 * POSTs `{address}/on` and `{address}/off` (Tasmota, Shelly, DIY). No cloud.
 */
export class HttpPlugHost implements PlugHost {
  readonly protocol = "http" as const;
  private readonly fetchImpl: HttpPlugFetch;
  private readonly timeoutMs: number;

  constructor(options: HttpPlugHostOptions = {}) {
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.timeoutMs = options.timeoutMs ?? 4000;
  }

  async setPower(device: PlugDevice, on: boolean): Promise<boolean> {
    const url = httpCommandUrl(device.address, on ? "on" : "off");
    await this.request(url, `set ${on ? "on" : "off"} for ${device.name}`);
    return on;
  }

  async query(device: PlugDevice): Promise<boolean | null> {
    const body = await this.request(httpCommandUrl(device.address, "status"), `query ${device.name}`);
    return inferPowerFromBody(body);
  }

  private async request(url: string, label: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP plug ${label} failed (${response.status}): ${text.slice(0, 180)}`);
      }
      return text;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`HTTP plug ${label} timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Frozen PlugDevice only has `address`. HTTP plugs POST `{base}/on|off|status`. */
export function httpCommandUrl(address: string, command: "on" | "off" | "status"): string {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new Error("HTTP plug address is empty");
  }
  const base = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed.replace(/\/+$/, "")
    : `http://${trimmed.replace(/\/+$/, "")}`;
  return `${base}/${command}`;
}

function defaultFetch(
  url: string,
  init: { method: string; signal?: AbortSignal },
): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  return fetch(url, { method: init.method, signal: init.signal });
}

export function inferPowerFromBody(body: string): boolean | null {
  const trimmed = body.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const candidate =
        record.on ??
        record.relay ??
        record.relay_state ??
        record.POWER ??
        (typeof record.StatusSTS === "object" && record.StatusSTS !== null
          ? (record.StatusSTS as Record<string, unknown>).POWER
          : undefined);
      if (typeof candidate === "boolean") {
        return candidate;
      }
      if (typeof candidate === "number") {
        return candidate !== 0;
      }
      if (typeof candidate === "string") {
        return inferPowerFromBody(candidate);
      }
    }
  } catch {
    // fall through to text tokens
  }
  if (trimmed === "on" || trimmed === "1" || trimmed === "true") {
    return true;
  }
  if (trimmed === "off" || trimmed === "0" || trimmed === "false") {
    return false;
  }
  return null;
}

export function createHttpPlugHost(options?: HttpPlugHostOptions): HttpPlugHost {
  return new HttpPlugHost(options);
}
