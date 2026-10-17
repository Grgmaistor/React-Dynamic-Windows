import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Demo / documentation site (`npm run dev`). */
export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "demo-dist",
  },
  server: {
    port: 5173,
  },
});
