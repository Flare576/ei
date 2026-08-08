import { describe, it, expect, mock, afterAll } from "bun:test";
import { mkdtempSync } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Deterministic, network-free provider auto-detect for EiProvider's real
// bootstrap (see ei.tsx's finishBootstrap()). Without this, the fire-and-
// forget detection IIFE could race real localhost/cloud-provider probes on
// this dev machine and non-deterministically populate settings.accounts
// before the Provider step ever checks it. Must be set before ei.tsx is
// imported anywhere (transitively) in this process.
process.env.EI_E2E_MODE = "3";

const testDataDir = mkdtempSync(join(tmpdir(), "ei-onboarding-happy-"));
process.env.EI_DATA_PATH = testDataDir;

// Self-mock logger (matches editor.test.ts / layout.test.tsx / harness-install.test.ts
// convention) — registering our OWN factory makes this file immune to
// mock.module() ordering with any sibling file in the same `bun test` batch.
mock.module("../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  interceptConsole: () => {},
}));

import { getInstalledVersion } from "../../src/util/local-state";

// Test-controlled: `runHarnessInstall` is injected directly as a PROP
// (never mocked via bun:test's mock.module()) so it can never touch this
// machine's real ~/.claude, ~/.cursor, etc., and so it can't leak
// process-wide into harness-install.test.ts's own coverage of the real
// module when both run in the same `bun test` invocation (see notepad
// issues.md's T2/T11 entries on that exact class of mock.module() leak).
// `stampInstalled` is never mocked at all — the wizard's real Done step
// calls the real implementation, which always writes to a test-isolated
// $EI_DATA_PATH-scoped local.json, so the single-stamp-to-the-final-path
// assertions below prove real behavior end to end.
let runHarnessInstallImpl: () => Promise<{ ok: boolean; failures: string[] }> = async () => ({ ok: true, failures: [] });

// Hard safety net: this test must never make a real outbound network call.
// Flipping claudeCode.integration on (the Import step under test) wakes a
// REAL background Claude Code session sync + extraction-queue pipeline
// (reads this machine's actual ~/.claude/projects, by design — that's
// what "Import" means). That pipeline was independently observed
// (intermittently — a real, unexplained race, not reproduced deterministically)
// to resolve a model spec and attempt a real fetch() to api.anthropic.com
// using this machine's real ANTHROPIC_API_KEY. Root cause not fully
// isolated (see notepad issues.md); block ALL fetch for this file's
// lifetime as a deterministic guarantee regardless of the mechanism.
const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(new Error("Real network fetch blocked during OnboardingOverlay test"))) as unknown as typeof fetch;

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


function wait(ms = 20): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

// OpenTUI wraps long unbroken strings (e.g. real macOS temp-dir paths like
// /var/folders/.../ei-onboarding-newpath-XXXXXX) across box-drawing lines
// with no inserted separator — reconstruct by stripping border characters
// and joining trimmed lines directly, so a substring check tolerates the
// wrap regardless of exactly where it falls.
function dewrap(frame: string): string {
  return frame
    .split("\n")
    .map((line) => line.replace(/[┌┐└┘│─]/g, "").trim())
    .join("");
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
    if (predicate(frame)) {
      // Give any freshly-mounted child (e.g. an embedded ProviderForm) one
      // more tick to flush its onMount -> useKeyboard registration before
      // the caller's next simulated keypress fires.
      await wait(30);
      await renderOnce();
      return captureCharFrame();
    }
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

describe("OnboardingOverlay — happy path", () => {
  it("walks Welcome -> Provider -> Install -> Done, sets import flags via updateSettings, and stamps local.json exactly once", async () => {
    runHarnessInstallImpl = async () => ({ ok: true, failures: [] });

    const detectIntegrations = async (): Promise<ImportSourceDetection> => ({
      claudeCode: true,
      cursor: false,
      codex: false,
      pi: true,
    });

    let onDismissCalled = false;

    // Wide viewport: the wizard renders absolute filesystem paths (mkdtemp
    // temp dirs) inline in single-row status text (e.g. the Done screen's
    // "Data path: <path>" line). A real macOS/Linux tmp path plus its label
    // comfortably exceeds a narrow terminal's column count, which would
    // force a mid-string wrap/clip and break the exact-substring assertions
    // below. 220 columns gives every such line room to render unbroken.
    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <TestProviders>
          <EiCapture />
          <OnboardingOverlay
            onDismiss={() => {
              onDismissCalled = true;
            }}
            detectedProviders={[{ name: "Anthropic", detected: false }]}
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
      // --- Step 1: Welcome ---
      let frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome to Ei!"));
      expect(frame).toContain("Step 1/4: Welcome");

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/4: Provider"));

      // --- Step 2: Provider (skip via ProviderForm's own Escape-at-first-step) ---
      mockInput.pressEscape();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped — no AI provider configured."));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 3/4: Install"));
      expect(frame).toContain("Set up Skills, hooks, and harness integrations");
      expect(frame).toContain("MCP entry is removed");

      // --- Step 3: Install (detects two of four sources; confirming Yes
      // installs the harness AND sets the import flags together, from the
      // same one-question gate) ---
      expect(frame).toContain("Claude Code");
      expect(frame).toContain("[✓] found");
      expect(frame).toContain("Pi / OMP");
      expect(frame).toContain("Cursor");
      expect(frame).toContain("Codex");

      await mockInput.typeText("y");
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("installed."));
      expect(frame).toContain("✓ Skills, hooks, and harness integrations installed.");

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 4/4: Done"));
      expect(frame).toContain("You're all set!");
      expect(dewrap(frame)).toContain(`Data path: ${testDataDir}`);

      // --- Step 4: Done (dismiss) ---
      expect(onDismissCalled).toBe(false);
      mockInput.pressEnter();
      await waitForCondition(renderOnce, () => onDismissCalled);
      expect(onDismissCalled).toBe(true);

      const stamped = await getInstalledVersion(testDataDir);
      expect(stamped).toBe(pkg.version);

      // --- Install's single "yes" gate set BOTH the harness installer AND
      // the import flags, not a bulk import trigger ---
      expect(capturedEi).toBeDefined();
      const human = await capturedEi!.getHuman();
      expect(human.settings?.claudeCode?.integration).toBe(true);
      expect(human.settings?.pi?.integration).toBe(true);
      // codex is pre-seeded to `{ integration: false }` by the app's own
      // bootstrap (src/core/migrations.ts's seedSettings()) regardless of
      // this wizard; cursor is never seeded, so it stays undefined. Both
      // are the correct "not detected -> not flipped on" outcome — assert
      // on that (falsy), not on one specific absent-vs-false representation.
      expect(human.settings?.cursor?.integration).toBeFalsy();
      expect(human.settings?.codex?.integration).toBeFalsy();
    } finally {
      renderer.destroy();
    }
  }, 20000);
});

