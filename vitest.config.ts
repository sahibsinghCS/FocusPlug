import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/shared/policy/**/*.test.ts", "src/main/session/**/*.test.ts"],
  },
});
