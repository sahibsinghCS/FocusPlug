import { describe, expect, it } from "vitest";
import { CORRECTION_RING_SPACING_MS } from "@shared/correction/constants";
import type { DeskFrame, DeskModel, DeskModelOutput } from "@shared/types";
import { DeskMonitor } from "./monitor";
import type { FrameSource, RgbFrame } from "./types";

class CountingSource implements FrameSource {
  started = false;
  grabs = 0;

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async grab(): Promise<RgbFrame | null> {
    this.grabs += 1;
    const value = this.grabs % 251;
    return { width: 1, height: 1, data: new Uint8Array([value, value, value]) };
  }
}

class PhoneModel implements DeskModel {
  readonly id = "custom";

  async init(): Promise<void> {
    return;
  }

  async infer(_frame: DeskFrame): Promise<DeskModelOutput> {
    return {
      label: "at_desk",
      confidence: 0.95,
      attention: { label: "phone", confidence: 0.94 },
    };
  }
}

function makeMonitor(options: { capture: boolean; clock: { ms: number } }): {
  monitor: DeskMonitor;
  source: CountingSource;
} {
  const source = new CountingSource();
  const monitor = new DeskMonitor({
    source,
    model: new PhoneModel(),
    intervalMs: 0,
    modelId: "custom",
    now: () => options.clock.ms,
    correctionCapture: options.capture,
  });
  return { monitor, source };
}

describe("DeskMonitor frame ring", () => {
  it("retains nothing when correction capture is off — the default install", async () => {
    const clock = { ms: 0 };
    const { monitor } = makeMonitor({ capture: false, clock });
    for (let i = 0; i < 4; i += 1) {
      clock.ms += CORRECTION_RING_SPACING_MS;
      await monitor.step();
    }
    expect(monitor.peekFrames(0)).toEqual([]);
  });

  it("retains spaced frames with the model's own call on each", async () => {
    const clock = { ms: 0 };
    const { monitor } = makeMonitor({ capture: true, clock });
    for (let i = 0; i < 3; i += 1) {
      clock.ms += CORRECTION_RING_SPACING_MS;
      await monitor.step();
      // The reading in between is 250 ms later: the same photograph.
      clock.ms += 250;
      await monitor.step();
    }
    const held = monitor.peekFrames(0);
    expect(held).toHaveLength(3);
    expect(held.map((entry) => entry.snapshot.attention?.label)).toEqual([
      "phone",
      "phone",
      "phone",
    ]);
    expect(held[0]?.frame.data).toBeInstanceOf(Uint8Array);
  });

  it("opens no second camera: peekFrames issues no grab", async () => {
    const clock = { ms: 0 };
    const { monitor, source } = makeMonitor({ capture: true, clock });
    clock.ms += CORRECTION_RING_SPACING_MS;
    await monitor.step();
    const before = source.grabs;
    monitor.peekFrames(0);
    monitor.peekFrames(0);
    expect(source.grabs).toBe(before);
  });

  it("drops everything on stop, on webcam off, and on a model swap", async () => {
    const clock = { ms: 0 };
    const { monitor } = makeMonitor({ capture: true, clock });
    const fill = async (): Promise<void> => {
      for (let i = 0; i < 2; i += 1) {
        clock.ms += CORRECTION_RING_SPACING_MS;
        await monitor.step();
      }
    };

    await fill();
    expect(monitor.peekFrames(0).length).toBeGreaterThan(0);
    monitor.stop();
    expect(monitor.peekFrames(0)).toEqual([]);

    await fill();
    expect(monitor.peekFrames(0).length).toBeGreaterThan(0);
    monitor.setEnabled(false);
    expect(monitor.peekFrames(0)).toEqual([]);

    monitor.setEnabled(true);
    await fill();
    expect(monitor.peekFrames(0).length).toBeGreaterThan(0);
    // A no-op swap changes nothing, including the ring.
    monitor.setModelId("custom");
    expect(monitor.peekFrames(0).length).toBeGreaterThan(0);
    // A real swap drops them: the retained frames carry the OLD model's call.
    monitor.setModelId("blazeface");
    expect(monitor.peekFrames(0)).toEqual([]);
  });

  it("setCorrectionCapture(false) frees the held frames, not just the switch", async () => {
    const clock = { ms: 0 };
    const { monitor } = makeMonitor({ capture: true, clock });
    clock.ms += CORRECTION_RING_SPACING_MS;
    await monitor.step();
    expect(monitor.peekFrames(0)).toHaveLength(1);

    monitor.setCorrectionCapture(false);
    expect(monitor.peekFrames(0)).toEqual([]);

    // Switching it back on starts empty rather than resurrecting anything.
    monitor.setCorrectionCapture(true);
    expect(monitor.peekFrames(0)).toEqual([]);
    clock.ms += CORRECTION_RING_SPACING_MS;
    await monitor.step();
    expect(monitor.peekFrames(0)).toHaveLength(1);
  });

  it("keeps reading when the camera hands back nothing", async () => {
    const clock = { ms: 0 };
    const source = new CountingSource();
    source.grab = async (): Promise<RgbFrame | null> => null;
    const monitor = new DeskMonitor({
      source,
      model: new PhoneModel(),
      intervalMs: 0,
      now: () => clock.ms,
      correctionCapture: true,
    });
    clock.ms += CORRECTION_RING_SPACING_MS;
    const snap = await monitor.step();
    expect(snap.label).toBe("uncertain");
    expect(monitor.peekFrames(0)).toEqual([]);
  });
});
