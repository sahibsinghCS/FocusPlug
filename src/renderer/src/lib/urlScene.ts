export type SceneName = "default" | "live" | "distracted" | "away" | "recovered";

export interface UrlScene {
  countdown: number | null;
  scene: SceneName;
  freeze: boolean;
}

function readParam(search: string, hash: string, name: string): string | null {
  const query = new URLSearchParams(search);
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const hashParams = new URLSearchParams(hashQuery);
  return query.get(name) ?? hashParams.get(name);
}

export function parseUrlScene(search: string, hash: string): UrlScene {
  const rawCountdown = readParam(search, hash, "countdown");
  const parsed = rawCountdown ? Number.parseInt(rawCountdown, 10) : Number.NaN;
  const countdown = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const sceneParam = readParam(search, hash, "scene");
  let scene: SceneName = "default";
  if (sceneParam === "live") {
    scene = "live";
  } else if (sceneParam === "away") {
    scene = "away";
  } else if (sceneParam === "recovered") {
    scene = "recovered";
  } else if (sceneParam === "distracted" || countdown !== null) {
    scene = "distracted";
  }
  return { countdown, scene, freeze: readParam(search, hash, "freeze") !== null };
}

export function readUrlScene(): UrlScene {
  return parseUrlScene(window.location.search, window.location.hash);
}
