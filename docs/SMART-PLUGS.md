# Smart plugs (secondary fun devices only)

FocusPlug can cut **optional** LAN smart plugs when a session kill / **Demo Kill** fires. This is a stretch path. The app boots with **zero plugs** (`AppSettings.plugs: []`) and never requires a vendor cloud account.

**Hard rule:** never power off or control the study PC. Plugs are for secondary fun devices (RGB lamp, speaker, game-PC PSU on a *different* outlet). The study machine stays on. Frozen `PlugDevice.isStudyPc` is the literal `false`; persistence drops anything else.

## What ships

| Adapter | Path | Cloud? |
| --- | --- | --- |
| **Mock** | In-memory host for tests / CI | No |
| **Kasa** | TP-Link HS100/HS103/KP105-class, local TCP/UDP **9999** XOR protocol | No. Device must be on the same LAN |
| **HTTP** | `POST {address}/on` and `{address}/off` (Tasmota, Shelly, DIY) | No |

### Which TP-Link plugs work, and how

The `kasa` adapter speaks **both** TP-Link dialects and picks automatically:

| Dialect | Devices | Port | Credentials |
| --- | --- | --- | --- |
| Legacy XOR | HS100, HS103, HS105, KP105, KP115 on original firmware | 9999 | none |
| **KLAP v2** | **Tapo P100, P105, P110, P110M**, recent Kasa firmware | 80 | TP-Link account |

Legacy is tried first. Tapo devices keep 9999 closed, so that attempt is refused
in milliseconds and the adapter falls back to KLAP.

#### Credentials

KLAP needs your TP-Link account. `PlugDevice` is a frozen contract carrying only
an address, and a settings file is the wrong place for a password, so
credentials come from the environment:

```powershell
$env:FOCUSPLUG_TAPO_USERNAME = "you@example.com"
$env:FOCUSPLUG_TAPO_PASSWORD = "your-tp-link-password"
npm run dev
```

`TAPO_EMAIL` / `TAPO_PASSWORD` and `KASA_USERNAME` / `KASA_PASSWORD` work too.
Without them, Tapo plugs fail with a message telling you to set them; legacy
plugs are unaffected. **Never commit these** — they control physical devices in
your home, and FocusPlug never writes them to disk.

One connection is held per plug and reused. Re-handshaking on every command
trips the device's local-auth throttle, which then reports *"challenge did not
match"* — indistinguishable from a wrong password until it cools down.

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

### No hardware? Run a fake plug

Legacy:

```bash
npm run mock:plug                                  # terminal 1
npm run probe:plugs -- --discover                  # terminal 2
npm run probe:plugs -- --ip <your-lan-ip> --off
npm run probe:plugs -- --ip <your-lan-ip> --on
```

Tapo / KLAP:

```bash
npm run mock:tapo                                  # terminal 1, port 8080
$env:FOCUSPLUG_TAPO_USERNAME = "user@example.com"  # the simulator's defaults
$env:FOCUSPLUG_TAPO_PASSWORD = "hunter2"
npm run probe:plugs -- --ip <your-lan-ip> --klap-port 8080 --off
```

Both are real socket servers, so these exercise the actual driver — framing,
handshake, encryption, relay set and the verification read — not a stubbed
transport. Use your machine's LAN address, not `localhost`: `protect.ts` refuses
loopback on a real adapter.

#### How the KLAP client was verified without a plug

Getting a protocol subtly wrong is easy, and a simulator you wrote yourself will
happily agree with a client you wrote yourself. So the chain is anchored to
[python-kasa](https://github.com/python-kasa/python-kasa) 0.10.2, the reference
implementation:

1. **Derivations are pinned to reference vectors.** `klap.test.ts` checks the
   auth hash, both handshake hashes, key, IV, starting sequence, signature and a
   full encrypted request against values emitted by python-kasa's own
   `KlapTransportV2` / `KlapEncryptionSession` for fixed seeds — byte for byte.
2. **The simulator is validated by the reference client.** python-kasa's
   `KlapTransportV2` completes handshake1, handshake2, `get_device_info` and two
   `set_device_info` calls against `scripts/mock-tapo-device.ts`. A simulator the
   reference accepts is behaving like a device at this layer.
3. **Our client is validated against that same simulator** (`klapClient.test.ts`,
   `tapoFallback.test.ts`), including credential rejection and session reuse.

What this does **not** prove: that a physical P110M answers identically. Run
`npm run probe:plugs -- --ip <plug-ip>` against the real plug before relying on
it in a demo.

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
