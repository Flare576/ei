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
// instance path, and none prove the merged Install step's "only ever sets
// an integration flag true, never resets one back to false" behavior when a
// re-run's detection no longer finds a source that was already flagged on
// from a prior run — this file confirms it by pressing 'y' (not declining),
// since declining now skips the flag-write logic entirely and would leave
// that invariant unexercised.
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

let runHarnessInstallImpl: () => Promise<{ ok: boolean; failures: string[] }> = async () => ({
  ok: true,
  failures: [],
});

const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(new Error("Real network fetch blocked during final-qa-onboarding-rerun test"))) as unknown as typeof fetch;

import { testRender } from "@opentui/solid";
import { createSignal, Show, type ParentComponent } from "solid-js";
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

/**
 * `renderer.destroy()` disposes Solid synchronously, but EiProvider's cleanup
 * starts `processor.stop()` without awaiting its async persistence flush.
 * Stop first so a prior test cannot write its stale full snapshot over the
 * next test's fixture in this intentionally shared data directory.
 */
async function stopProcessorAndDestroy(renderer: { destroy: () => void }): Promise<void> {
  const ei = capturedEi;
  try {
    if (!ei) throw new Error("EiProvider context was not captured before teardown");
    await ei.stopProcessor();
  } finally {
    renderer.destroy();
  }
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
async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await predicate()) && Date.now() - start < timeoutMs) {
    await wait(20);
  }
  if (!(await predicate())) throw new Error("Timed out waiting for condition");
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
  // Explicit, matching the GUIDs settings.conversation_model/extraction_model
  // point at below — ProviderSelector resolves real model NAMES (not just
  // the account), unlike the old design's account-only summary line.
  models: [
    { id: "existing-conversation-guid", name: "Existing Conversation Model" },
    { id: "existing-extraction-guid", name: "Existing Extraction Model" },
  ],
  enabled: true,
  created_at: new Date().toISOString(),
};

function makeAlreadyConfiguredSettings(): Record<string, unknown> {
  return {
    accounts: [EXISTING_ACCOUNT],
    conversation_model: "existing-conversation-guid",
    extraction_model: "existing-extraction-guid",
    // Already flagged on from a PRIOR wizard/install run — the re-run's own
    // detectIntegrations below deliberately returns false for claudeCode
    // (simulating "not currently detected on this pass") to prove the
    // merged Install step never resets an already-true flag back to
    // false/undefined, even when the user says 'y' again on this pass.
    claudeCode: { integration: true },
  };
}

