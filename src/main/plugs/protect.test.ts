import { describe, expect, it } from "vitest";
import {
  assertControllable,
  hostnameFromAddress,
  inspectControllable,
  isLoopbackHost,
  looksLikeStudyPcName,
  PlugProtectError,
  type ProtectablePlug,
} from "./protect.ts";

function device(patch: Partial<ProtectablePlug> & Pick<ProtectablePlug, "id" | "name">): ProtectablePlug {
  return {
    protocol: "kasa",
    address: "192.168.1.50",
    isStudyPc: false,
    ...patch,
  };
}

describe("plug protect", () => {
  it("refuses devices marked isStudyPc", () => {
    const verdict = inspectControllable(
      device({ id: "pc", name: "Monitor", isStudyPc: true }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/study PC/i);
    }
    expect(() =>
      assertControllable(device({ id: "pc", name: "Monitor", isStudyPc: true })),
    ).toThrow(PlugProtectError);
  });

  it("refuses names like study-pc", () => {
    expect(looksLikeStudyPcName("study-pc")).toBe(true);
    expect(looksLikeStudyPcName("Study_PC")).toBe(true);
    expect(looksLikeStudyPcName("STUDY PC")).toBe(true);
    expect(looksLikeStudyPcName("fun lamp")).toBe(false);
    const verdict = inspectControllable(device({ id: "x", name: "study-pc" }));
    expect(verdict.ok).toBe(false);
  });

  it("refuses empty address", () => {
    const verdict = inspectControllable(device({ id: "x", name: "Lamp", address: "  " }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/empty address/i);
    }
  });

  it("refuses localhost as the study machine", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("192.168.1.50")).toBe(false);
    expect(hostnameFromAddress("http://127.0.0.1/relay")).toBe("127.0.0.1");
    expect(hostnameFromAddress("::1")).toBe("::1");
    const byAddress = inspectControllable(
      device({ id: "x", name: "Local", address: "127.0.0.1" }),
    );
    expect(byAddress.ok).toBe(false);
    if (!byAddress.ok) {
      expect(byAddress.reason).toMatch(/localhost as study machine/i);
    }
  });

  it("allows a LAN fun device", () => {
    expect(inspectControllable(device({ id: "lamp", name: "RGB lamp" })).ok).toBe(true);
  });
});
