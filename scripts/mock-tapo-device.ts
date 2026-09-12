/**
 * A fake KLAP v2 plug (Tapo-style) so the KLAP client can be exercised without
 * hardware.
 *
 *   npm run mock:tapo                                   # terminal 1
 *   npm run probe:plugs -- --ip 127.0.0.1 --klap-port 8080
 *
 * Credentials default to the test pair; override with --username/--password.
 *
 * This simulator is only worth testing against because python-kasa's own
 * KlapTransportV2 completes a handshake, a get_device_info and two
 * set_device_info calls against it (docs/SMART-PLUGS.md records the run).
 * Without that cross-check, running our client against our own simulator would
 * only prove the two agree with each other.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  deriveKlapKeys,
  handshake1Hash,
  handshake2Hash,
  klapAuthHash,
} from "../src/main/plugs/klap.ts";

export interface MockTapoOptions {
  username?: string;
  password?: string;
  /** Initial relay state. */
  deviceOn?: boolean;
  /** Log each protocol step. */
  verbose?: boolean;
}

function int32be(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeInt32BE(value | 0, 0);
  return out;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createMockTapoServer(options: MockTapoOptions = {}): Server {
  const username = options.username ?? "user@example.com";
  const password = options.password ?? "hunter2";
  const auth = klapAuthHash(username, password);
  const log = (message: string): void => {
    if (options.verbose) {
      console.log(message);
    }
  };

  let deviceOn = options.deviceOn ?? true;
  let localSeed: Buffer | null = null;
  let remoteSeed: Buffer | null = null;

  function handleMethod(request: Record<string, unknown>): Record<string, unknown> {
    const method = String(request["method"] ?? "");
    if (method === "set_device_info") {
      const params = (request["params"] ?? {}) as Record<string, unknown>;
      if (typeof params["device_on"] === "boolean") {
        deviceOn = params["device_on"];
        log(`  [tapo] device_on -> ${deviceOn}`);
      }
      return { error_code: 0, result: {} };
    }
    if (method === "get_device_info") {
      return {
        error_code: 0,
        result: {
          device_id: "MOCKTAPO0001",
          model: "P110M",
          type: "SMART.TAPOPLUG",
          device_on: deviceOn,
          nickname: Buffer.from("Mock desk lamp", "utf8").toString("base64"),
        },
      };
    }
    log(`  [tapo] unsupported method ${method}`);
    return { error_code: -1001, result: {} };
  }

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://mock.local");
      const body = await readBody(req);

      if (url.pathname === "/app/handshake1") {
        localSeed = body.subarray(0, 16);
        remoteSeed = randomBytes(16);
        log("  [tapo] handshake1");
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Set-Cookie": "TP_SESSIONID=MOCKSESSION;TIMEOUT=1440",
        });
        res.end(Buffer.concat([remoteSeed, handshake1Hash(localSeed, remoteSeed, auth)]));
        return;
      }

      if (url.pathname === "/app/handshake2") {
        if (localSeed === null || remoteSeed === null) {
          res.writeHead(403).end();
          return;
        }
        if (!handshake2Hash(localSeed, remoteSeed, auth).equals(body)) {
          log("  [tapo] handshake2 REJECTED");
          res.writeHead(403).end();
          return;
        }
        log("  [tapo] handshake2 ok");
        res.writeHead(200).end();
        return;
      }

      if (url.pathname === "/app/request") {
        if (localSeed === null || remoteSeed === null) {
          res.writeHead(403).end();
          return;
        }
        const seq = Number(url.searchParams.get("seq"));
        const keys = deriveKlapKeys(localSeed, remoteSeed, auth);
        const iv = Buffer.concat([keys.iv, int32be(seq)]);

        const decipher = createDecipheriv("aes-128-cbc", keys.key, iv);
        const plain = Buffer.concat([
          decipher.update(body.subarray(32)),
          decipher.final(),
        ]).toString("utf8");
        log(`  [tapo] request seq=${seq} <- ${plain}`);

        const reply = JSON.stringify(handleMethod(JSON.parse(plain) as Record<string, unknown>));
        const cipher = createCipheriv("aes-128-cbc", keys.key, iv);
        const ciphertext = Buffer.concat([
          cipher.update(Buffer.from(reply, "utf8")),
          cipher.final(),
        ]);
        const signature = createHash("sha256")
          .update(Buffer.concat([keys.sig, int32be(seq), ciphertext]))
          .digest();
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(Buffer.concat([signature, ciphertext]));
        return;
      }

      res.writeHead(404).end();
    })();
  });
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

// Only listen when run as a script; the tests import the factory.
if (process.argv[1]?.replace(/\\/gu, "/").includes("scripts/mock-tapo-device")) {
  const port = Number(arg("port", "8080"));
  const username = arg("username", "user@example.com");
  const password = arg("password", "hunter2");
  createMockTapoServer({ username, password, verbose: true }).listen(port, () => {
    console.log(`mock Tapo (KLAP v2) listening on http://127.0.0.1:${port}`);
    console.log(`credentials: ${username} / ${"*".repeat(password.length)}`);
  });
}