describe("Final QA — /onboarding re-run on an already-configured instance", () => {
  it("shows already-done state (Welcome back / pre-filled provider selection) and does not silently overwrite accounts, model fields, or an already-true integration flag", async () => {
    capturedEi = undefined;

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
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/4: Provider"));

      // --- Provider step: exactly one llm account -> ProviderSelector skips
      // straight to the model picker, pre-filled from the EXISTING settings
      // GUIDs (not a static "already configured" summary — it's always
      // interactive now, but confirming with no changes must round-trip
      // the identical values). ---
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Existing"));
      expect(frame).toContain("Existing Conversation Model");
      expect(frame).toContain("Existing Extraction Model");

      // Confirm without changing anything -> auto-advances straight to Install.
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 3/4: Install"));

      // --- Install/Import: nothing NEW detected this pass ---
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("No supported coding tools detected"));

      // --- Confirm 'y' — proves the flag-write logic itself never resets
      // an already-true flag, not merely that declining leaves it alone. ---
      await mockInput.typeText("y");
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("installed."));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 4/4: Done"));
      expect(frame).toContain("Existing (configured)");

      // --- Done: finish ---
      expect(onDismissCalled).toBe(false);
      mockInput.pressEnter();
      await renderOnce();
      await waitUntil(() => onDismissCalled);
      expect(onDismissCalled).toBe(true);

      // --- Nothing silently overwritten: accounts, conversation_model,
      // extraction_model, and the already-true claudeCode flag are all
      // EXACTLY as they were before the re-run — even though this run's
      // own detection returned false for claudeCode and the user confirmed
      // ('y') the merged Install step. ---
      expect(capturedEi).toBeDefined();
      const human = await capturedEi!.getHuman();
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
      await stopProcessorAndDestroy(renderer);

    }
  }, 20000);

  it("lets a re-run with one enabled model-less LLM account skip Provider and preserves its existing model settings (I1)", async () => {
    const modelLessAccount = {
      id: "model-less-account",
      name: "Model-less",
      type: "llm",
      url: "http://127.0.0.1:0",
      api_key: "",
      models: [],
      enabled: true,
      created_at: new Date().toISOString(),
    };
    const originalModelSettings = {
      conversation_model: "preserved-conversation-model",
      extraction_model: "preserved-extraction-model",
    };
    writeFileSync(
      join(testDataDir, "state.json"),
      JSON.stringify(makeCheckpoint({ accounts: [modelLessAccount], ...originalModelSettings }))
    );
    writeFileSync(join(testDataDir, "local.json"), JSON.stringify({ installed_version: pkg.version }));

    const detectIntegrations = async (): Promise<ImportSourceDetection> => ({
      claudeCode: false,
      cursor: false,
      codex: false,
      pi: false,
    });
    capturedEi = undefined;
    let mountOverlay: (() => void) | undefined;
    const DeferredOnboardingOverlay = () => {
      const [isOverlayMounted, setIsOverlayMounted] = createSignal(false);
      mountOverlay = () => setIsOverlayMounted(true);
      return (
        <>
          <EiCapture />
          <Show when={isOverlayMounted()}>
            <OnboardingOverlay
              onDismiss={() => {}}
              detectedProviders={[]}
              isFirstBoot={false}
              dataPath={testDataDir}
              detectIntegrations={detectIntegrations}
              runHarnessInstall={() => runHarnessInstallImpl()}
            />
          </Show>
        </>
      );
    };

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <TestProviders>
          <DeferredOnboardingOverlay />
        </TestProviders>
      ),
      { width: 220, height: 34 }
    );

    try {
      await waitUntil(async () => {
        try {
          await capturedEi?.getHuman();
          return capturedEi !== undefined && mountOverlay !== undefined;
        } catch {
          return false;
        }
      });

      // State migration supplies a placeholder model for legacy model-less
      // accounts, so restore the checkpoint's empty model list immediately
      // before mounting the overlay to exercise the persisted edge case.
      await capturedEi!.updateSettings({ accounts: [modelLessAccount], ...originalModelSettings });
      expect((await capturedEi!.getHuman()).settings?.accounts?.[0]?.models).toHaveLength(0);
      mountOverlay!();

      await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome back!"));
      mockInput.pressEnter();
      let frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/4: Provider"));

      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("No models configured for this account"));
      expect(frame).toContain("Esc: skip provider setup for now");

      mockInput.pressEscape();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped — no AI provider configured."));
      expect(frame).toContain("Skipped — no AI provider configured.");

      mockInput.pressEnter();
      await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 3/4: Install"));

      const human = await capturedEi!.getHuman();
      expect(human.settings?.conversation_model).toBe(originalModelSettings.conversation_model);
      expect(human.settings?.extraction_model).toBe(originalModelSettings.extraction_model);
    } finally {
      await stopProcessorAndDestroy(renderer);

    }
  }, 20000);

  it("excludes a disabled LLM account from the provider picker entirely (I3)", async () => {
    capturedEi = undefined;

    const disabledAccount = {
      id: "disabled-account",
      name: "Disabled",
      type: "llm",
      url: "http://127.0.0.1:0",
      api_key: "",
      models: [{ id: "disabled-model-guid", name: "Disabled Model" }],
      enabled: false,
      created_at: new Date().toISOString(),
    };
    const enabledAccount = {
      id: "enabled-account",
      name: "Enabled",
      type: "llm",
      url: "http://127.0.0.1:0",
      api_key: "",
      models: [{ id: "enabled-model-guid", name: "Enabled Model" }],
      enabled: true,
      created_at: new Date().toISOString(),
    };
    writeFileSync(
      join(testDataDir, "state.json"),
      JSON.stringify(makeCheckpoint({ accounts: [disabledAccount, enabledAccount] }))
    );
    writeFileSync(join(testDataDir, "local.json"), JSON.stringify({ installed_version: pkg.version }));

    const detectIntegrations = async (): Promise<ImportSourceDetection> => ({
      claudeCode: false,
      cursor: false,
      codex: false,
      pi: false,
    });

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <TestProviders>
          <EiCapture />
          <OnboardingOverlay
            onDismiss={() => {}}
            detectedProviders={[]}
            isFirstBoot={false}
            dataPath={testDataDir}
            detectIntegrations={detectIntegrations}
            runHarnessInstall={() => runHarnessInstallImpl()}
          />
        </TestProviders>
      ),
      { width: 220, height: 34 }
    );

    try {
      let frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome back!"));
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/4: Provider"));

      // Only ONE account is selectable -> straight to its models step,
      // never an account picker with a "Disabled" row to (mis)select.
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Enabled Model"));
      expect(frame).not.toContain("Select a provider account");
      expect(frame).not.toContain("Disabled");
      expect(frame).not.toContain("Disabled Model");

      mockInput.pressEnter();
      await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 3/4: Install"));

      expect(capturedEi).toBeDefined();
      const human = await capturedEi!.getHuman();
      // The disabled account itself is untouched (still present) — only
      // the onboarding PICKER excludes it; nothing here deletes accounts.
      expect(human.settings?.accounts).toHaveLength(2);
      // The written model can only have come from the enabled account —
      // resolveModelById() would reject the disabled one's GUID at runtime.
      expect(human.settings?.conversation_model).toBe("enabled-model-guid");
      expect(human.settings?.extraction_model).toBe("enabled-model-guid");
    } finally {
      await stopProcessorAndDestroy(renderer);

    }
  }, 20000);

  it("Install consent copy discloses Cursor's recent-memory injection when Cursor is detected (M1)", async () => {
    capturedEi = undefined;

    writeFileSync(join(testDataDir, "state.json"), JSON.stringify(makeCheckpoint({})));
    writeFileSync(join(testDataDir, "local.json"), JSON.stringify({ installed_version: pkg.version }));

    const detectIntegrations = async (): Promise<ImportSourceDetection> => ({
      claudeCode: false,
      cursor: true,
      codex: false,
      pi: false,
    });

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <TestProviders>
          <EiCapture />

          <OnboardingOverlay
            onDismiss={() => {}}
            detectedProviders={[]}
            isFirstBoot={false}
            dataPath={testDataDir}
            detectIntegrations={detectIntegrations}
            runHarnessInstall={() => runHarnessInstallImpl()}
          />
        </TestProviders>
      ),
      { width: 220, height: 34 }
    );

    try {
      let frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome back!"));
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/4: Provider"));
      mockInput.pressEscape(); // no accounts -> ProviderForm's create step -> skip
      await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped — no AI provider configured."));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Cursor"));
      expect(frame).toContain("[✓] found");
      expect(frame).toContain("Cursor: enabling this installs a hook that injects your recent Ei");
      expect(frame).toContain("context into Cursor's prompts on every request");
      expect(frame).toContain("to Cursor's configured model backend.");
    } finally {
      await stopProcessorAndDestroy(renderer);
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
