import { describe, expect, it } from "vitest";
import { runGoldenPathGauntlet } from "./gauntlet.ts";

describe("session-wiring golden path gauntlet", () => {
  it("Docs → Discord → countdown → kill → return → unlock + Demo Kill", async () => {
    const report = await runGoldenPathGauntlet({ writeEvidence: true });
    const failed = report.assertions.filter((item) => !item.pass);
    expect(report.verdict, failed.map((item) => `${item.name}: ${item.detail}`).join("\n")).toBe(
      "PASS",
    );
    expect(failed).toEqual([]);
  });
});
