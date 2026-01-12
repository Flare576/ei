import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/e2e/**/*.e2e.test.ts"],
    testTimeout: 60000, // 60 seconds for e2e tests
    hookTimeout: 30000, // 30 seconds for setup/teardown
    teardownTimeout: 15000, // 15 seconds for cleanup
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.tsx", "src/components/**"],
    },
    // E2E test specific configuration
    env: {
      // Set test environment variables for e2e tests
      NODE_ENV: "test",
      EI_TEST_INPUT: "true",
      NO_COLOR: "1",
      // Default test LLM configuration
      EI_LLM_BASE_URL: "http://127.0.0.1:3001/v1",
      EI_LLM_API_KEY: "test-key",
      EI_LLM_MODEL: "test-model"
    },
    // E2E tests run sequentially to avoid resource conflicts
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
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
