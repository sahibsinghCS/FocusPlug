import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_FACE_NOW_MS, startLiveFaceNowClock } from "./useLiveFaceNow";

describe("startLiveFaceNowClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes now on a 250ms cadence, not every animation frame", () => {
    const publish = vi.fn();
    const stop = startLiveFaceNowClock(publish);

    expect(LIVE_FACE_NOW_MS).toBe(250);
    expect(publish).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(publish).not.toHaveBeenCalled();

    vi.advanceTimersByTime(233);
    expect(publish).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toBeInstanceOf(Date);

    vi.advanceTimersByTime(LIVE_FACE_NOW_MS);
    expect(publish).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(1_000);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing publisher or a non-positive interval", () => {
    expect(() => startLiveFaceNowClock(undefined as unknown as (now: Date) => void)).toThrow(
      /publish function/,
    );
    expect(() => startLiveFaceNowClock(() => undefined, 0)).toThrow(/positive finite/);
    expect(() => startLiveFaceNowClock(() => undefined, Number.NaN)).toThrow(/positive finite/);
  });
});
