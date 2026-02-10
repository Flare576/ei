import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    include: ["../tests/tui/**/*.test.{ts,tsx}", "tests/e2e/**/*.test.{ts,tsx}"],
    exclude: ["../tests/tui/storage/**"],
    environment: "node",
    globals: true,
  },
});
