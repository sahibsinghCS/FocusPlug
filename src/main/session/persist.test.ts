import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import { createFocusPlugStore } from "../store/persist.ts";

describe("FocusPlugStore settings + session log", () => {
  it("seeds defaults and round-trips settings and log events", () => {
    const dir = mkdtempSync(join(process.cwd(), ".tmp-store-"));
    const first = createFocusPlugStore(dir);
    expect(first.loadSettings()).toEqual(DEFAULT_SETTINGS);

    first.saveSettings({
      countdownSec: 7,
      deskThreshold: 0.8,
      strictMode: false,
      webcamEnabled: false,
    });
    first.appendSessionLog({ ts: 10, kind: "session", detail: "Session started" });
    first.appendSessionLog({ ts: 20, kind: "kill", detail: "Demo Kill · discord" });

    const second = createFocusPlugStore(dir);
    expect(second.loadSettings()).toEqual({
      countdownSec: 7,
      deskThreshold: 0.8,
      strictMode: false,
      webcamEnabled: false,
    });
    const log = second.loadSessionLog();
    expect(log[0]?.kind).toBe("kill");
    expect(log[1]?.kind).toBe("session");
    expect(log[0]?.detail).toContain("Demo Kill");
  });

  it("rejects invalid settings", () => {
    const dir = mkdtempSync(join(process.cwd(), ".tmp-store-"));
    const store = createFocusPlugStore(dir);
    expect(() =>
      store.saveSettings({
        countdownSec: Number.NaN,
        deskThreshold: 0.5,
        strictMode: true,
        webcamEnabled: true,
      }),
    ).toThrow(/settings/);
  });
});
