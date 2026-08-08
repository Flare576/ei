// Regression coverage for .sisyphus/issues/upgrade-prompt-dismiss-is-permanent.md.
//
// Coverage-check verdict (Beta, independently verified by Sisyphus): zero
// existing coverage of confirmUpgradeInstall()/dismissUpgradePrompt()'s
// end-to-end behavior existed before this file — onboarding-wiring.test.tsx
// and final-qa-upgrade-prompt-integration.test.tsx only ever exercised the
// DECLINE leg (and asserted the very bug this issue reports: that decline
// stamps the marker anyway); nothing exercised confirmUpgradeInstall() at
// all. Per that verdict, this file was written and run once BEFORE
// ei.tsx's fix landed to pin today's actual three-call-site sequencing —
// including the "hide always runs regardless of install result" behavior,
// which is correct by accident today (setShowUpgradePrompt(false) sits
// after the stamp call, not gated on it) and MUST keep holding once the
// stamp call is reordered/removed, so the fix can't silently change a
// third behavior nobody asserted.
//
// Concretely, run against the pre-fix code, the five
// "confirmUpgradeInstall / dismissUpgradePrompt — issue's regression oracle"
// cases below split as expected:
//   - the two hide-invariant assertions in the success/failure accept
//     cases passed (unaffected by the fix — pinned, not red).
//   - the notification-on-failure and installer-never-invoked-on-decline
//     assertions passed (also unaffected — pinned).
//   - the marker-value assertions in the decline, failed-accept, and
//     re-prompt-after-decline/failure cases FAILED red: pre-fix,
//     confirmUpgradeInstall() stamps unconditionally
//     (tui/src/context/ei.tsx:921, before the result.ok check at :923) and
//     dismissUpgradePrompt() stamps unconditionally with no install call
//     at all (:931) — exactly as the issue describes.
// After the fix (stamp moved behind `if (result.ok)` in confirm; stamp
// call deleted from dismiss), every case below passes, and reverting the
// fix reproduces the red state above — the trustworthy signal Flare's
// "red first" methodology asks for.
process.env.EI_E2E_MODE = "3";

import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Self-mock logger (matches onboarding-wiring.test.tsx / harness-install.test.ts
// convention) so this file is immune to mock.module() ordering with any
// sibling file in the same `bun test` batch.
mock.module("../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  interceptConsole: () => {},
}));

