import type { FocusPlugApi } from "@shared/ipc";
import { getMockApi } from "./mockApi";

export interface ApiHandle {
  api: FocusPlugApi;
  usingMock: boolean;
}

export function getApi(): ApiHandle {
  const injected = Reflect.get(window, "focusplug") as FocusPlugApi | undefined;
  if (injected && typeof injected.sessionGetState === "function") {
    return { api: injected, usingMock: false };
  }
  return { api: getMockApi(), usingMock: true };
}
