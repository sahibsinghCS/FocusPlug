import { describe, expect, it } from "vitest";
import { createFlightLoop, type FlightLoop } from "./loop";

interface Harness {
  loop: FlightLoop;
  paints: () => number;
  pending: () => number;
  /** Fire every pending rAF callback once (one display frame). */
  step: () => void;
  setStatic: (value: boolean) => void;
}

function makeHarness(initiallyStatic: boolean): Harness {
  let paints = 0;
  let isStatic = initiallyStatic;
  let nextHandle = 1;
  const queue = new Map<number, () => void>();

  const loop = createFlightLoop({
    paint: () => {
      paints += 1;
    },
    isStatic: () => isStatic,
    request: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      queue.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      queue.delete(handle);
    },
  });

  return {
    loop,
    paints: () => paints,
    pending: () => queue.size,
    step: () => {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) {
        callback();
      }
    },
    setStatic: (value) => {
      isStatic = value;
    },
  };
}

describe("flight animation loop", () => {
  it("paints a single frame and parks while the clock is paused", () => {
    const h = makeHarness(true);
    h.loop.kick();
    expect(h.paints()).toBe(1);
    expect(h.pending()).toBe(0);
  });

  it("restarts after a paused clock unpauses (idle/countdown -> focus)", () => {
    const h = makeHarness(true);
    h.loop.kick();
    expect(h.pending()).toBe(0);

    h.setStatic(false);
    h.loop.kick();
    expect(h.paints()).toBe(2);
    expect(h.pending()).toBe(1);
    h.step();
    h.step();
    expect(h.paints()).toBe(4);
    expect(h.pending()).toBe(1);
  });

  it("never stacks a second chain (fonts.ready / visibilitychange kicks are no-ops)", () => {
    const h = makeHarness(false);
    h.loop.kick();
    h.loop.kick(); // fonts.ready resolving after mount
    h.loop.kick(); // hide/show cycle
    expect(h.paints()).toBe(1);
    expect(h.pending()).toBe(1);
    h.step();
    expect(h.paints()).toBe(2);
    expect(h.pending()).toBe(1);
  });

  it("suspend cancels the pending frame and a kick resumes", () => {
    const h = makeHarness(false);
    h.loop.kick();
    h.loop.suspend();
    expect(h.pending()).toBe(0);
    h.step();
    expect(h.paints()).toBe(1);

    h.loop.kick();
    expect(h.paints()).toBe(2);
    expect(h.pending()).toBe(1);
  });

  it("stop is final: no paint from pending frames or later kicks", () => {
    const h = makeHarness(false);
    h.loop.kick();
    h.loop.stop();
    h.step();
    h.loop.kick();
    expect(h.paints()).toBe(1);
    expect(h.pending()).toBe(0);
  });
});
