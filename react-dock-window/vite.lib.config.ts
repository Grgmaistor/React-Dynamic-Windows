import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Library build (`npm run build`): ESM + CJS bundle, styles, type declarations. */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es", "cjs"],
      fileName: (format) =>
        format === "es" ? "react-dock-window.js" : "react-dock-window.cjs",
      cssFileName: "react-dock-window",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
      output: {
        globals: { react: "React", "react-dom": "ReactDOM" },
      },
    },
  },
});
