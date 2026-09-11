export type SceneName = "default" | "live" | "distracted";

export interface UrlScene {
  countdown: number | null;
  scene: SceneName;
}

function readParam(name: string): string | null {
  const search = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const hashParams = new URLSearchParams(hashQuery);
  return search.get(name) ?? hashParams.get(name);
}

export function readUrlScene(): UrlScene {
  const rawCountdown = readParam("countdown");
  const parsed = rawCountdown ? Number.parseInt(rawCountdown, 10) : Number.NaN;
  const countdown = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const sceneParam = readParam("scene");
  let scene: SceneName = "default";
  if (sceneParam === "live") {
    scene = "live";
  } else if (sceneParam === "distracted" || countdown !== null) {
    scene = "distracted";
  }
  return { countdown, scene };
}
