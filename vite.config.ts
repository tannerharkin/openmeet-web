import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { cspMeta } from "./build/csp.ts";

// Everything, React included, is bundled and inlined into one HTML file: no third-party origin at runtime, and
// a saved copy works offline. cspMeta must follow viteSingleFile so it hashes the final inlined scripts.
// The modulepreload polyfill is off: everything is inlined, so it would be dead code needing its own CSP hash.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), cspMeta()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    target: "es2022",
    modulePreload: { polyfill: false },
  },
});
