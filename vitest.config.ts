import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.tsx", "src/components/**"],
    },
  },
  resolve: {
    alias: {
      "./llm.js": "./llm.ts",
      "./types.js": "./types.ts",
      "./storage.js": "./storage.ts",
      "./prompts.js": "./prompts.ts",
      "./validate.js": "./validate.ts",
    },
  },
});
