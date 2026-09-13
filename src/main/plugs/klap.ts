/**
 * KLAP v2 - the protocol newer TP-Link plugs speak (Tapo P100/P105/P110/P110M
 * and recent Kasa firmware). The legacy 9999 XOR protocol in `kasa.ts` is not
 * available on these devices; port 9999 is closed.
 *
 * Handshake, over plain HTTP on port 80:
 *
 *   auth_hash  = sha256(sha1(username) + sha1(password))
 *   handshake1 -> POST /app/handshake1 with 16 random local_seed bytes.
 *                 Response is remote_seed(16) + server_hash(32), and a
 *                 TP_SESSIONID cookie. server_hash must equal
 *                 sha256(local_seed + remote_seed + auth_hash), which is how we
 *                 know the credentials are right.
 *   handshake2 -> POST /app/handshake2 with
 *                 sha256(remote_seed + local_seed + auth_hash).
 *
 * Then every request is AES-128-CBC with a per-request IV and a signature:
 *
 *   key  = sha256("lsk" + local_seed + remote_seed + auth_hash)[:16]
 *   iv   = sha256("iv"  + local_seed + remote_seed + auth_hash)[:12]
 *   seq  = int32be(sha256("iv" + ...)[28:32])   // incremented per request
 *   sig  = sha256("ldk" + local_seed + remote_seed + auth_hash)[:28]
 *   body = sha256(sig + int32be(seq) + ciphertext) + ciphertext
 *
 * Every derivation is pinned byte-for-byte to python-kasa 0.10.2
 * (`kasa/transports/klaptransport.py`) by the vectors in `klap.test.ts`.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { request as httpRequest } from "node:http";

export const KLAP_PORT = 80;
const HANDSHAKE_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 5000;

function sha1(payload: Buffer): Buffer {
  return createHash("sha1").update(payload).digest();
}

function sha256(payload: Buffer): Buffer {
  return createHash("sha256").update(payload).digest();
}

function int32be(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeInt32BE(value | 0, 0);
  return out;
}

/** sha256(sha1(username) + sha1(password)) - KLAP v2. */
export function klapAuthHash(username: string, password: string): Buffer {
  return sha256(
    Buffer.concat([sha1(Buffer.from(username, "utf8")), sha1(Buffer.from(password, "utf8"))]),
  );
}

export function handshake1Hash(local: Buffer, remote: Buffer, authHash: Buffer): Buffer {
  return sha256(Buffer.concat([local, remote, authHash]));
}

export function handshake2Hash(local: Buffer, remote: Buffer, authHash: Buffer): Buffer {
  return sha256(Buffer.concat([remote, local, authHash]));
}

export interface KlapKeys {
  key: Buffer;
  iv: Buffer;
  seq: number;
  sig: Buffer;
}

export function deriveKlapKeys(local: Buffer, remote: Buffer, authHash: Buffer): KlapKeys {
  const seeds = Buffer.concat([local, remote, authHash]);
  const fullIv = sha256(Buffer.concat([Buffer.from("iv", "utf8"), seeds]));
  return {
    key: sha256(Buffer.concat([Buffer.from("lsk", "utf8"), seeds])).subarray(0, 16),
    iv: fullIv.subarray(0, 12),
    seq: fullIv.readInt32BE(28),
    sig: sha256(Buffer.concat([Buffer.from("ldk", "utf8"), seeds])).subarray(0, 28),
  };
}

/** Encrypts requests and tracks the sequence number the device expects. */
export class KlapSession {
  private readonly keys: KlapKeys;
  private seq: number;

  constructor(local: Buffer, remote: Buffer, authHash: Buffer) {
    this.keys = deriveKlapKeys(local, remote, authHash);
    this.seq = this.keys.seq;
  }

  /** Sequence number the next request will carry. */
  get nextSeq(): number {
    return (this.seq + 1) | 0;
  }

  private ivFor(seq: number): Buffer {
    return Buffer.concat([this.keys.iv, int32be(seq)]);
  }

