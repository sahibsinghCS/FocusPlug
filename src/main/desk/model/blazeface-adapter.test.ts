import { describe, expect, it, vi } from "vitest";
import { BlazeFaceDeskModel } from "./blazeface-adapter";

const loadState = vi.hoisted(() => ({ failuresRemaining: 1, calls: 0 }));

vi.mock("@tensorflow-models/blazeface", () => ({
  load: async () => {
    loadState.calls += 1;
    if (loadState.failuresRemaining > 0) {
      loadState.failuresRemaining -= 1;
      throw new Error("offline: cannot fetch blazeface weights");
    }
    return { estimateFaces: async () => [] };
  },
}));

describe("BlazeFace init failure", () => {
  it("does not cache a rejected init — a later init retries and succeeds", async () => {
    const first = new BlazeFaceDeskModel();
    await expect(first.init()).rejects.toThrow("offline");
    // A new session's monitor asks again: the shared detector must retry the
    // load instead of replaying the cached rejection until app restart.
    const second = new BlazeFaceDeskModel();
    await expect(second.init()).resolves.toBeUndefined();
    expect(loadState.calls).toBe(2);
  });
});
