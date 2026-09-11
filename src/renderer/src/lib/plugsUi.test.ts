import { describe, expect, it } from "vitest";
import type { PlugDevice } from "@shared/ipc";
import {
  DESK_MODEL_IDS,
  STUDY_PC_WARNING,
  enabledPlugDevices,
  looksLikeStudyPc,
  mergePlugViews,
  plugKillNote,
  summarizePlugs,
} from "./plugsUi";

const lamp: PlugDevice = {
  id: "lamp",
  name: "Desk lamp",
  protocol: "mock",
  address: "mock://lamp",
  enabled: true,
  isStudyPc: false,
};

const fan: PlugDevice = {
  id: "fan",
  name: "Fan",
  protocol: "kasa",
  address: "192.168.1.40",
  enabled: false,
  isStudyPc: false,
};

describe("plugsUi", () => {
  it("keeps the study-PC warning copy frozen", () => {
    expect(STUDY_PC_WARNING).toBe("Secondary fun devices only. Never the study PC.");
    expect(looksLikeStudyPc("Study PC")).toBe(true);
    expect(looksLikeStudyPc("study-pc")).toBe(true);
    expect(looksLikeStudyPc("Desk lamp")).toBe(false);
  });

  it("exposes the frozen desk model ids", () => {
    expect([...DESK_MODEL_IDS]).toEqual(["stub", "blazeface", "custom"]);
  });

  it("summarizes armed plugs from devices + snapshots", () => {
    const views = mergePlugViews([lamp, fan], {
      lamp: { ts: 1, deviceId: "lamp", online: true, powerOn: true },
    });
    expect(enabledPlugDevices([lamp, fan]).map((plug) => plug.id)).toEqual(["lamp"]);
    expect(summarizePlugs(views)).toBe("1 armed, 1 on");
    expect(plugKillNote(views)).toBe("Kill overlay cuts 1 enabled plug (Desk lamp)");
  });
});
