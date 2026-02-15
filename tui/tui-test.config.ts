import { defineConfig } from "@microsoft/tui-test";

export default defineConfig({
  testMatch: "**/tests/e2e/**/*.test.{ts,tsx}",
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  retries: 1,
  workers: 1,
  trace: true,
  traceFolder: "tui-traces",
});
