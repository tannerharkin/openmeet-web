import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { cspMeta } from "./build/csp";

// Everything, React included, is bundled and inlined into one HTML file: no third-party origin at runtime, and
// a saved copy works offline. cspMeta must follow viteSingleFile so it hashes the final inlined scripts.
// removeViteModuleLoader drops the modulepreload polyfill (no-op here, and it would need its own CSP hash).
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile({ removeViteModuleLoader: true }), cspMeta()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    target: "es2022",
  },
});
