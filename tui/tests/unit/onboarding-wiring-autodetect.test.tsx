// Regression test for issue #89 (M1 follow-up): finishBootstrap()'s auto-detect
// branch in ei.tsx wrote a hand-built "Provider:model" display string directly
// into HumanSettings.conversation_model/extraction_model instead of resolving
// the seeded account's model GUID. createProviderViaEditor()/newProviderFromYAML()
// were fixed for the manual /provider new flow; this covers the OTHER seeding
// site — the auto-detected-on-first-launch path (the default new-user experience,
// see root AGENTS.md's "Local LLM auto-created on port 1234" note).
//
// EI_E2E_MODE=1 (skip local detect only, per src/util/e2e-flags.ts's bitfield)
// so LOCAL_PROVIDERS probing never touches the real network, while cloud
// detection runs for real against a mocked global fetch — this is the only way
// to exercise ei.tsx's `detected.length > 0` branch, since detectProviders()'s
// fetch override is not threaded through the EiProvider bootstrap call site.
process.env.EI_E2E_MODE = "1";
process.env.ANTHROPIC_API_KEY = "sk-test-key";

import { describe, it, expect, mock, afterAll } from "bun:test";
import { mkdtempSync } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Self-mock logger (matches onboarding-wiring.test.tsx convention) so this file
// is immune to mock.module() ordering with any sibling file in the same
// `bun test` batch.
mock.module("../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  interceptConsole: () => {},
}));

// Fake the one cloud call this test allows: Anthropic's /v1/models probe.
// Everything else (other cloud providers with no env key set, local detect
// skipped by EI_E2E_MODE=1) never reaches fetch.
const ANTHROPIC_MODELS = {
  data: [
    { id: "claude-haiku-4-5" },
    { id: "claude-sonnet-4-5" },
    { id: "claude-opus-4" },
  ],
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  if (typeof url === "string" && url.includes("api.anthropic.com")) {
    return { ok: true, json: async () => ANTHROPIC_MODELS } as Response;
  }
  throw new Error(`Unmocked fetch during onboarding-wiring-autodetect test: ${url}`);
}) as unknown as typeof fetch;

import { testRender } from "@opentui/solid";
import type { ParentComponent } from "solid-js";
import { EiProvider, useEi, type EiContextValue } from "../../src/context/ei";
import { KeyboardProvider } from "../../src/context/keyboard";
import { OverlayProvider } from "../../src/context/overlay";

const TestProviders: ParentComponent = (props) => (
  <EiProvider>
    <OverlayProvider>
      <KeyboardProvider>{props.children}</KeyboardProvider>
    </OverlayProvider>
  </EiProvider>
);

let capturedEi: EiContextValue | undefined;
function EiCapture() {
  capturedEi = useEi();
  return <box width={0} height={0} />;
}

function wait(ms = 20): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await wait(20);
  }
  throw new Error("Timed out waiting for condition");
}

const cleanupDirs: string[] = [];

describe("finishBootstrap() — auto-detected provider seeds a GUID, not a display string (issue #89)", () => {
  it("resolves conversation_model/extraction_model to the seeded account's model ids", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-wiring-autodetect-"));
    cleanupDirs.push(dataDir);
    process.env.EI_DATA_PATH = dataDir;

    capturedEi = undefined;
    const { renderer } = await testRender(() => (
      <TestProviders>
        <EiCapture />
      </TestProviders>
    ));

    try {
      await waitUntil(() => capturedEi !== undefined && capturedEi.showOnboarding());

      const human = await capturedEi!.getHuman();
      const settings = human.settings;
      const account = settings?.accounts?.find((a) => a.name === "Anthropic");
      if (!account) throw new Error("expected Anthropic account to be auto-seeded");

      const chatModelId = account.models?.find((m) => m.name === "claude-sonnet-4-5")?.id;
      const extractionModelId = account.models?.find((m) => m.name === "claude-haiku-4-5")?.id;
      if (!chatModelId || !extractionModelId) {
        throw new Error("expected seeded Anthropic account to have chat/extraction models with ids");
      }

      // M1 regression (issue #89): must be the model's GUID, never a hand-built
      // "Anthropic:claude-sonnet-4-5" display string.
      expect(settings?.conversation_model).not.toContain(":");
      expect(settings?.extraction_model).not.toContain(":");
      expect(settings?.conversation_model).toBe(chatModelId);
      expect(settings?.extraction_model).toBe(extractionModelId);
    } finally {
      renderer.destroy();
    }
  }, 15000);
});

afterAll(async () => {
  // Mirrors onboarding-wiring.test.tsx: give EiProvider's onCleanup ->
  // processor.stop() fire-and-forget save chain a moment to settle before
  // removing directories out from under it.
  await wait(150);
  for (const dir of cleanupDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  globalThis.fetch = realFetch;
});
