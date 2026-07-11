// THROWAWAY QA ARTIFACT — Final Verification Wave, item F3 (Beta).
// Not a plan deliverable. Exercises scenario 6 of the F3 assignment:
// "Install failure non-fatal: force `runHarnessInstall` to report
// `{ok:false}` — confirm the wizard still completes and stamps."
//
// Gap this closes: harness-install.test.ts unit-tests runHarnessInstall's
// own {ok:false} return shape in isolation (mocking installMcpClients
// throwing), and onboarding-overlay-negative.test.tsx covers DECLINING the
// Install step ('n' -> never calls runHarnessInstall at all). Neither
// exercises the Install step's OWN failure-rendering branch
// (installOutcome.status === "failed") through a live OnboardingOverlay,
// nor proves the wizard still reaches Done and stamps local.json when the
// user says "yes, install" and the injected installer genuinely fails.
process.env.EI_E2E_MODE = "3";

import { mkdtempSync } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const testDataDir = mkdtempSync(join(tmpdir(), "ei-final-qa-installfail-"));
process.env.EI_DATA_PATH = testDataDir;

import { describe, it, expect, mock, afterAll } from "bun:test";

mock.module("../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  interceptConsole: () => {},
}));

import { getInstalledVersion } from "../../src/util/local-state";

let runHarnessInstallImpl: () => Promise<{ ok: boolean; failures: string[] }> = async () => ({
  ok: false,
  failures: ["Claude Code", "Cursor"],
});

const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(new Error("Real network fetch blocked during final-qa-onboarding-install-failure test"))) as unknown as typeof fetch;

import { testRender } from "@opentui/solid";
import type { ParentComponent } from "solid-js";
import { EiProvider } from "../../src/context/ei";
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

// NOTE on real-clock waits below: this file drives a real SolidJS render
// tree (testRender) whose OnboardingOverlay mounts real onMount fire-and-
// forget async work under Solid's own reactive scheduler; there is no
// fake-timer substitute for "has this real async effect settled" here —
// see onboarding-overlay.test.tsx's own established convention for the
// same reason. `waitForFrame` below polls a REAL, concrete predicate (the
// rendered frame) on each tick rather than guessing a fixed duration.
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

describe("Final QA — OnboardingOverlay Install step: genuine installer failure is non-fatal", () => {
  it("Install reports {ok:false, failures:[...]} -> wizard shows the failure, still reaches Done, still stamps local.json", async () => {
    const detectIntegrations = async (): Promise<ImportSourceDetection> => ({
      claudeCode: false,
      cursor: false,
      codex: false,
      pi: false,
    });

    let onDismissCalled = false;

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <TestProviders>
          <OnboardingOverlay
            onDismiss={() => {
              onDismissCalled = true;
            }}
            detectedProviders={[]}
            isFirstBoot={true}
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
      let frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome to Ei!"));
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/6: Install"));

      // --- Confirm "Yes" -> the injected installer genuinely fails ---
      await mockInput.typeText("y");
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Some integrations failed to install"));
      expect(frame).toContain("✗ Some integrations failed to install: Claude Code, Cursor");
      // Non-fatal: the wizard is still in a navigable "result" phase, not
      // crashed/stuck — the continue affordance is present.
      expect(frame).toContain("Enter: continue");

      // --- The failure does NOT block progression ---
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 3/6: Data Path"));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 4/6: Provider"));
      mockInput.pressEscape(); // skip provider
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped — no AI provider configured."));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 5/6: Import"));
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("No supported integrations detected"));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 6/6: Done"));
      // Done step's summary correctly reflects the failure, not a false "installed".
      expect(frame).toContain("Install: failed (Claude Code, Cursor)");

      // --- Finish: still completes and stamps despite the failed install ---
      expect(onDismissCalled).toBe(false);
      mockInput.pressEnter();
      await renderOnce();
      await waitUntil(() => onDismissCalled);
      expect(onDismissCalled).toBe(true);

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
  // matches onboarding-overlay.test.tsx's afterAll for the same reason.
  await wait(150);
  await rm(testDataDir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});
