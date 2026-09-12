/**
 * A fake legacy Kasa plug (autokey XOR on TCP+UDP 9999) for testing the plug
 * path with no hardware.
 *
 *   npm run mock:plug                       # terminal 1
 *   npm run probe:plugs -- --discover       # terminal 2
 *   npm run probe:plugs -- --ip <your-lan-ip> --off
 *
 * Bind to 0.0.0.0 (default) and it answers on every interface, which is also
 * how you can tell whether discovery is reaching the right subnet: the log
 * prints the source address of each datagram.
 *
 * This speaks the LEGACY protocol only. Tapo P-series and newer Kasa firmware
 * use KLAP and will not behave like this — see docs/SMART-PLUGS.md.
 */
import { createServer } from "node:net";
import { createSocket } from "node:dgram";

const KEY = 0xab;
const PORT = 9999;
const hostFlag = process.argv.indexOf("--host");
const host = hostFlag === -1 ? "0.0.0.0" : (process.argv[hostFlag + 1] ?? "0.0.0.0");

let relayState = 1;

function encrypt(plain) {
  const out = Buffer.alloc(plain.length);
  let key = KEY;
  for (let i = 0; i < plain.length; i += 1) {
    out[i] = plain[i] ^ key;
    key = out[i];
  }
  return out;
}

function decrypt(cipher) {
  const out = Buffer.alloc(cipher.length);
  let key = KEY;
  for (let i = 0; i < cipher.length; i += 1) {
    out[i] = cipher[i] ^ key;
    key = cipher[i];
  }
  return out;
}

function handle(request) {
  let parsed;
  try {
    parsed = JSON.parse(request);
  } catch {
    return JSON.stringify({ err_code: -1, err_msg: "bad json" });
  }
  const setRelay = parsed?.system?.set_relay_state;
  if (setRelay && typeof setRelay.state === "number") {
    relayState = setRelay.state ? 1 : 0;
    console.log(`  [device] relay -> ${relayState ? "ON" : "OFF"}`);
    return JSON.stringify({ system: { set_relay_state: { err_code: 0 } } });
  }
  if (parsed?.system?.get_sysinfo !== undefined) {
    return JSON.stringify({
      system: {
        get_sysinfo: {
          alias: "Mock desk lamp",
          deviceId: "MOCK0001",
          model: "HS103(US)",
          relay_state: relayState,
          err_code: 0,
        },
      },
    });
  }
  return JSON.stringify({ err_code: -1, err_msg: "unsupported" });
}

const tcp = createServer((socket) => {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) {
        return;
      }
      const body = decrypt(buffer.subarray(4, 4 + length)).toString("utf8");
      buffer = buffer.subarray(4 + length);
      console.log(`  [device] tcp <- ${body}`);
      const reply = encrypt(Buffer.from(handle(body), "utf8"));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(reply.length, 0);
      socket.write(Buffer.concat([header, reply]));
    }
  });
  socket.on("error", () => {});
});
tcp.listen(PORT, host, () => console.log(`mock Kasa TCP listening ${host}:${PORT}`));

const udp = createSocket({ type: "udp4", reuseAddr: true });
udp.on("message", (msg, rinfo) => {
  const body = decrypt(msg).toString("utf8");
  console.log(`  [device] udp <- ${body} (from ${rinfo.address}:${rinfo.port})`);
  const reply = encrypt(Buffer.from(handle(body), "utf8"));
  udp.send(reply, rinfo.port, rinfo.address);
});
udp.bind(PORT, host, () => console.log(`mock Kasa UDP listening ${host}:${PORT}`));

process.on("SIGINT", () => process.exit(0));
