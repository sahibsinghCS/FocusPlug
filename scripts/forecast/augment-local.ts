import {
  deriveSeed,
  gaussian,
  mulberry32,
  type RawDeskEvent,
  type RawFocusEvent,
  type RawSession,
} from "./lib";

/**
 * Offline fallback augmentation — the path that runs when the Adaption Labs
 * API is unreachable (today's real state: the key 403s) and, at a lower rate,
 * in the fully offline default build. Three seeded transforms on RAW session
 * streams, so every augmented row still travels through the shared ring +
 * extractor + labeler exactly like a simulated one:
 *
 * 1. time-warp — uniformly stretch/compress the whole session (0.9–1.12×);
 * 2. jitter    — Gaussian noise on desk confidence, retitled windows (new
 *                title hashes, same churn structure), small event-time noise;
 * 3. remix     — splice the first half of one session onto the second half
 *                of another session of the SAME archetype (mixup-style
 *                recombination at a whole-second boundary).
 *
 * Augmented sessions are TRAIN-ONLY by construction — the builder never lets
 * an `augmented:*` source into the eval split, so held-out metrics cannot be
 * inflated by generated data.
 */

export interface AugmentConfig {
  /** Extra sessions to synthesize, as a fraction of the train sessions. */
  fraction: number;
  seed: number;
}

function warpSession(session: RawSession, factor: number, id: string): RawSession {
  return {
    ...session,
    id,
    source: "augmented:local",
    durationSec: Math.max(60, Math.round(session.durationSec * factor)),
    focus: session.focus.map((event) => ({ ...event, ts: Math.round(event.ts * factor) })),
    desk: session.desk.map((event) => ({ ...event, ts: Math.round(event.ts * factor) })),
  };
}

function jitterSession(session: RawSession, rand: () => number, id: string): RawSession {
  const retitle = `~${Math.floor(rand() * 1e6)}`;
  const focus: RawFocusEvent[] = session.focus.map((event) => ({
    ...event,
    ts: Math.max(0, Math.round(event.ts + gaussian(rand) * 120)),
    title: `${event.title}${retitle}`,
  }));
  focus.sort((a, b) => a.ts - b.ts);
  const desk: RawDeskEvent[] = session.desk.map((event) => ({
    ...event,
    conf: event.on
      ? Math.round(Math.min(0.99, Math.max(0.01, event.conf + gaussian(rand) * 0.03)) * 1000) / 1000
      : event.conf,
  }));
  return { ...session, id, source: "augmented:local", focus, desk };
}

function remixSessions(a: RawSession, b: RawSession, rand: () => number, id: string): RawSession {
  // Cut both at a whole-second boundary in the middle third and splice.
  const cutA = Math.round(a.durationSec * (0.35 + rand() * 0.3));
  const cutB = Math.round(b.durationSec * (0.35 + rand() * 0.3));
  const offset = (cutA - cutB) * 1000;
  const focus = [
    ...a.focus.filter((event) => event.ts < cutA * 1000),
    ...b.focus
      .filter((event) => event.ts >= cutB * 1000)
      .map((event) => ({ ...event, ts: event.ts + offset })),
  ];
  const desk = [
    ...a.desk.filter((event) => event.ts < cutA * 1000),
    ...b.desk
      .filter((event) => event.ts >= cutB * 1000)
      .map((event) => ({ ...event, ts: event.ts + offset })),
  ];
  return {
    v: 1,
    id,
    archetype: a.archetype,
    source: "augmented:local",
    seed: a.seed ^ b.seed,
    durationSec: cutA + (b.durationSec - cutB),
    focus,
    desk,
  };
}

/**
 * Produces `round(trainSessions.length * fraction)` augmented sessions,
 * cycling jitter → time-warp → remix. Deterministic under `seed`.
 */
export function augmentLocal(
  trainSessions: readonly RawSession[],
  config: AugmentConfig,
): RawSession[] {
  const out: RawSession[] = [];
  const total = Math.round(trainSessions.length * config.fraction);
  if (total <= 0 || trainSessions.length === 0) {
    return out;
  }
  const byArchetype = new Map<string, RawSession[]>();
  for (const session of trainSessions) {
    const group = byArchetype.get(session.archetype) ?? [];
    group.push(session);
    byArchetype.set(session.archetype, group);
  }
  for (let i = 0; i < total; i += 1) {
    const rand = mulberry32(deriveSeed(config.seed, `augment:${i}`));
    const source = trainSessions[Math.floor(rand() * trainSessions.length)] as RawSession;
    const id = `aug-${String(i).padStart(6, "0")}`;
    const op = i % 3;
    if (op === 0) {
      out.push(jitterSession(source, rand, id));
    } else if (op === 1) {
      out.push(warpSession(source, 0.9 + rand() * 0.22, id));
    } else {
      const peers = byArchetype.get(source.archetype) ?? [source];
      const partner =
        peers.length > 1
          ? (peers.filter((peer) => peer.id !== source.id)[
              Math.floor(rand() * (peers.length - 1))
            ] as RawSession)
          : source;
      out.push(remixSessions(source, partner, rand, id));
    }
  }
  return out;
}
