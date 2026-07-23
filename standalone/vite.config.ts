import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: projectRoot,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: fileURLToPath(new URL("./index.html", import.meta.url)),
      output: {
        codeSplitting: false,
        format: "iife",
        name: "FootballSimulator",
      },
    },
  },
});