  encrypt(message: string): { payload: Buffer; seq: number } {
    this.seq = (this.seq + 1) | 0;
    const cipher = createCipheriv("aes-128-cbc", this.keys.key, this.ivFor(this.seq));
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(message, "utf8")),
      cipher.final(),
    ]);
    const signature = sha256(Buffer.concat([this.keys.sig, int32be(this.seq), ciphertext]));
    return { payload: Buffer.concat([signature, ciphertext]), seq: this.seq };
  }

  /** Decrypts a response for `seq`; the leading 32 bytes are the signature. */
  decrypt(payload: Buffer, seq: number): string {
    const decipher = createDecipheriv("aes-128-cbc", this.keys.key, this.ivFor(seq));
    return Buffer.concat([
      decipher.update(payload.subarray(32)),
      decipher.final(),
    ]).toString("utf8");
  }
}

export interface KlapCredentials {
  username: string;
  password: string;
}

interface HttpReply {
  status: number;
  body: Buffer;
  cookie: string | null;
}

function post(
  host: string,
  port: number,
  path: string,
  body: Buffer,
  timeoutMs: number,
  cookie?: string | null,
): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
    };
    if (cookie) {
      headers["Cookie"] = cookie;
    }
    const req = httpRequest(
      { host, port, path, method: "POST", headers, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const setCookie = res.headers["set-cookie"]?.[0] ?? null;
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
            // Only the TP_SESSIONID pair, without attributes like TIMEOUT.
            cookie: setCookie ? (setCookie.split(";")[0] ?? null) : null,
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`KLAP timeout after ${timeoutMs}ms (${host}${path})`));
    });
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * One authenticated KLAP connection. Reuse it: the device rate-limits fresh
 * handshakes and answers a storm of them with a misleading "challenge did not
 * match" error, which reads exactly like wrong credentials.
 */
export class KlapClient {
  private session: KlapSession | null = null;
  private cookie: string | null = null;
  private readonly terminalUuid = Buffer.from(
    createHash("md5").update(randomUUID()).digest(),
  ).toString("base64");

  constructor(
    private readonly host: string,
    private readonly credentials: KlapCredentials,
    /** Override only for the local simulator; real plugs listen on 80. */
    private readonly port: number = KLAP_PORT,
  ) {}

  get connected(): boolean {
    return this.session !== null;
  }

  reset(): void {
    this.session = null;
    this.cookie = null;
  }

  async handshake(): Promise<void> {
    const authHash = klapAuthHash(this.credentials.username, this.credentials.password);
    const localSeed = randomBytes(16);

    const first = await post(
      this.host,
      this.port,
      "/app/handshake1",
      localSeed,
      HANDSHAKE_TIMEOUT_MS,
    );
    if (first.status !== 200) {
      throw new Error(`KLAP handshake1 returned ${first.status} (${this.host})`);
    }
    if (first.body.length < 48) {
      throw new Error(`KLAP handshake1 returned ${first.body.length} bytes, expected 48`);
    }
    const remoteSeed = first.body.subarray(0, 16);
    const serverHash = first.body.subarray(16, 48);
    if (!handshake1Hash(localSeed, remoteSeed, authHash).equals(serverHash)) {
      throw new Error(
        `KLAP credentials rejected by ${this.host}: the device's challenge did not match. ` +
          `Check the TP-Link e-mail and password (both case-sensitive). If they are right, ` +
          `the device is throttling after too many handshakes - wait a few seconds.`,
      );
    }
    this.cookie = first.cookie;

    const second = await post(
      this.host,
      this.port,
      "/app/handshake2",
      handshake2Hash(localSeed, remoteSeed, authHash),
      HANDSHAKE_TIMEOUT_MS,
      this.cookie,
    );
    if (second.status !== 200) {
      throw new Error(`KLAP handshake2 returned ${second.status} (${this.host})`);
    }
    this.session = new KlapSession(localSeed, remoteSeed, authHash);
  }

  /** Sends one Tapo method, handshaking first if needed. Returns `result`. */
  async invoke(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.session === null) {
      await this.handshake();
    }
    const session = this.session;
    if (session === null) {
      throw new Error(`KLAP session unavailable (${this.host})`);
    }

    const body: Record<string, unknown> = {
      method,
      request_time_milis: Date.now(),
      terminal_uuid: this.terminalUuid,
    };
    if (params) {
      body["params"] = params;
    }

