import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "..");

export default defineConfig({
  root: resolve(root, "src/renderer"),
  publicDir: false,
  resolve: {
    alias: {
      "@shared": resolve(root, "src/shared"),
      "@renderer": resolve(root, "src/renderer/src"),
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
