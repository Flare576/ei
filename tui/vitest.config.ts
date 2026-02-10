import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    include: ["../tests/tui/**/*.test.{ts,tsx}"],
    exclude: ["../tests/tui/storage/**", "../tests/tui/e2e/**"],
    environment: "node",
    globals: true,
  },
});
