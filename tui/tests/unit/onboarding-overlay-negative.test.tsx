import { describe, it, expect, mock, afterAll } from "bun:test";
import { mkdtempSync } from "fs";
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
let runHarnessInstallCalls = 0;
let runHarnessInstallImpl: () => Promise<{ ok: boolean; failures: string[] }> = async () => {
  runHarnessInstallCalls += 1;
  return { ok: true, failures: [] };
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
import { EiProvider, useEi, type EiContextValue } from "../../src/context/ei";
import { KeyboardProvider } from "../../src/context/keyboard";
import { OverlayProvider } from "../../src/context/overlay";
import { OnboardingOverlay, type ImportSourceDetection } from "../../src/components/OnboardingOverlay";

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

async function waitForCondition(
  renderOnce: () => Promise<void>,
  predicate: () => boolean,
  timeoutMs = 8000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await renderOnce();
    if (predicate()) return;
    await wait(30);
  }
  throw new Error("Timed out waiting for condition");
}

describe("OnboardingOverlay — negative paths", () => {
  it("declining Install still completes the wizard without stamping; detected sources are never flagged on when Install is declined", async () => {
    runHarnessInstallCalls = 0;

    runHarnessInstallImpl = async () => {
      runHarnessInstallCalls += 1;
      return { ok: true, failures: [] };
    };

    const detectIntegrations = async (): Promise<ImportSourceDetection> => ({
      claudeCode: true,
      cursor: false,
      codex: false,
      pi: true,
    });

    let onDismissCalled = false;

    // Wide viewport — see onboarding-overlay.test.tsx's happy-path file for
    // why (long absolute tmp paths rendered inline on a single status row).
    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <TestProviders>
          <EiCapture />
          <OnboardingOverlay
            onDismiss={() => {
              onDismissCalled = true;
            }}
            detectedProviders={[]}
            isFirstBoot={true}
            dataPath={testDataDir}
            detectIntegrations={detectIntegrations}
            runHarnessInstall={() => runHarnessInstallImpl()}
          />
        </TestProviders>
      ),
      { width: 220, height: 34 }
    );

    try {
      // --- Welcome -> Provider (skip) ---
      let frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome to Ei!"));
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/4: Provider"));
      mockInput.pressEscape();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped — no AI provider configured."));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 3/4: Install"));
      // Sources ARE detected here — proves the decline below withholds the
      // flags rather than there being nothing to withhold in the first place.
      expect(frame).toContain("Claude Code");
      expect(frame).toContain("[✓] found");
      expect(frame).toContain("Pi / OMP");

      // --- Decline the merged Install/Import confirm ('n' -> declined, no ConfirmOverlay involved) ---
      mockInput.pressKey("n");
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped"));
      expect(frame).toContain("Skipped — run this later via `ei --install` or `/onboarding`.");

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 4/4: Done"));
      expect(frame).toContain("Install: skipped");

      // --- Done: no crash, does NOT stamp — the user explicitly declined
      // to install, so the marker must stay unset (per
      // onboarding-wizard-stamps-install-unconditionally.md: only a
      // successful install stamps) and the "run this later" copy above
      // stays true. ---
      mockInput.pressEnter();
      await waitForCondition(renderOnce, () => onDismissCalled);
      expect(onDismissCalled).toBe(true);

      const stamped = await getInstalledVersion(testDataDir);
      expect(stamped).toBeUndefined();

      // --- Declining withheld the import flags too, even though Claude
      // Code and Pi were genuinely detected above — the one 'n' gates both
      // the installer and the flag write together. ---
      expect(capturedEi).toBeDefined();
      const human = await capturedEi!.getHuman();
      expect(human.settings?.claudeCode?.integration).toBeFalsy();
      expect(human.settings?.pi?.integration).toBeFalsy();
      expect(runHarnessInstallCalls).toBe(0);
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
