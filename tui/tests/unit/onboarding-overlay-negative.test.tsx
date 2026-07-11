import { describe, it, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// See onboarding-overlay.test.tsx's happy-path file for the full rationale
// on each of these seams (E2E_MODE, logger self-mock, harness-install
// module swap). Duplicated here (rather than shared) because bun:test's
// mock.module() replaces a module process-wide for the whole `bun test`
// invocation — this file must self-register the same mocks to behave
// identically whether run alone or alongside its sibling.
process.env.EI_E2E_MODE = "3";

const testDataDir = mkdtempSync(join(tmpdir(), "ei-onboarding-negative-"));
process.env.EI_DATA_PATH = testDataDir;

mock.module("../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  interceptConsole: () => {},
}));

import { getInstalledVersion } from "../../src/util/local-state";

// Test-controlled: injected directly as a PROP, never via mock.module() —
// see onboarding-overlay.test.tsx's happy-path file for the full
// mock.module()-leak rationale.
let runHarnessInstallImpl: () => Promise<{ ok: boolean; failures: string[] }> = async () => {
  throw new Error("runHarnessInstall should never be called when Install is declined");
};

// Hard safety net — see onboarding-overlay.test.tsx's happy-path file for
// the full rationale. This file's detectIntegrations always returns all
// false, so claudeCode.integration is never flipped on here, but the
// guard costs nothing and keeps both files defensively consistent.
const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(new Error("Real network fetch blocked during OnboardingOverlay test"))) as unknown as typeof fetch;

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

function wait(ms = 20): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function waitForFrame(
  captureCharFrame: () => string,
  renderOnce: () => Promise<void>,
  predicate: (frame: string) => boolean,
  timeoutMs = 8000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await renderOnce();
    const frame = captureCharFrame();
    if (predicate(frame)) return frame;
    await wait(30);
  }
  throw new Error(`Timed out waiting for frame condition. Last frame:\n${captureCharFrame()}`);
}

describe("OnboardingOverlay — negative paths", () => {
  it("declining Install still completes the wizard and stamps; an invalid custom Data Path is rejected without writing anything", async () => {
    const notADirectory = join(testDataDir, "not-a-directory.txt");
    writeFileSync(notADirectory, "this is a file, not a directory");
    const originalFileContents = "this is a file, not a directory";

    const scratchHome = mkdtempSync(join(tmpdir(), "ei-onboarding-neg-home-"));

    const detectIntegrations = async (): Promise<ImportSourceDetection> => ({
      claudeCode: false,
      cursor: false,
      codex: false,
      pi: false,
    });

    let onDismissCalled = false;

    // Wide viewport — see onboarding-overlay.test.tsx's happy-path file for
    // why (long absolute tmp paths rendered inline on a single status row).
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
            shellProfileOptions={{ env: { SHELL: "/bin/zsh" }, home: scratchHome }}
            runHarnessInstall={() => runHarnessInstallImpl()}
          />
        </TestProviders>
      ),
      { width: 220, height: 34 }
    );

    try {
      // --- Welcome -> Install ---
      let frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome to Ei!"));
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/6: Install"));

      // --- Decline the Install confirm ('n' -> declined, no ConfirmOverlay involved) ---
      mockInput.pressKey("n");
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped"));
      expect(frame).toContain("Skipped — run this later via `ei --install` or `/onboarding`.");

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 3/6: Data Path"));

      // --- Try an invalid custom path: exists, but is a FILE, not a directory ---
      mockInput.pressKey("c");
      await renderOnce();
      await mockInput.typeText(notADirectory);
      await renderOnce();
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Not a directory"));
      expect(frame).toContain(`Not a directory: ${notADirectory}`);
      // Still on the editing sub-step — no transition to "result", no write attempted.
      expect(frame).toContain("Enter: validate | Esc: back");

      // Nothing was written to the rejected path.
      const fileContentsAfter = await Bun.file(notADirectory).text();
      expect(fileContentsAfter).toBe(originalFileContents);

      // Back out and continue with the unchanged (original) path.
      mockInput.pressEscape();
      await renderOnce();
      await wait(50);
      await renderOnce();
      frame = captureCharFrame();
      expect(frame).toContain("Step 3/6: Data Path");
      expect(frame).toContain(`Data path: ${testDataDir}`);

      mockInput.pressEnter(); // continue with unchanged path -> Provider
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 4/6: Provider"));

      // --- Skip Provider ---
      mockInput.pressEscape();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped — no AI provider configured."));
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 5/6: Import"));

      // --- Import: nothing detected ---
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("No supported integrations detected"));
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 6/6: Done"));
      expect(frame).toContain("Install: skipped");

      // --- Done: no crash, stamps despite the earlier decline ---
      mockInput.pressEnter();
      await renderOnce();
      await wait();
      expect(onDismissCalled).toBe(true);

      const stamped = await getInstalledVersion(testDataDir);
      expect(stamped).toBe(pkg.version);

      await rm(scratchHome, { recursive: true, force: true });
    } finally {
      renderer.destroy();
    }
  }, 20000);
});

afterAll(async () => {
  // See onboarding-overlay.test.tsx's afterAll for why the delay is here:
  // EiProvider's async stop()/flush()/save() chain can still be in flight
  // when this runs.
  await wait(100);
  await rm(testDataDir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});
