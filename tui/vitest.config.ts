import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    include: ["../tests/tui/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: true,
  },
});
