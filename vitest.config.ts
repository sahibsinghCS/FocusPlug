import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/shared/**/*.test.ts",
      "src/main/session/**/*.test.ts",
      "src/main/desk/**/*.test.ts",
      "src/main/plugs/**/*.test.ts",
      "src/renderer/src/**/*.test.ts",
    ],
  },
});
