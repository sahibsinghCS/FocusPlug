# Smart plugs (secondary fun devices only)

FocusPlug can cut **optional** LAN smart plugs when a session kill / **Demo Kill** fires. This is a stretch path. The app boots with **zero plugs** (`AppSettings.plugs: []`) and never requires a vendor cloud account.

**Hard rule:** never power off or control the study PC. Plugs are for secondary fun devices (RGB lamp, speaker, game-PC PSU on a *different* outlet). The study machine stays on. Frozen `PlugDevice.isStudyPc` is the literal `false`; persistence drops anything else.

## What ships

| Adapter | Path | Cloud? |
| --- | --- | --- |
| **Mock** | In-memory host for tests / CI | No |
| **Kasa** | TP-Link HS100/HS103/KP105-class, local TCP/UDP **9999** XOR protocol | No. Device must be on the same LAN |
| **HTTP** | `POST {address}/on` and `{address}/off` (Tasmota, Shelly, DIY) | No |

> ### Which TP-Link plugs actually work
>
> The `kasa` adapter speaks the **legacy** local protocol only: unauthenticated
> autokey XOR on port 9999. That covers older Kasa hardware (HS100, HS103,
> HS105, KP105, KP115 on original firmware).
>
> It does **not** work with **Tapo** plugs (P100, P105, P110, **P110M**) or with
> newer Kasa firmware. Those speak **KLAP** — an encrypted handshake on port 80
> that requires your TP-Link account credentials. Port 9999 is closed on them,
> so `plugsTest` and Demo Kill will fail with a connection error, not a wrong
> answer.
>
> If your plug is a Tapo, you have three options: use a legacy Kasa plug for the
> demo; put something that already speaks KLAP (Home Assistant, or a small
> `python-kasa` service) in front of it and point the **HTTP** adapter at that;
> or leave plugs out of the film. Do not claim plug control on Devpost that you
> have not seen work on your own hardware.

Frozen main-process API (`window.focusplug` / `PlugController`):

- `plugsList` / `plugsAdd` / `plugsRemove` — persisted on `settings.plugs`
- `plugsTest(deviceId)` — live `PlugSnapshot` once a driver is wired
- `PlugController.on(ids)` / `off(ids)` / `list()` / `discover()` — always run through `protect.ts`

**Demo Kill** force-quits blocklist processes **and** cuts every enabled, protect-approved plug.

## Add a Kasa plug by IP (Windows)

1. Put the plug and the Windows PC on the **same Wi-Fi / LAN**. Do not use the Kasa cloud login for this MVP path.
2. Read the plug’s IPv4 from the router DHCP list or the Kasa app (LAN IP).
3. Confirm it is **not** the study PC’s outlet. Name it something like `rgb-lamp`, never `study-pc`.
4. Add it via the frozen preload API:

```ts
await window.focusplug.plugsAdd({
  id: "lamp",
  name: "RGB lamp",
  protocol: "kasa",
  address: "192.168.1.50",
  enabled: true,
  isStudyPc: false,
});
```

5. Click **Demo Kill**. The lamp should go dark. Blocklist apps still quit as before.
6. Restore power with the physical button, or later session `plug_on`.

### LAN probe (no Electron)

```bash
npm run probe:plugs -- --ip 192.168.1.50
npm run probe:plugs -- --ip 192.168.1.50 --off
npm run probe:plugs -- --ip 192.168.1.50 --on
npm run probe:plugs -- --discover
```

If UDP broadcast fails in CI (no LAN), that is expected. Mock + `protect` + controller tests are the CI bar. On Windows, the probe above is the hardware check.

Discovery sends to **every local subnet's broadcast address**, not just
`255.255.255.255`. On a Windows machine with VirtualBox / WSL / Hyper-V
adapters, the global broadcast follows the routing table and regularly leaves by
a host-only adapter: measured here, a device reachable at `192.168.1.14` was
reported at `192.168.56.1`, and a real plug on the Wi-Fi subnet would simply be
missed. One device answering on several interfaces is deduplicated by device id.

### No hardware? Run the fake plug

```bash
npm run mock:plug                                  # terminal 1
npm run probe:plugs -- --discover                  # terminal 2
npm run probe:plugs -- --ip <your-lan-ip> --off
npm run probe:plugs -- --ip <your-lan-ip> --on
```

`scripts/mock-kasa-device.mjs` is a real socket server speaking the legacy
protocol, so this exercises the actual driver — encode, TCP framing, relay set,
and the verification read — rather than a stubbed transport. Use your machine's
LAN address, not `localhost`: `protect.ts` refuses loopback on a real adapter.

### Protocol note

Kasa LAN uses the well-known autokey XOR (`0xAB`) on port 9999. FocusPlug implements that locally (`src/main/plugs/kasa.ts`) so we do not depend on a cloud SDK.

## HTTP plugs

Frozen `PlugDevice` has a single `address`. HTTP plugs POST:

- `{address}/on`
- `{address}/off`
- `{address}/status` (query)

```ts
await window.focusplug.plugsAdd({
  id: "strip",
  name: "Tasmota strip",
  protocol: "http",
  address: "192.168.1.77",
  enabled: true,
  isStudyPc: false,
});
```

`localhost` / `127.0.0.1` / `::1` addresses are refused on kasa/http (treated as the study machine).

## Protect denials

Control is refused when any of these hold:

- `isStudyPc !== false`
- name or id looks like `study-pc` / `study_pc` / `study pc`
- empty address
- loopback host on a real (non-mock) adapter

Poisoned settings cannot make Demo Kill cut the study PC: `cutSecondary()` skips denied devices and still cuts the lamp.

## Tests

```bash
npm run test:plugs
npm run gauntlet:plugs
```
