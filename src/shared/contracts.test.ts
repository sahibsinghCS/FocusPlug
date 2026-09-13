import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import { DEFAULT_FACE_ID, FACE_IDS, isFaceId, normalizeFaceId } from "./faces";
import { DEFAULT_FLIGHT_ARR, DEFAULT_FLIGHT_DEP } from "./flightRoute";
import {
  IPC_INVOKE,
  IPC_PUSH,
  PLUG_DRIVER_NOT_IMPLEMENTED,
  type DeskModelFactory,
  type PlugController,
} from "./ipc";
import type { DeskFrame, DeskModel, PolicyEvent } from "./types";

function assertNever(value: never): never {
  throw new Error(`unhandled PolicyEvent: ${JSON.stringify(value)}`);
}

/** Compile-time + runtime proof that PolicyEvent stays exhaustively matchable. */
function describePolicyEvent(event: PolicyEvent): string {
  switch (event.type) {
    case "start_countdown":
      return `start_countdown:${event.reason}:${event.seconds}`;
    case "cancel_countdown":
      return "cancel_countdown";
    case "kill":
      return `kill:${event.targets.join(",")}:${event.reason}`;
    case "unlock":
      return "unlock";
    case "status":
      return `status:${event.decision}:${event.detail}`;
    case "plug_off":
      return `plug_off:${event.deviceIds.join(",")}:${event.reason}`;
    case "plug_on":
      return `plug_on:${event.deviceIds.join(",")}:${event.reason}`;
    default:
      return assertNever(event);
  }
}

describe("Phase 2 contracts", () => {
  it("keeps PolicyEvent exhaustively matchable including plug_off/plug_on", () => {
    const events: PolicyEvent[] = [
      { type: "start_countdown", reason: "blocked", seconds: 10 },
      { type: "cancel_countdown" },
      { type: "kill", targets: ["discord.exe"], reason: "blocked" },
      { type: "unlock" },
      { type: "status", decision: "ON_TASK", detail: "ok" },
      { type: "plug_off", deviceIds: ["lamp"], reason: "away" },
      { type: "plug_on", deviceIds: ["lamp"], reason: "unlock" },
    ];
    expect(events.map(describePolicyEvent)).toEqual([
      "start_countdown:blocked:10",
      "cancel_countdown",
      "kill:discord.exe:blocked",
      "unlock",
      "status:ON_TASK:ok",
      "plug_off:lamp:away",
      "plug_on:lamp:unlock",
    ]);
  });

  it("freezes plug and desk-model IPC channel names", () => {
    expect(IPC_INVOKE.PLUGS_LIST).toBe("focusplug:plugs:list");
    expect(IPC_INVOKE.PLUGS_ADD).toBe("focusplug:plugs:add");
    expect(IPC_INVOKE.PLUGS_REMOVE).toBe("focusplug:plugs:remove");
    expect(IPC_INVOKE.PLUGS_TEST).toBe("focusplug:plugs:test");
    expect(IPC_INVOKE.DESK_GET_MODEL_ID).toBe("focusplug:desk:getModelId");
    expect(IPC_INVOKE.DESK_SET_MODEL_ID).toBe("focusplug:desk:setModelId");
    expect(PLUG_DRIVER_NOT_IMPLEMENTED).toBe("plug driver not implemented");
  });

  it("defaults deskModelId to blazeface and plugs to empty", () => {
    expect(DEFAULT_SETTINGS.deskModelId).toBe("blazeface");
    expect(DEFAULT_SETTINGS.plugs).toEqual([]);
  });

  it("freezes Focus Forecast IPC channel names", () => {
    expect(IPC_INVOKE.FORECAST_GET_STATE).toBe("focusplug:forecast:getState");
    expect(IPC_PUSH.FORECAST_SNAPSHOT).toBe("focusplug:forecast:snapshot");
    expect(IPC_PUSH.FORECAST_EVENT).toBe("focusplug:forecast:event");
  });

  it("defaults the five flat Focus Forecast settings keys", () => {
    expect(DEFAULT_SETTINGS.forecastEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.forecastPrearmEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.forecastNudgeRisk).toBe(0.5);
    expect(DEFAULT_SETTINGS.forecastPrearmRisk).toBe(0.65);
    expect(DEFAULT_SETTINGS.forecastPrearmFuseSec).toBe(5);
  });

  it("defaults faceId to flight once the instrument is ready", () => {
    expect(DEFAULT_SETTINGS.faceId).toBe(DEFAULT_FACE_ID);
    expect(DEFAULT_FACE_ID).toBe("flight");
    expect(isFaceId("hourglass")).toBe(true);
    expect(isFaceId("column")).toBe(false);
    expect(normalizeFaceId("eclipse")).toBe("flight");
    expect(FACE_IDS).toHaveLength(9);
    expect(normalizeFaceId("circuit")).toBe("flight");
    expect(isFaceId("flask")).toBe(true);
    expect(isFaceId("garden")).toBe(true);
    expect(isFaceId("candle")).toBe(true);
    expect(isFaceId("eclipse")).toBe(false);
    expect(isFaceId("field")).toBe(false);
  });

  it("defaults the Flight route to DUB→EDI on the same settings blob", () => {
    expect(DEFAULT_SETTINGS.flightDep).toBe(DEFAULT_FLIGHT_DEP);
    expect(DEFAULT_SETTINGS.flightArr).toBe(DEFAULT_FLIGHT_ARR);
    expect(DEFAULT_FLIGHT_DEP).toBe("DUB");
    expect(DEFAULT_FLIGHT_ARR).toBe("EDI");
  });

  it("accepts existing RGB desk frames on DeskModel.infer", async () => {
    const frame: DeskFrame = { width: 1, height: 1, data: new Uint8Array([1, 2, 3]) };
    const model: DeskModel = {
      id: "stub",
      init: async () => undefined,
      infer: async (input) => {
        expect(input.width).toBe(1);
        expect(input.data.length).toBe(3);
        return { label: "uncertain", confidence: 0 };
      },
    };
    const factory: DeskModelFactory = { create: () => model };
    await factory.create("stub").infer(frame);
  });

  it("types PlugController.off/on/list/discover without a driver", async () => {
    const controller: PlugController = {
      off: async (ids) =>
        ids.map((deviceId) => ({
          ts: 0,
          deviceId,
          online: false,
          powerOn: null,
          error: PLUG_DRIVER_NOT_IMPLEMENTED,
        })),
      on: async (ids) =>
        ids.map((deviceId) => ({
          ts: 0,
          deviceId,
          online: false,
          powerOn: null,
          error: PLUG_DRIVER_NOT_IMPLEMENTED,
        })),
      list: async () => [],
      discover: async () => [],
    };
    expect(await controller.list()).toEqual([]);
    expect((await controller.off(["lamp"]))[0]?.error).toBe(PLUG_DRIVER_NOT_IMPLEMENTED);
  });
});
