import { describe, expect, it } from "vitest";
import { parseRoute, routeHash, ROUTES } from "./routes";

describe("routes", () => {
  it("keeps every product route", () => {
    expect(ROUTES.map((route) => route.id)).toEqual([
      "session",
      "allowlist",
      "blocklist",
      "plugs",
      "settings",
      "log",
    ]);
  });

  it("parses hashes including query scenes", () => {
    expect(parseRoute("")).toBe("session");
    expect(parseRoute("#/")).toBe("session");
    expect(parseRoute("#/plugs")).toBe("plugs");
    expect(parseRoute("#/settings?scene=live")).toBe("settings");
    expect(parseRoute("#/log")).toBe("log");
    expect(routeHash("allowlist")).toBe("#/allowlist");
    expect(routeHash("session")).toBe("#/");
  });
});
