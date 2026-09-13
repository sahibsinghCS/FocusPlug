import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Browser-only Focus Forecast judge demo: the scripted replay through the
 * same @shared/forecast core, no Electron. Rooted at src/renderer (the
 * faces-preview pattern) so Tailwind sees every console component the page
 * reuses; the entry lives in the forecast feature dir:
 * http://127.0.0.1:5180/src/features/forecast/
 */
export default defineConfig({
  root: resolve("src/renderer"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      "@renderer": resolve("src/renderer/src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
  },
  build: {
    outDir: resolve("out/forecast-preview"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve("src/renderer/src/features/forecast/index.html"),
    },
  },
});
