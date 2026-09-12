import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Isolated Candle stills. Does not change Electron IPC or SessionPage. */
export default defineConfig({
  root: resolve("src/renderer/src/features/faces/candle"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      "@renderer": resolve("src/renderer/src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5179,
    strictPort: true,
  },
});
