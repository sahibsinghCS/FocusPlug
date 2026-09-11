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
    include: ["src/shared/policy/**/*.test.ts", "src/main/session/**/*.test.ts"],
  },
});
