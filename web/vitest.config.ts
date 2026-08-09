import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ei": "../src",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // `src/core/entity-schemas.ts` imports the (undeclared, transitively
    // hoisted) `zod` package. Vite's default web dep-optimizer mishandles
    // zod 3.25.x's dual v3/v4 ESM entrypoint under jsdom, resolving the `z`
    // named export to `undefined` at runtime (reproduced pre-existing on
    // every test file that transitively imports Processor/entity-schemas,
    // e.g. SettingsModal.test.tsx, App.storage.test.ts,
    // QuoteCaptureModal.test.tsx -- confirmed unrelated to any change in
    // this commit). Inlining it instead of optimizing it as a web dep fixes
    // the interop.
    server: {
      deps: {
        inline: ["zod"],
      },
    },
  },
});
