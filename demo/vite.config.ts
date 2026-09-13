import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const repoRoot = resolve(import.meta.dirname, "..");

/**
 * BlazeFace weights as a virtual ES module: the graph topology and the single
 * 392 KB shard that ship with the Electron app (`src/main/desk/models/
 * blazeface/`) are read at BUILD time and emitted as a JS object + a base64
 * string. The live Desk AI mode therefore loads the real model with zero
 * fetches — no CDN, no `model.json` request, and it still works from file://
 * where even a same-directory fetch is blocked.
 */
function blazefaceWeights(): Plugin {
  const virtualId = "virtual:focusplug/blazeface-weights";
  const resolvedId = `\0${virtualId}`;
  const modelDir = join(repoRoot, "src/main/desk/models/blazeface");
  return {
    name: "focusplug-blazeface-weights",
    resolveId(id) {
      return id === virtualId ? resolvedId : null;
    },
    load(id) {
      if (id !== resolvedId) {
        return null;
      }
      const graph = readFileSync(join(modelDir, "model.json"), "utf8");
      const shard = readFileSync(join(modelDir, "group1-shard1of1.bin"));
      return [
        `export const modelJson = ${graph};`,
        `export const weightsBase64 = ${JSON.stringify(shard.toString("base64"))};`,
        "",
      ].join("\n");
    },
  };
}

/**
 * Vite injects the entry as `<script type="module">`, which Chrome refuses to
 * execute over `file://` (module scripts are CORS-checked, and a file has no
 * origin). The bundle below is emitted as a classic IIFE precisely so the tag
 * does not need to be a module — this rewrites it, and the built page then
 * opens by double-click as well as over http.
 */
function classicScriptTag(): Plugin {
  return {
    name: "focusplug-classic-script",
    // Build only: the dev server's own client and entry ARE ES modules.
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler: (html) =>
        html
          .replace(/\s*<link rel="modulepreload"[^>]*>/g, "")
          .replace(
            /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
            '<script defer src="$1"></script>',
          ),
    },
  };
}

/**
 * The judge-facing browser demo.
 *
 * `base: "./"` plus an IIFE bundle with every asset inlined is deliberate:
 * the built `dist/demo` has to open from a double-clicked `index.html`
 * (`file://`, where ES-module scripts and sibling fetches are both blocked)
 * as well as from GitHub Pages or any other static host. One classic script,
 * one stylesheet, fonts and model weights as data — nothing to serve.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [blazefaceWeights(), react(), tailwindcss(), classicScriptTag()],
  resolve: {
    alias: {
      "@shared": join(repoRoot, "src/shared"),
      "@renderer": join(repoRoot, "src/renderer/src"),
      "@main": join(repoRoot, "src/main"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5190,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 5191,
    strictPort: true,
  },
  build: {
    outDir: join(repoRoot, "dist/demo"),
    emptyOutDir: true,
    // Fonts + BlazeFace weights become data URIs instead of sibling files.
    assetsInlineLimit: 64 * 1024 * 1024,
    chunkSizeWarningLimit: 8192,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "assets/demo.js",
        assetFileNames: "assets/demo.[ext]",
      },
    },
  },
});
