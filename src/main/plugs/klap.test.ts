import { describe, expect, it } from "vitest";
import {
  deriveKlapKeys,
  handshake1Hash,
  handshake2Hash,
  klapAuthHash,
  KlapSession,
} from "./klap.ts";

/**
 * Golden vectors emitted by python-kasa 0.10.2 itself — `KlapTransportV2` and
 * `KlapEncryptionSession` in `kasa/transports/klaptransport.py` — for fixed
 * seeds and credentials. The real plug is the only other authority on this
 * protocol, so pinning to the reference implementation is what keeps this
 * honest: if a derivation drifts, these fail rather than the demo.
 *
 * Regenerate (any machine with python-kasa) by feeding the same localSeed /
 * remoteSeed / credentials through KlapEncryptionSession and printing hex.
 */
const VECTORS = {
  username: "user@example.com",
  password: "hunter2",
  localSeed: "000102030405060708090a0b0c0d0e0f",
  remoteSeed: "6465666768696a6b6c6d6e6f70717273",
  message: '{"method":"get_device_info","request_time_milis":1757640000000}',
  authHash: "b49b2da16ee8155335c944a908c08fb4d18ea952ca0f73b60c8f77d08642e781",
  handshake1: "43ff64eb87a27f64e7826e2da62d8e4128f563eabb8d89a0124cc3a7e91e0033",
  handshake2: "3d76e8cb8cd0907fbdf4db079fd61d67d950c3e078e1a8ce1728d1f2de8edfa4",
  key: "8b24cb0a15ec9633eafb277393323104",
  iv: "1cec49a5fba3b5dfe7678b24",
  initialSeq: 564099527,
  sig: "cbd99877b71500ef7a0415f97ae4286e2c366c53e3d08dda559efd8a",
  encryptedSeq: 564099528,
  encrypted:
    "f596c3ca15e826c8d1066813ba8c8de71be73c5754af196b79b1a38c1ddc32bad63d788cb3aa0dd5500de45fe925fa7c7554eb3a2e31bc5473ea2628200a5bd84bff5e3fde797e6a3ced816e881101b88eb7c883abc1d6efcac7dff38c410743",
} as const;

const local = Buffer.from(VECTORS.localSeed, "hex");
const remote = Buffer.from(VECTORS.remoteSeed, "hex");
const authHash = klapAuthHash(VECTORS.username, VECTORS.password);

describe("KLAP v2 against python-kasa vectors", () => {
  it("derives the auth hash", () => {
    expect(authHash.toString("hex")).toBe(VECTORS.authHash);
  });

  it("derives both handshake hashes, which are not symmetric", () => {
    expect(handshake1Hash(local, remote, authHash).toString("hex")).toBe(VECTORS.handshake1);
    expect(handshake2Hash(local, remote, authHash).toString("hex")).toBe(VECTORS.handshake2);
    expect(VECTORS.handshake1).not.toBe(VECTORS.handshake2);
  });

  it("derives the session key, iv, starting sequence and signature", () => {
    const keys = deriveKlapKeys(local, remote, authHash);
    expect(keys.key.toString("hex")).toBe(VECTORS.key);
    expect(keys.iv.toString("hex")).toBe(VECTORS.iv);
    expect(keys.seq).toBe(VECTORS.initialSeq);
    expect(keys.sig.toString("hex")).toBe(VECTORS.sig);
  });

  it("produces a byte-identical encrypted request", () => {
    const session = new KlapSession(local, remote, authHash);
    const { payload, seq } = session.encrypt(VECTORS.message);
    expect(seq).toBe(VECTORS.encryptedSeq);
    expect(payload.toString("hex")).toBe(VECTORS.encrypted);
  });

  it("round-trips its own ciphertext", () => {
    const session = new KlapSession(local, remote, authHash);
    const { payload, seq } = session.encrypt(VECTORS.message);
    expect(session.decrypt(payload, seq)).toBe(VECTORS.message);
  });

  it("advances the sequence number per request", () => {
    const session = new KlapSession(local, remote, authHash);
    const first = session.encrypt("{}");
    const second = session.encrypt("{}");
    expect(second.seq).toBe(first.seq + 1);
    expect(second.payload.toString("hex")).not.toBe(first.payload.toString("hex"));
  });

  it("rejects a wrong password with a different auth hash", () => {
    expect(klapAuthHash(VECTORS.username, "wrong").toString("hex")).not.toBe(VECTORS.authHash);
  });
});
