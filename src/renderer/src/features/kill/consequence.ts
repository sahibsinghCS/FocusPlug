import { enabledPlugViews, type PlugView } from "../../lib/plugsUi";

/**
 * What the fuse is about to do, named. The overlay is the one moment the
 * product cannot be vague: it says which plugs get cut, and says so even when
 * none are armed, because "apps still die" is the part people doubt.
 */
export function overlayConsequenceLines(plugs: readonly PlugView[]): {
  apps: string;
  plugs: string;
} {
  const armed = enabledPlugViews(plugs);
  return {
    apps: "Blocked apps will be force-quit",
    plugs:
      armed.length > 0
        ? `Armed plugs will be cut (${armed.map((plug) => plug.name).join(", ")})`
        : "No plugs armed — apps still die; study PC is never cut",
  };
}
