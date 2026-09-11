export const SIDEBAR_STORAGE_KEY = "focusplug.shell.sidebarCollapsed";
export const SIDEBAR_AUTO_RAIL_MAX = 1080;

export function readCollapsedPref(raw: string | null): boolean | null {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

export function writeCollapsedPref(collapsed: boolean): string {
  return collapsed ? "1" : "0";
}

export function resolveSidebarCollapsed(
  pref: boolean | null,
  viewportWidth: number,
): boolean {
  if (typeof viewportWidth !== "number" || !Number.isFinite(viewportWidth)) {
    throw new Error("viewportWidth must be a finite number");
  }
  if (pref !== null) {
    return pref;
  }
  return viewportWidth < SIDEBAR_AUTO_RAIL_MAX;
}

export function loadCollapsedPref(): boolean | null {
  try {
    return readCollapsedPref(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistCollapsedPref(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, writeCollapsedPref(collapsed));
  } catch {
    // Private mode — in-memory pref still works for the session.
  }
}
