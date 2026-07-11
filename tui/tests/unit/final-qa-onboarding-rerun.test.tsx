// THROWAWAY QA ARTIFACT — Final Verification Wave, item F3 (Beta).
// Not a plan deliverable. Exercises scenario 2 of the F3 assignment:
// "`/onboarding` re-run on an already-configured instance — confirm it
// shows already-done state, confirm nothing gets silently overwritten if
// the user doesn't change anything."
//
// Gap this closes: onboarding-wiring.test.tsx's "/onboarding command" test
// only proves the command calls ctx.showOverlay with a renderer — it never
// actually renders OnboardingOverlay with isFirstBoot=false against a real
// already-configured EiProvider instance. onboarding-overlay.test.tsx /
// onboarding-overlay-negative.test.tsx both start from isFirstBoot=true with
// NO existing accounts. None of the three exercise the re-run-on-configured-
// instance path, and none prove the Import step's "only ever sets true,
// never resets to false" behavior when a re-run's detection no longer finds
// a source that was already flagged on from a prior run.
process.env.EI_E2E_MODE = "3";

import { describe, it, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const testDataDir = mkdtempSync(join(tmpdir(), "ei-final-qa-rerun-"));
process.env.EI_DATA_PATH = testDataDir;

mock.module("../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  interceptConsole: () => {},
}));

import { getInstalledVersion } from "../../src/util/local-state";

let runHarnessInstallImpl: () => Promise<{ ok: boolean; failures: string[] }> = async () => {
  throw new Error("runHarnessInstall should never be called — Install is declined in this scenario");
};

const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(new Error("Real network fetch blocked during final-qa-onboarding-rerun test"))) as unknown as typeof fetch;

import { testRender } from "@opentui/solid";
import type { ParentComponent } from "solid-js";
import { EiProvider, useEi, type EiContextValue } from "../../src/context/ei";
import { KeyboardProvider } from "../../src/context/keyboard";
import { OverlayProvider } from "../../src/context/overlay";
import { OnboardingOverlay, type ImportSourceDetection } from "../../src/components/OnboardingOverlay";
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

// NOTE on real-clock waits below: this file drives a real SolidJS render
// tree (testRender) whose OnboardingOverlay mounts real onMount fire-and-
// forget async work (ei.getHuman() I/O, real fs-backed local.json writes)
// under Solid's own reactive scheduler. There is no fake-timer substitute
// for "has this real async effect settled yet" here — this file's own
// sibling suite (onboarding-overlay.test.tsx, onboarding-wiring.test.tsx)
// establishes the same real-delay-based polling convention for the exact
// same reason. `waitForFrame` below polls a REAL, concrete predicate (the
// rendered frame) on each tick rather than guessing a fixed duration — it
// is "await the real signal", just implemented as manual polling since
// Solid's render tree exposes no emitter for "this frame is final".
function wait(ms = 20): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Poll a real predicate (not a guessed duration) until it turns true. */
async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await wait(20);
  }
  if (!predicate()) throw new Error("Timed out waiting for condition");
}