describe("OnboardingOverlay — failed install", () => {
  it("does not stamp installed_version when the install outcome is a failure", async () => {
    runHarnessInstallImpl = async () => ({ ok: false, failures: ["mcp install failed"] });

    const detectIntegrations = async (): Promise<ImportSourceDetection> => ({
      claudeCode: false,
      cursor: false,
      codex: false,
      pi: false,
    });

    // Own dataPath (distinct from the happy-path test's testDataDir) so a
    // stamp written here can never be confused with — or masked by — the
    // happy-path test's own stamp-to-the-same-file assertions.
    const failDataDir = mkdtempSync(join(tmpdir(), "ei-onboarding-failed-install-"));

    let onDismissCalled = false;

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <TestProviders>
          <OnboardingOverlay
            onDismiss={() => {
              onDismissCalled = true;
            }}
            detectedProviders={[{ name: "Anthropic", detected: false }]}
            isFirstBoot={true}
            dataPath={failDataDir}
            detectIntegrations={detectIntegrations}
            runHarnessInstall={() => runHarnessInstallImpl()}
          />
        </TestProviders>
      ),
      { width: 220, height: 34 }
    );

    try {
      // --- Step 1: Welcome ---
      let frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome to Ei!"));
      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/4: Provider"));

      // --- Step 2: Provider (skip via ProviderForm's own Escape-at-first-step) ---
      mockInput.pressEscape();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped — no AI provider configured."));

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 3/4: Install"));

      // --- Step 3: Install (confirm Yes, harness install reports failure) ---
      await mockInput.typeText("y");
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("failed to install"));
      expect(frame).toContain("✗ Some integrations failed to install: mcp install failed");

      mockInput.pressEnter();
      frame = await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 4/4: Done"));
      expect(frame).toContain("Install: failed (mcp install failed)");

      // --- Step 4: Done (dismiss) ---
      expect(onDismissCalled).toBe(false);
      mockInput.pressEnter();
      await waitForCondition(renderOnce, () => onDismissCalled);
      expect(onDismissCalled).toBe(true);

      // A failed install must never stamp installed_version — a stamped
      // marker here would suppress the re-prompt on next launch even
      // though skills/hooks never actually finished installing.
      const stamped = await getInstalledVersion(failDataDir);
      expect(stamped).toBeUndefined();
    } finally {
      renderer.destroy();
    }
  }, 20000);
});

afterAll(async () => {
  // renderer.destroy() triggers EiProvider's onCleanup -> processor.stop(),
  // which fire-and-forgets an async flush()/save()/atomicWrite() chain
  // against $EI_DATA_PATH. Give it a moment to settle before removing the
  // directory out from under it — otherwise that in-flight write can race
  // this rm() and surface as an unhandled rejection in a LATER test file.
  await wait(100);
  await rm(testDataDir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});
