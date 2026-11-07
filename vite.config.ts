import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import externalGlobals from "rollup-plugin-external-globals";
import path from "node:path";
import { cspMeta } from "./build/csp";

// React and ReactDOM load from cdnjs (see index.html) to keep the single file small and let browsers cache
// them; everything else is bundled and inlined into one HTML file. cspMeta must follow viteSingleFile so it
// hashes the final inlined scripts. removeViteModuleLoader drops the modulepreload polyfill (no-op here, and it
// would need its own CSP hash).
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile({ removeViteModuleLoader: true }), cspMeta()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // React's UMD build has no jsx-runtime entry point; route the automatic runtime to a shim.
      "react/jsx-runtime": path.resolve(import.meta.dirname, "src/shims/jsx-runtime.ts"),
      "react/jsx-dev-runtime": path.resolve(import.meta.dirname, "src/shims/jsx-runtime.ts"),
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      external: ["react", "react-dom", "react-dom/client"],
      plugins: [externalGlobals({ react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM" })],
    },
  },
});
