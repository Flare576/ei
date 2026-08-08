// THROWAWAY QA ARTIFACT — Final Verification Wave, item F3 (Beta).
// Not a plan deliverable. Exercises scenario 3 (equal-version leg) of the
// F3 assignment:
//   3. "existing user + local.json present but version EQUAL to
//      pkg.version — confirm no prompt."
//
// Scenario 4 of the original F3 assignment ("Decline-no-nag: decline the
// upgrade prompt once — confirm local.json gets stamped anyway and a
// SECOND identical bootstrap does NOT re-prompt") asserted the exact
// bookkeeping defect reported in
// .sisyphus/issues/upgrade-prompt-dismiss-is-permanent.md: dismiss stamped
// the marker unconditionally, permanently suppressing the prompt even
// though no install ever ran. Per that issue's fix (ei.tsx's
// dismissUpgradePrompt() no longer stamps at all), the describe block
// below is inverted to assert the CORRECT behavior instead — decline must
// re-prompt on the next launch, not go quiet. Full installer-not-invoked/
// marker/sentinel coverage for both dismiss and confirm lives in
// upgrade-prompt-dismiss-is-permanent.test.tsx.
//
// Gap this closes: onboarding-wiring.test.tsx already covers the
// present-stale->true and absent->false legs of shouldShowUpgradePrompt's
// decision matrix through a real finishBootstrap() run, but never
// exercises the EQUAL-version leg through the real wiring (only through
// upgrade-prompt.test.ts's pure unit test of the decision function in
// isolation).
process.env.EI_E2E_MODE = "3";

import { describe, it, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

mock.module("../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  interceptConsole: () => {},
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(new Error("Real network fetch blocked during final-qa-upgrade-prompt-integration test"))) as unknown as typeof fetch;

import { testRender } from "@opentui/solid";
import type { ParentComponent } from "solid-js";
import { EiProvider, useEi, type EiContextValue } from "../../src/context/ei";
import { KeyboardProvider } from "../../src/context/keyboard";
import { OverlayProvider } from "../../src/context/overlay";
import { getInstalledVersion } from "../../src/util/local-state";
import pkg from "../../../package.json";

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

// See onboarding-wiring.test.tsx's own wait()/waitUntil() convention: this
// file drives a real EiProvider whose finishBootstrap() runs a real
// fire-and-forget async IIFE (real fs-backed getInstalledVersion I/O) under
// Solid's own reactive scheduler — there is no fake-timer substitute for
// "has this real async effect settled". waitUntil below polls a REAL,
// concrete predicate on each tick, not a guessed fixed duration.
function wait(ms = 20): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await wait(20);
  }
  if (!predicate()) throw new Error("Timed out waiting for condition");
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

describe("Final QA — upgrade prompt: equal-version leg (no false-positive nag)", () => {
  it("existing user + local.json present with installed_version EQUAL to pkg.version -> no prompt, no wizard", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-final-qa-equalver-"));
    cleanupDirs.push(dataDir);
    writeFileSync(join(dataDir, "state.json"), JSON.stringify(makeCheckpoint(makeExistingAccountSettings())));
    // Already stamped at the CURRENT pkg.version -- not stale.
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ installed_version: pkg.version }));
    process.env.EI_DATA_PATH = dataDir;

    capturedEi = undefined;
    const { renderer } = await testRender(() => (
      <TestProviders>
        <EiCapture />
      </TestProviders>
    ));

    try {
      await waitUntil(() => capturedEi !== undefined);
      // Give the fire-and-forget hasAccounts/upgrade-prompt check a real
      // chance to settle (mirrors onboarding-wiring.test.tsx's own
      // "does NOT show... absent" test's identical wait pattern).
      await wait(400);
      expect(capturedEi!.showUpgradePrompt()).toBe(false);
      expect(capturedEi!.showOnboarding()).toBe(false);
      expect(capturedEi!.isFirstBoot()).toBe(false);
    } finally {
      renderer.destroy();
    }
  }, 15000);
});

describe("Final QA — decline re-prompts: declining once leaves the marker stale, so a second real bootstrap prompts again", () => {
  it("declining the upgrade prompt does NOT stamp pkg.version, and a FRESH second EiProvider boot against the same data path prompts again", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-final-qa-declinereprompt-"));
    cleanupDirs.push(dataDir);
    writeFileSync(join(dataDir, "state.json"), JSON.stringify(makeCheckpoint(makeExistingAccountSettings())));
    // Genuinely stale on the FIRST boot.
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ installed_version: "0.0.1" }));
    process.env.EI_DATA_PATH = dataDir;

    // --- First boot: prompt fires, decline it ---
    capturedEi = undefined;
    const first = await testRender(() => (
      <TestProviders>
        <EiCapture />
      </TestProviders>
    ));

    try {
      await waitUntil(() => capturedEi !== undefined && capturedEi.showUpgradePrompt());
      await capturedEi!.dismissUpgradePrompt();
      expect(capturedEi!.showUpgradePrompt()).toBe(false);
      const stampedAfterDecline = await getInstalledVersion(dataDir);
      expect(stampedAfterDecline).toBe("0.0.1");
    } finally {
      first.renderer.destroy();
    }

    // Let the first instance's real onCleanup -> processor.stop() chain
    // settle before mounting a second EiProvider against the same
    // directory (same rationale as onboarding-overlay.test.tsx's afterAll:
    // fire-and-forget, no promise to await).
    await wait(150);

    // --- Second, completely fresh boot against the SAME data path ---
    // eiDataPath is re-read from Bun.env.EI_DATA_PATH on every new
    // EiProvider mount (ei.tsx's onMount), so this is a genuine second
    // "app launch", not a re-render of the same instance.
    capturedEi = undefined;
    const second = await testRender(() => (
      <TestProviders>
        <EiCapture />
      </TestProviders>
    ));

    try {
      await waitUntil(() => capturedEi !== undefined);
      // Give the fire-and-forget hasAccounts/upgrade-prompt check a real
      // chance to settle before asserting its POSITIVE outcome.
      await wait(400);
      expect(capturedEi!.showUpgradePrompt()).toBe(true);
      expect(capturedEi!.showOnboarding()).toBe(false);
    } finally {
      second.renderer.destroy();
    }
  }, 20000);
});

afterAll(async () => {
  // Real delay, not a condition-poll: EiProvider's onCleanup -> processor.stop()
  // save chain is fire-and-forget with no promise this test can observe.
  await wait(150);
  for (const dir of cleanupDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  globalThis.fetch = realFetch;
});
