import { describe, expect, it } from "vitest";
import {
  readCollapsedPref,
  resolveSidebarCollapsed,
  SIDEBAR_AUTO_RAIL_MAX,
  writeCollapsedPref,
} from "./shellPref";

describe("shellPref", () => {
  it("parses persisted collapse flags", () => {
    expect(readCollapsedPref(null)).toBeNull();
    expect(readCollapsedPref("1")).toBe(true);
    expect(readCollapsedPref("0")).toBe(false);
    expect(readCollapsedPref("maybe")).toBeNull();
    expect(writeCollapsedPref(true)).toBe("1");
    expect(writeCollapsedPref(false)).toBe("0");
  });

  it("auto-collapses below the rail breakpoint when no pref is set", () => {
    expect(resolveSidebarCollapsed(null, SIDEBAR_AUTO_RAIL_MAX)).toBe(false);
    expect(resolveSidebarCollapsed(null, SIDEBAR_AUTO_RAIL_MAX - 1)).toBe(true);
    expect(resolveSidebarCollapsed(false, 800)).toBe(false);
    expect(resolveSidebarCollapsed(true, 1600)).toBe(true);
  });
});
