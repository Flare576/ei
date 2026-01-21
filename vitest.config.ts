import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/e2e/**/*.e2e.test.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
    teardownTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.tsx", "src/components/**"],
    },
    env: {
      NODE_ENV: "test",
      EI_TEST_INPUT: "true",
      EI_TEST_OUTPUT: "true",
      NO_COLOR: "1",
      EI_LLM_BASE_URL: "http://127.0.0.1:3001/v1",
      EI_LLM_API_KEY: "test-key",
      EI_LLM_MODEL: "test-model"
    },
    pool: "forks",
    maxConcurrency: 1
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