async function waitForFrame(
  captureCharFrame: () => string,
  renderOnce: () => Promise<void>,
  predicate: (frame: string) => boolean,
  timeoutMs = 8000
): Promise<string> {
  const start = Date.now();
  let frame = captureCharFrame();
  while (!predicate(frame) && Date.now() - start < timeoutMs) {
    await renderOnce();
    await wait(20);
    frame = captureCharFrame();
  }
  if (!predicate(frame)) throw new Error(`Timed out waiting for frame predicate. Last frame:\n${frame}`);
  return frame;
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

const EXISTING_ACCOUNT = {
  id: "existing-account",
  name: "Existing",
  type: "llm",
  url: "http://127.0.0.1:0",
  api_key: "",
  default_model: "existing-model",
  enabled: true,
  created_at: new Date().toISOString(),
};

function makeAlreadyConfiguredSettings(): Record<string, unknown> {
  return {
    accounts: [EXISTING_ACCOUNT],
    conversation_model: "existing-conversation-guid",
    extraction_model: "existing-extraction-guid",
    // Already flagged on from a PRIOR wizard/import run — the re-run's own
    // detectIntegrations below deliberately returns false for claudeCode
    // (simulating "not currently detected on this pass") to prove the
    // Import step never resets an already-true flag back to false/undefined.
    claudeCode: { integration: true },
  };
}

describe("Final QA — /onboarding re-run on an already-configured instance", () => {
  it("shows already-done state (Welcome back / already configured) and does not silently overwrite accounts, model fields, or an already-true integration flag", async () => {
    writeFileSync(join(testDataDir, "state.json"), JSON.stringify(makeCheckpoint(makeAlreadyConfiguredSettings())));
    // Already stamped at the current version — this really is a fully
    // "already-done" instance re-running /onboarding, not a fresh/upgrade case.
    writeFileSync(join(testDataDir, "local.json"), JSON.stringify({ installed_version: pkg.version }));

    const detectIntegrations = async (): Promise<ImportSourceDetection> => ({
      claudeCode: false, // NOT currently detected on this pass
      cursor: false,
      codex: false,
      pi: false,
    });

    let onDismissCalled = false;

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <TestProviders>
          <EiCapture />
          <OnboardingOverlay
            onDismiss={() => {
              onDismissCalled = true;
            }}
            detectedProviders={[]}
            isFirstBoot={false}
            dataPath={testDataDir}
            detectIntegrations={detectIntegrations}
            shellProfileOptions={{ env: { SHELL: "/bin/zsh" } }}
            runHarnessInstall={() => runHarnessInstallImpl()}
          />
        </TestProviders>
      ),
      { width: 220, height: 34 }
    );

    try {
      // --- Welcome: "already-done" copy, not first-boot copy ---
      let frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome back!"));
      expect(frame).not.toContain("Welcome to Ei!");

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/6: Install"));

      // --- Decline Install (never touch the real installer in a re-run QA test) ---
      mockInput.pressKey("n");
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped"));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 3/6: Data Path"));
      // Shows the CURRENT (unchanged) data path, not reset to any default.
      expect(frame).toContain(`Data path: ${testDataDir}`);

      mockInput.pressEnter(); // continue without changing the path
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 4/6: Provider"));

      // --- Provider step: shows "already configured" using the EXISTING
      // account name, without ever mounting ProviderForm (no form fields). ---
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("already configured"));
      expect(frame).toContain("Existing (already configured)");

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 5/6: Import"));

      // --- Import step: nothing NEW detected this pass ---
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("No supported integrations detected"));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 6/6: Done"));

      // --- Done: finish ---
      expect(onDismissCalled).toBe(false);
      mockInput.pressEnter();
      await renderOnce();
      await waitUntil(() => onDismissCalled);
      expect(onDismissCalled).toBe(true);

      // --- Nothing silently overwritten: accounts, conversation_model,
      // extraction_model, and the already-true claudeCode flag are all
      // EXACTLY as they were before the re-run — even though this run's
      // own detection returned false for claudeCode. ---
      expect(capturedEi).toBeDefined();
      const human = await capturedEi!.getHuman();
      // Note: an unrelated PRE-EXISTING migration (migrateProviderModel,
      // string default_model -> GUID ModelConfig) fires on every account
      // load regardless of the wizard — assert on identity, not full
      // deep-equality, so this test targets only what the wizard itself
      // could have clobbered.
      expect(human.settings?.accounts).toHaveLength(1);
      expect(human.settings?.accounts?.[0]?.id).toBe(EXISTING_ACCOUNT.id);
      expect(human.settings?.accounts?.[0]?.name).toBe(EXISTING_ACCOUNT.name);
      expect(human.settings?.conversation_model).toBe("existing-conversation-guid");
      expect(human.settings?.extraction_model).toBe("existing-extraction-guid");
      expect(human.settings?.claudeCode?.integration).toBe(true);

      // local.json is still stamped at the current version (re-run
      // re-stamps but the value is unchanged since it was already current).
      const stamped = await getInstalledVersion(testDataDir);
      expect(stamped).toBe(pkg.version);
    } finally {
      renderer.destroy();
    }
  }, 20000);
});

afterAll(async () => {
  // Real delay, not a condition-poll: EiProvider's onCleanup -> processor.stop()
  // save chain is fire-and-forget with no promise this test can observe —
  // there is no concrete signal to await here, only "enough real time for
  // it to have settled" before the test directory is removed out from under
  // it. Matches onboarding-overlay.test.tsx's afterAll for the same reason.
  await wait(150);
  await rm(testDataDir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});
