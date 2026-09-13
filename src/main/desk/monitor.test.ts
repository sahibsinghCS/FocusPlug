import type { DeskSnapshot } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StubDeskModel } from "./model/stub";
import { DeskMonitor } from "./monitor";
import type { FrameSource, RgbFrame } from "./types";

const modelState = vi.hoisted(() => ({ failures: 0, allow: false }));

vi.mock("./model/factory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./model/factory")>();
  const { StubDeskModel: Stub } = await import("./model/stub");
  return {
    ...actual,
    getSharedDeskModel: async () => {
      if (!modelState.allow) {
        modelState.failures += 1;
        throw new Error("model init failed");
      }
      return new Stub();
    },
  };
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timeout");
    }
    await delay(5);
  }
}

/** Null-frame source that counts grabs — proves the loop reached step(). */
class CountingNullSource implements FrameSource {
  grabs = 0;
  async start(): Promise<void> {
    return;
  }
  async stop(): Promise<void> {
    return;
  }
  async grab(): Promise<RgbFrame | null> {
    this.grabs += 1;
    return null;
  }
}

/** Source whose start() stays pending until the test releases it. */
class WarmUpSource implements FrameSource {
  running = false;
  starts = 0;
  stops = 0;
  private resolvers: Array<() => void> = [];

  start(): Promise<void> {
    this.starts += 1;
    return new Promise((resolve) => {
      this.resolvers.push(() => {
        this.running = true;
        resolve();
      });
    });
  }

  releaseStart(): void {
    this.resolvers.shift()?.();
  }

  async stop(): Promise<void> {
    this.stops += 1;
    this.running = false;
  }

  async grab(): Promise<RgbFrame | null> {
    return null;
  }
}

describe("DeskMonitor robustness", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    modelState.failures = 0;
    modelState.allow = false;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      return;
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("loop survives model init failure, emits uncertain snapshots, and recovers", async () => {
    const source = new CountingNullSource();
    const snaps: DeskSnapshot[] = [];
    const monitor = new DeskMonitor({ source, intervalMs: 5, enabled: true });
    monitor.start((snap) => snaps.push(snap));

    // The loop must keep retrying (not die on the first rejection) and keep
    // reporting a safe uncertain snapshot while the model is unavailable.
    await waitFor(() => modelState.failures >= 2 && snaps.length >= 2);
    expect(snaps.every((snap) => snap.label === "uncertain")).toBe(true);
    expect(source.grabs).toBe(0);

    // Once the model loads, the same loop resumes normal capture cycles.
    modelState.allow = true;
    await waitFor(() => source.grabs >= 2);
    monitor.stop();
  });

  it("stop() during camera warm-up shuts the camera back down", async () => {
    const source = new WarmUpSource();
    const monitor = new DeskMonitor({
      source,
      model: new StubDeskModel(),
      intervalMs: 5,
    });
    monitor.start(() => {
      return;
    });
    await waitFor(() => source.starts >= 1);
    monitor.stop();
    source.releaseStart();
    await waitFor(() => source.stops >= 1);
    expect(source.running).toBe(false);
  });

  it("setEnabled(false) during camera warm-up shuts the camera back down", async () => {
    const source = new WarmUpSource();
    const monitor = new DeskMonitor({
      source,
      model: new StubDeskModel(),
      intervalMs: 5,
      enabled: false,
    });
    monitor.start(() => {
      return;
    });
    await delay(15);
    monitor.setEnabled(true);
    await waitFor(() => source.starts >= 1);
    monitor.setEnabled(false);
    // Both the setEnabled path and the loop may have a warm-up in flight.
    source.releaseStart();
    source.releaseStart();
    await waitFor(() => source.stops >= 1);
    expect(source.running).toBe(false);
    monitor.stop();
  });

  it("setEnabled(true) mid-session leaves camera start to the loop — no second concurrent start", async () => {
    const source = new WarmUpSource();
    const monitor = new DeskMonitor({
      source,
      model: new StubDeskModel(),
      intervalMs: 5,
      enabled: false,
    });
    monitor.start(() => {
      return;
    });
    await delay(15);
    monitor.setEnabled(true);
    await waitFor(() => source.starts >= 1);
    // Give the loop several intervals: ensureReady() is the single owner of
    // source.start(), so the pending warm-up must stay the only start.
    await delay(30);
    expect(source.starts).toBe(1);
    source.releaseStart();
    await waitFor(() => source.running);
    monitor.stop();
    await waitFor(() => source.stops >= 1);
    expect(source.running).toBe(false);
  });

  it("stale warm-up from a stopped session does not kill the restarted session's camera", async () => {
    const source = new WarmUpSource();
    const monitor = new DeskMonitor({
      source,
      model: new StubDeskModel(),
      intervalMs: 5,
    });
    monitor.start(() => {
      return;
    });
    await waitFor(() => source.starts >= 1);
    // Restart while warm-up A is still in flight: the new loop's own start
    // (B) claims the shared source.
    monitor.stop();
    monitor.start(() => {
      return;
    });
    await waitFor(() => source.starts >= 2);
    // A resolves late — it must not stop the source the new session now owns.
    source.releaseStart();
    source.releaseStart();
    await waitFor(() => source.running);
    await delay(30);
    expect(source.stops).toBe(0);
    expect(source.running).toBe(true);
    // The new loop still owns the camera: a normal stop shuts it down.
    monitor.stop();
    await waitFor(() => source.stops >= 1);
    expect(source.running).toBe(false);
  });
});
