import type { FocusPlugApi } from "@shared/ipc";

declare global {
  interface Window {
    focusplug: FocusPlugApi;
  }
}

export {};
