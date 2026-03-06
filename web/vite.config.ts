import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@ei": "../src",
    },
  },
  build: {
    rollupOptions: {
      external: [
        "bun:sqlite",
        "fs",
        "path",
        /^node:/,
        /integrations\/opencode/,
        /tools\/builtin\/file-read/,
      ],
    },
  },
});
