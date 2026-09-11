export const ROUTE_IDS = ["session", "allowlist", "blocklist", "plugs", "settings", "log"] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

export interface RouteDef {
  id: RouteId;
  hash: string;
  label: string;
}

export const ROUTES: readonly RouteDef[] = [
  { id: "session", hash: "#/", label: "Session" },
  { id: "allowlist", hash: "#/allowlist", label: "Allowlist" },
  { id: "blocklist", hash: "#/blocklist", label: "Blocklist" },
  { id: "plugs", hash: "#/plugs", label: "Plugs" },
  { id: "settings", hash: "#/settings", label: "Settings" },
  { id: "log", hash: "#/log", label: "Log" },
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
