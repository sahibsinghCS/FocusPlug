/**
 * Windows / LAN Kasa probe (optional hardware).
 *
 *   npx tsx --tsconfig tsconfig.node.json src/main/plugs/probe.ts --ip 192.168.1.50
 *   npx tsx --tsconfig tsconfig.node.json src/main/plugs/probe.ts --ip 192.168.1.50 --off
 *   npx tsx --tsconfig tsconfig.node.json src/main/plugs/probe.ts --ip 192.168.1.50 --on
 *   npx tsx --tsconfig tsconfig.node.json src/main/plugs/probe.ts --discover
 *
 * Uses the local TP-Link XOR protocol on TCP/UDP 9999. No Kasa cloud account.
 * Never pass the study PC's address.
 */
import { inspectControllable } from "./protect.ts";
import { createKasaPlugHost } from "./kasa.ts";
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
  line("=== FocusPlug Kasa LAN probe ===");
  line("Local protocol only. Will not target a device marked study-PC / localhost.");
  const host = createKasaPlugHost();

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
