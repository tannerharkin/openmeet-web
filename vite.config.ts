import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import externalGlobals from "rollup-plugin-external-globals";
import path from "node:path";

// React and ReactDOM come from cdnjs (see index.html); everything else is bundled and inlined into
// a single HTML file so the result can be published as one gist file.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
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
