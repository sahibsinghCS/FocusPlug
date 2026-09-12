import { describe, expect, it } from "vitest";
import type { PlugView } from "../../lib/plugsUi";
import { overlayConsequenceLines } from "./consequence";

const lamp: PlugView = {
  id: "lamp",
  name: "Desk lamp",
  protocol: "mock",
  address: "mock://lamp",
  enabled: true,
  isStudyPc: false,
  online: true,
  powerOn: true,
  probed: true,
};

describe("kill overlay consequence", () => {
  it("names the armed plugs it is about to cut", () => {
    const armed = overlayConsequenceLines([lamp]);
    expect(armed.apps).toBe("Blocked apps will be force-quit");
    expect(armed.plugs).toContain("Desk lamp");
  });

  it("still promises the app kill when no plug is armed, and never the study PC", () => {
    const none = overlayConsequenceLines([]);
    expect(none.apps).toBe("Blocked apps will be force-quit");
    expect(none.plugs).toMatch(/No plugs armed/);
    expect(none.plugs).toMatch(/study PC is never cut/);
  });

  it("ignores plugs that are switched off in settings", () => {
    expect(overlayConsequenceLines([{ ...lamp, enabled: false }]).plugs).toMatch(/No plugs armed/);
  });
});
