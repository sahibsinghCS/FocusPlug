/**
 * Windows / LAN TP-Link plug probe (optional hardware).
 *
 *   npm run probe:plugs -- --ip 192.168.1.50
 *   npm run probe:plugs -- --ip 192.168.1.50 --off
 *   npm run probe:plugs -- --ip 192.168.1.50 --on
 *   npm run probe:plugs -- --discover
 *
 * Tries the legacy XOR protocol on 9999 first, then KLAP on 80 for Tapo and
 * recent Kasa firmware. KLAP needs a TP-Link account in the environment:
 *
 *   $env:FOCUSPLUG_TAPO_USERNAME = "you@example.com"
 *   $env:FOCUSPLUG_TAPO_PASSWORD = "..."
 *
 * `--klap-port` points KLAP somewhere other than 80, for `npm run mock:tapo`.
 * Never pass the study PC's address.
 */
import { inspectControllable } from "./protect.ts";
import { createKasaPlugHost } from "./kasa.ts";
import { KlapPool, klapCredentialsFromEnv } from "./klap.ts";
import type { PlugDevice } from "./types.ts";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function line(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  line("=== FocusPlug TP-Link plug probe ===");
  line("Local protocol only. Will not target a device marked study-PC / localhost.");

  const credentials = klapCredentialsFromEnv();
  const klapPort = arg("--klap-port");
  if (credentials === null) {
    line("KLAP credentials: not set - legacy (9999) plugs only, Tapo will fail");
  } else {
    line(`KLAP credentials: ${credentials.username}${klapPort ? ` (port ${klapPort})` : ""}`);
  }
  const klap =
    credentials === null
      ? null
      : new KlapPool(credentials, klapPort ? Number(klapPort) : undefined);
  const host = createKasaPlugHost(undefined, klap);

  if (has("--discover")) {
    const found = await host.discover();
    line(`discover: ${found.length} device(s)`);
    for (const device of found) {
      line(`  ${device.address}  ${device.name ?? ""}  ${device.id ?? ""}`);
    }
    return;
  }

  const ip = arg("--ip");
  if (!ip) {
    line("Usage: probe.ts --ip <lan-ip> [--off|--on]  or  probe.ts --discover");
    process.exitCode = 2;
    return;
  }

  const device: PlugDevice = {
    id: `probe:${ip}`,
    name: has("--name") ? (arg("--name") ?? "probe") : "probe",
    protocol: "kasa",
    address: ip,
    isStudyPc: false,
    enabled: true,
  };
  const verdict = inspectControllable(device);
  if (!verdict.ok) {
    line(`PROTECT ${verdict.reason}`);
    process.exitCode = 3;
    return;
  }

  if (has("--off")) {
    const on = await host.setPower(device, false);
    line(`set off → ${on ? "ON" : "OFF"}`);
  } else if (has("--on")) {
    const on = await host.setPower(device, true);
    line(`set on → ${on ? "ON" : "OFF"}`);
  } else {
    const on = await host.query(device);
    line(`query ${ip} → ${on === null ? "unknown" : on ? "ON" : "OFF"}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