    const { payload, seq } = session.encrypt(JSON.stringify(body));
    const reply = await post(
      this.host,
      this.port,
      `/app/request?seq=${seq}`,
      payload,
      REQUEST_TIMEOUT_MS,
      this.cookie,
    );
    if (reply.status !== 200) {
      // 403 usually means the session expired; drop it so the next call
      // handshakes again instead of replaying a dead sequence.
      this.reset();
      throw new Error(`KLAP request ${method} returned ${reply.status} (${this.host})`);
    }

    const parsed: unknown = JSON.parse(session.decrypt(reply.body, seq));
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`KLAP ${method} response was not an object`);
    }
    const record = parsed as { error_code?: number; result?: unknown };
    if (typeof record.error_code === "number" && record.error_code !== 0) {
      throw new Error(`KLAP ${method} failed with error_code ${record.error_code}`);
    }
    return (record.result as Record<string, unknown> | undefined) ?? {};
  }

  async getDeviceInfo(): Promise<Record<string, unknown>> {
    return await this.invoke("get_device_info");
  }

  async setPower(on: boolean): Promise<void> {
    await this.invoke("set_device_info", { device_on: on });
  }
}

/**
 * KLAP needs a TP-Link account. `PlugDevice` is a frozen contract with only an
 * address, and a settings blob is the wrong home for a password, so the
 * credentials come from the environment.
 */
export function klapCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): KlapCredentials | null {
  const username = (
    env["FOCUSPLUG_TAPO_USERNAME"] ??
    env["TAPO_EMAIL"] ??
    env["KASA_USERNAME"] ??
    ""
  ).trim();
  const password = (
    env["FOCUSPLUG_TAPO_PASSWORD"] ??
    env["TAPO_PASSWORD"] ??
    env["KASA_PASSWORD"] ??
    ""
  ).trim();
  if (username.length === 0 || password.length === 0) {
    return null;
  }
  return { username, password };
}

/** Minimum gap between fresh handshakes to one host. Reused sessions are exempt. */
export const HANDSHAKE_COOLDOWN_MS = 1000;

interface PooledHost {
  client: KlapClient;
  queue: Promise<unknown>;
  lastHandshakeAt: number;
}

/**
 * One live connection per host, commands serialized.
 *
 * Rapid on/off (or a retry loop) that re-handshakes every time trips the
 * device's local-auth throttle, which then answers with the same "challenge did
 * not match" error as a wrong password until it cools down. Holding the session
 * open makes steady-state switching a single encrypted request.
 */
export class KlapPool {
  private readonly hosts = new Map<string, PooledHost>();

  constructor(
    private readonly credentials: KlapCredentials,
    private readonly port: number = KLAP_PORT,
    private readonly now: () => number = Date.now,
  ) {}

  private pooled(host: string): PooledHost {
    const key = `${host}|${this.credentials.username}`;
    let entry = this.hosts.get(key);
    if (entry === undefined) {
      entry = {
        client: new KlapClient(host, this.credentials, this.port),
        queue: Promise.resolve(),
        lastHandshakeAt: 0,
      };
      this.hosts.set(key, entry);
    }
    return entry;
  }

  /** Runs `task` with exclusive access to this host's connection. */
  private run<T>(host: string, task: (client: KlapClient) => Promise<T>): Promise<T> {
    const entry = this.pooled(host);
    const next = entry.queue.then(async () => {
      if (!entry.client.connected) {
        const since = this.now() - entry.lastHandshakeAt;
        if (since < HANDSHAKE_COOLDOWN_MS) {
          await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_COOLDOWN_MS - since));
        }
        entry.lastHandshakeAt = this.now();
      }
      try {
        return await task(entry.client);
      } catch (error) {
        // Force a fresh handshake next time rather than reusing a dead session.
        entry.client.reset();
        throw error;
      }
    });
    entry.queue = next.catch(() => undefined);
    return next;
  }

  async setPower(host: string, on: boolean): Promise<boolean> {
    return await this.run(host, async (client) => {
      await client.setPower(on);
      const info = await client.getDeviceInfo();
      return typeof info["device_on"] === "boolean" ? (info["device_on"] as boolean) : on;
    });
  }

  async query(host: string): Promise<boolean | null> {
    return await this.run(host, async (client) => {
      const info = await client.getDeviceInfo();
      return typeof info["device_on"] === "boolean" ? (info["device_on"] as boolean) : null;
    });
  }
}