// Mock the DEEPEST dependency exclusive to harness-install.ts
// (harness-install.test.ts's own established pattern — see its header
// comment) rather than harness-install.ts itself: ei.tsx's real
// runHarnessInstall()/stampInstalled() stay real and under test, only the
// actual MCP-client filesystem writes (which would otherwise touch this
// machine's real ~/.claude, ~/.cursor, etc. per ADR-002) are stubbed.
// `../../../src/cli/install` is a project-local module nothing else in
// this file's `bun test` batch imports besides harness-install.ts itself,
// so there is nothing else in the process for this mock to leak into.
let installCallCount = 0;
let installShouldFail = false;
let sentinelPath = "";
mock.module("../../../src/cli/install", () => ({
  installMcpClients: async () => {
    installCallCount += 1;
    if (installShouldFail) {
      throw new Error("1 integration(s) failed to install: Sentinel Skill. See warnings above for details.");
    }
    if (sentinelPath) writeFileSync(sentinelPath, "NEW_SKILL_CONTENT");
  },
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(new Error("Real network fetch blocked during upgrade-prompt-dismiss-is-permanent test"))) as unknown as typeof fetch;

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

/** Boots a real EiProvider against `dataDir` and waits for the upgrade prompt to fire. */
async function bootAndWaitForPrompt(dataDir: string) {
  process.env.EI_DATA_PATH = dataDir;
  capturedEi = undefined;
  const { renderer } = await testRender(() => (
    <TestProviders>
      <EiCapture />
    </TestProviders>
  ));
  await waitUntil(() => capturedEi !== undefined && capturedEi.showUpgradePrompt());
  return { ei: capturedEi!, renderer };
}

/** Boots a real, fresh EiProvider against `dataDir` and settles its fire-and-forget upgrade check. */
async function bootAndSettle(dataDir: string) {
  process.env.EI_DATA_PATH = dataDir;
  capturedEi = undefined;
  const { renderer } = await testRender(() => (
    <TestProviders>
      <EiCapture />
    </TestProviders>
  ));
  await waitUntil(() => capturedEi !== undefined);
  await wait(400);
  return { ei: capturedEi!, renderer };
}

beforeEach(() => {
  installCallCount = 0;
  installShouldFail = false;
  sentinelPath = "";
});

describe("confirmUpgradeInstall / dismissUpgradePrompt — issue's regression oracle", () => {
  it("decline never invokes the installer, and leaves both the stale marker and the sentinel skill file untouched", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-upgrade-decline-"));
    cleanupDirs.push(dataDir);
    writeFileSync(join(dataDir, "state.json"), JSON.stringify(makeCheckpoint(makeExistingAccountSettings())));
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ installed_version: "0.0.1" }));
    sentinelPath = join(dataDir, "sentinel-skill.txt");
    writeFileSync(sentinelPath, "OLD_SKILL_CONTENT");

    const { ei, renderer } = await bootAndWaitForPrompt(dataDir);
    try {
      await ei.dismissUpgradePrompt();

      // Hides the current-session prompt only (does not change the marker).
      expect(ei.showUpgradePrompt()).toBe(false);
      // The installer must never run on decline.
      expect(installCallCount).toBe(0);
      expect(readFileSync(sentinelPath, "utf8")).toBe("OLD_SKILL_CONTENT");
      // The stale marker S must be left untouched, not cleared and not
      // stamped to the current version.
      expect(await getInstalledVersion(dataDir)).toBe("0.0.1");
    } finally {
      renderer.destroy();
    }
  }, 15000);

  it("a fresh provider/bootstrap against the same data path re-prompts after a decline, because the marker was never stamped", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-upgrade-decline-reboot-"));
    cleanupDirs.push(dataDir);
    writeFileSync(join(dataDir, "state.json"), JSON.stringify(makeCheckpoint(makeExistingAccountSettings())));
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ installed_version: "0.0.1" }));

    const first = await bootAndWaitForPrompt(dataDir);
    try {
      await first.ei.dismissUpgradePrompt();
    } finally {
      first.renderer.destroy();
    }
    await wait(150);

    const second = await bootAndSettle(dataDir);
    try {
      expect(second.ei.showUpgradePrompt()).toBe(true);
    } finally {
      second.renderer.destroy();
    }
  }, 20000);

  it("a successful accept invokes the installer, stamps the current version, and a fresh same-version boot stays quiet", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-upgrade-accept-ok-"));
    cleanupDirs.push(dataDir);
    writeFileSync(join(dataDir, "state.json"), JSON.stringify(makeCheckpoint(makeExistingAccountSettings())));
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ installed_version: "0.0.1" }));
    sentinelPath = join(dataDir, "sentinel-skill.txt");
    writeFileSync(sentinelPath, "OLD_SKILL_CONTENT");

    const { ei, renderer } = await bootAndWaitForPrompt(dataDir);
    try {
      await ei.confirmUpgradeInstall();

      // Pinned invariant (must survive the fix unchanged): the prompt
      // always hides once confirm resolves, regardless of install result.
      expect(ei.showUpgradePrompt()).toBe(false);
      expect(installCallCount).toBe(1);
      expect(readFileSync(sentinelPath, "utf8")).toBe("NEW_SKILL_CONTENT");
      expect(await getInstalledVersion(dataDir)).toBe(pkg.version);
      expect(ei.notification()).toBeNull();
    } finally {
      renderer.destroy();
    }

    await wait(150);
    const second = await bootAndSettle(dataDir);
    try {
      expect(second.ei.showUpgradePrompt()).toBe(false);
    } finally {
      second.renderer.destroy();
    }
  }, 20000);

  it("a failed/partial accept invokes the installer, warns, retains the stale marker, and a fresh boot re-prompts", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-upgrade-accept-fail-"));
    cleanupDirs.push(dataDir);
    writeFileSync(join(dataDir, "state.json"), JSON.stringify(makeCheckpoint(makeExistingAccountSettings())));
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ installed_version: "0.0.1" }));
    sentinelPath = join(dataDir, "sentinel-skill.txt");
    writeFileSync(sentinelPath, "OLD_SKILL_CONTENT");
    installShouldFail = true;

    const { ei, renderer } = await bootAndWaitForPrompt(dataDir);
    try {
      await ei.confirmUpgradeInstall();

      // Pinned invariant: hide still runs even though the install failed.
      expect(ei.showUpgradePrompt()).toBe(false);
      expect(installCallCount).toBe(1);
      // The installer failed before writing — sentinel stays stale too.
      expect(readFileSync(sentinelPath, "utf8")).toBe("OLD_SKILL_CONTENT");
      // "That install did not finish" must not be recorded as "done".
      expect(await getInstalledVersion(dataDir)).toBe("0.0.1");
      expect(ei.notification()?.level).toBe("warn");
      expect(ei.notification()?.message).toContain("Sentinel Skill");
    } finally {
      renderer.destroy();
    }

    await wait(150);
    const second = await bootAndSettle(dataDir);
    try {
      expect(second.ei.showUpgradePrompt()).toBe(true);
    } finally {
      second.renderer.destroy();
    }
  }, 20000);

  it("a version that merely differs from the installed marker always re-prompts, in either direction", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-upgrade-anydirection-"));
    cleanupDirs.push(dataDir);
    writeFileSync(join(dataDir, "state.json"), JSON.stringify(makeCheckpoint(makeExistingAccountSettings())));
    // A marker that is NOT "stale" in the older-than-current sense — pure
    // inequality, not a version-ordering comparison (shouldShowUpgradePrompt
    // is untouched by this fix and already correct here; this proves the
    // end-to-end wiring still delegates to it faithfully).
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ installed_version: "999.0.0" }));

    const { ei, renderer } = await bootAndSettle(dataDir);
    try {
      expect(ei.showUpgradePrompt()).toBe(true);
    } finally {
      renderer.destroy();
    }
  }, 15000);
});

afterAll(async () => {
  // Real delay, not a condition-poll: EiProvider's onCleanup -> processor.stop()
  // save chain is fire-and-forget with no promise this test can observe
  // (matches onboarding-wiring.test.tsx's own afterAll convention).
  await wait(150);
  for (const dir of cleanupDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  globalThis.fetch = realFetch;
});
