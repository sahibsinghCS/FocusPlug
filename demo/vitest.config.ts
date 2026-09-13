import { join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const repoRoot = resolve(import.meta.dirname, "..");

/**
 * The demo owns one behaviour worth testing in isolation — the scripted
 * timeline the judge watches — so it carries its own vitest config rather
 * than widening the app's suite. Run it with `npm run demo:test`; it is also
 * the first stage of `npm run demo:verify`.
 */
export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      "@shared": join(repoRoot, "src/shared"),
      "@renderer": join(repoRoot, "src/renderer/src"),
      "@main": join(repoRoot, "src/main"),
    },
  },
  test: {
    environment: "node",
    include: ["demo/src/**/*.test.ts"],
  },
});
