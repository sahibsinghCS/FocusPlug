export const ROUTE_IDS = ["session", "allowlist", "blocklist", "plugs", "settings", "log"] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

export interface RouteDef {
  id: RouteId;
  hash: string;
  label: string;
  hint: string;
}

export const ROUTES: readonly RouteDef[] = [
  { id: "session", hash: "#/", label: "Session", hint: "Plan and lock" },
  { id: "allowlist", hash: "#/allowlist", label: "Allowlist", hint: "Study apps" },
  { id: "blocklist", hash: "#/blocklist", label: "Blocklist", hint: "Kill targets" },
  { id: "plugs", hash: "#/plugs", label: "Plugs", hint: "Fun outlets" },
  { id: "settings", hash: "#/settings", label: "Settings", hint: "Policy knobs" },
  { id: "log", hash: "#/log", label: "Log", hint: "Session events" },
];

export function parseRoute(hash: string): RouteId {
  const path = hash.replace(/^#/, "").replace(/^\//, "").split("?")[0]?.replace(/\/$/, "") ?? "";
  if (path === "allowlist") return "allowlist";
  if (path === "blocklist") return "blocklist";
  if (path === "plugs") return "plugs";
  if (path === "settings") return "settings";
  if (path === "log") return "log";
  return "session";
}

export function routeHash(id: RouteId): string {
  const found = ROUTES.find((route) => route.id === id);
  return found?.hash ?? "#/";
}

export function navigate(id: RouteId): void {
  window.location.hash = routeHash(id);
}

export function pageCopy(id: RouteId): { title: string; kicker: string } {
  const found = ROUTES.find((route) => route.id === id);
  if (!found) {
    throw new Error(`Unknown route: ${id}`);
  }
  return { title: found.label, kicker: found.hint };
}
