import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Browser-only faces preview for gauntlet stills. Does not change Electron IPC. */
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
    port: 5174,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: resolve("src/renderer/faces.html"),
    },
  },
});
