// Wiring test for Task 14: ei.tsx's showOnboarding/isFirstBoot/dataPath/
// showUpgradePrompt signals, the finishBootstrap() first-boot-vs-upgrade-prompt
// branch split, the conversation_model/extraction_model seeding fix, and the
// /onboarding command's overlay-open call.
//
// EI_E2E_MODE=3 (matches onboarding-overlay.test.tsx's established convention)
// so provider auto-detect never touches the real network — this file only
// asserts the WIRING (which signal flips, what gets written to local.json/
// settings), not the live provider-detection integration (already covered by
// provider-detection.test.ts).
process.env.EI_E2E_MODE = "3";

import { describe, it, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Self-mock logger (matches onboarding-overlay.test.tsx / harness-install.test.ts
// convention) so this file is immune to mock.module() ordering with any sibling
// file in the same `bun test` batch.
mock.module("../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  interceptConsole: () => {},
}));

// Hard safety net: block all outbound fetch for this file's lifetime. Even with
// EI_E2E_MODE=3, defense in depth against the exact class of real-network leak
// documented in the project notepad (T12 learnings).
const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(new Error("Real network fetch blocked during onboarding-wiring test"))) as unknown as typeof fetch;

import { testRender } from "@opentui/solid";
import type { ParentComponent } from "solid-js";
import { EiProvider, useEi, type EiContextValue } from "../../src/context/ei";
import { KeyboardProvider } from "../../src/context/keyboard";
import { OverlayProvider } from "../../src/context/overlay";
import { getInstalledVersion } from "../../src/util/local-state";
import { onboardingCommand } from "../../src/commands/onboarding";
import type { Command } from "../../src/commands/registry";

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

/** Minimal valid state.json checkpoint — mirrors tui/tests/e2e/fixtures.ts's shape. */
function makeCheckpoint(settings: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: timestamp,
      settings,
    },
    personas: {},
    queue: [],
  };
}

function makeExistingAccountSettings(): Record<string, unknown> {
  return {
    accounts: [{
      id: "existing-account",
      name: "Existing",
      type: "llm",
      url: "http://127.0.0.1:0",
      api_key: "",
      default_model: "existing-model",
      enabled: true,
      created_at: new Date().toISOString(),
    }],
  };
}

const cleanupDirs: string[] = [];

describe("finishBootstrap() — fresh first boot (no accounts, no local.json)", () => {
  it("auto-shows the onboarding wizard with isFirstBoot true, and never the upgrade prompt", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-wiring-freshboot-"));
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
      expect(capturedEi!.isFirstBoot()).toBe(true);
      expect(capturedEi!.showUpgradePrompt()).toBe(false);
      expect(capturedEi!.dataPath()).toBe(dataDir);

      // dismissOnboarding()/showOnboardingOverlay() round-trip (the /onboarding
      // command's would-be re-open path, exercised directly on the context).
      capturedEi!.dismissOnboarding();
      expect(capturedEi!.showOnboarding()).toBe(false);
      capturedEi!.showOnboardingOverlay();
      expect(capturedEi!.showOnboarding()).toBe(true);
    } finally {
      renderer.destroy();
    }
  }, 15000);
});

describe("finishBootstrap() — existing user (hasAccounts true)", () => {
  it("shows the upgrade prompt when local.json's installed_version is stale, never the wizard, and does NOT stamp on decline", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-wiring-stale-"));
    cleanupDirs.push(dataDir);
    writeFileSync(join(dataDir, "state.json"), JSON.stringify(makeCheckpoint(makeExistingAccountSettings())));
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ installed_version: "0.0.1" }));
    process.env.EI_DATA_PATH = dataDir;

    capturedEi = undefined;
    const { renderer } = await testRender(() => (
      <TestProviders>
        <EiCapture />
      </TestProviders>
    ));

    try {
      await waitUntil(() => capturedEi !== undefined && capturedEi.showUpgradePrompt());
      expect(capturedEi!.showOnboarding()).toBe(false);
      expect(capturedEi!.isFirstBoot()).toBe(false);

      // Decline path (fixed per .sisyphus/issues/upgrade-prompt-dismiss-is-permanent.md):
      // leaves the stale marker untouched and never runs the installer —
      // see upgrade-prompt-dismiss-is-permanent.test.tsx for the full
      // installer-not-invoked/sentinel-untouched/re-prompt coverage.
      await capturedEi!.dismissUpgradePrompt();
      expect(capturedEi!.showUpgradePrompt()).toBe(false);
      expect(await getInstalledVersion(dataDir)).toBe("0.0.1");
    } finally {
      renderer.destroy();
    }
  }, 15000);

  it("does NOT show the upgrade prompt when local.json is absent (never-installed == not stale)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-wiring-nolocal-"));
    cleanupDirs.push(dataDir);
    writeFileSync(join(dataDir, "state.json"), JSON.stringify(makeCheckpoint(makeExistingAccountSettings())));
    process.env.EI_DATA_PATH = dataDir;

    capturedEi = undefined;
    const { renderer } = await testRender(() => (
      <TestProviders>
        <EiCapture />
      </TestProviders>
    ));

    try {
      await waitUntil(() => capturedEi !== undefined);
      // Give the fire-and-forget hasAccounts/upgrade-prompt check time to settle.
      await wait(400);
      expect(capturedEi!.showUpgradePrompt()).toBe(false);
      expect(capturedEi!.showOnboarding()).toBe(false);
    } finally {
      renderer.destroy();
    }
  }, 15000);
});

describe("/onboarding command", () => {
  it("opens the OnboardingOverlay via ctx.showOverlay with the caller's renderer", () => {
    let openedRenderer: unknown;
    let capturedRenderer: unknown;

    const fakeEi = {
      detectedProviders: () => [],
      dataPath: () => "/tmp/fake-data-path",
    } as unknown as EiContextValue;

    const fakeCtx: Parameters<Command["execute"]>[1] = {
      showOverlay: (renderer, cliRenderer) => {
        openedRenderer = renderer;
        capturedRenderer = cliRenderer;
      },
      hideOverlay: () => {},
      showNotification: () => {},
      exitApp: async () => {},
      stopProcessor: async () => {},
      ei: fakeEi,
      renderer: "fake-renderer" as unknown as Parameters<Command["execute"]>[1]["renderer"],
      setInputText: () => {},
      getInputText: () => "",
    };

    void onboardingCommand.execute([], fakeCtx);

    expect(typeof openedRenderer).toBe("function");
    expect(capturedRenderer).toBe("fake-renderer");
  });
});

afterAll(async () => {
  // Mirrors onboarding-overlay.test.tsx: give EiProvider's onCleanup ->
  // processor.stop() fire-and-forget save chain a moment to settle before
  // removing directories out from under it.
  await wait(150);
  for (const dir of cleanupDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  globalThis.fetch = realFetch;
});
