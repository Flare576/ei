// Pi and OMP are separate integrations at onboarding: detected apart, offered as
// two entries, and each enabled without touching the other or the importer's
// own `settings.omp` runtime fields.
process.env.EI_E2E_MODE = "3";

import { describe, it, expect, mock, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const testDataDir = mkdtempSync(join(tmpdir(), "ei-onboarding-omp-"));
process.env.EI_DATA_PATH = testDataDir;

// Enabling an integration wakes its real importer, which reads session files
// under $HOME. Point HOME at an empty directory for this whole file so nothing
// outside the temp directories is ever read.
const realHome = process.env.HOME;
const testHome = mkdtempSync(join(tmpdir(), "ei-onboarding-omp-emptyhome-"));
process.env.HOME = testHome;

mock.module("../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  interceptConsole: () => {},
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(new Error("Real network fetch blocked during onboarding-omp-integration test"))) as unknown as typeof fetch;

import { testRender } from "@opentui/solid";
import type { ParentComponent } from "solid-js";
import { EiProvider, useEi, type EiContextValue } from "../../src/context/ei";
import { KeyboardProvider } from "../../src/context/keyboard";
import { OverlayProvider } from "../../src/context/overlay";
import {
  OnboardingOverlay,
  defaultDetectImportSources,
  type ImportSourceDetection,
} from "../../src/components/OnboardingOverlay";

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
  let frame = captureCharFrame();
  while (!predicate(frame) && Date.now() - start < timeoutMs) {
    await renderOnce();
    await wait(20);
    frame = captureCharFrame();
  }
  if (!predicate(frame)) throw new Error(`Timed out waiting for frame predicate. Last frame:\n${frame}`);
  return frame;
}

/** Stop the processor first so its save cannot land over the next test's state.json. */
async function stopProcessorAndDestroy(renderer: { destroy: () => void }): Promise<void> {
  try {
    if (!capturedEi) throw new Error("EiProvider context was not captured before teardown");
    await capturedEi.stopProcessor();
  } finally {
    renderer.destroy();
  }
}

function writeState(settings: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  writeFileSync(
    join(testDataDir, "state.json"),
    JSON.stringify({
      version: 1,
      timestamp,
      human: { entity: "human", facts: [], traits: [], topics: [], people: [], quotes: [], last_updated: timestamp, settings },
      personas: {},
      queue: [],
    })
  );
}

const noneDetected: ImportSourceDetection = { claudeCode: false, cursor: false, codex: false, pi: false, omp: false };

/** Renders the real overlay on `settings`, walks to the Install step and returns the frame, driver and renderer. */
async function walkToInstall(detection: ImportSourceDetection, settings: Record<string, unknown>) {
  capturedEi = undefined;
  writeState(settings);

  const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
    () => (
      <TestProviders>
        <EiCapture />
        <OnboardingOverlay
          onDismiss={() => {}}
          detectedProviders={[]}
          isFirstBoot={false}
          dataPath={testDataDir}
          detectIntegrations={async () => detection}
          runHarnessInstall={async () => ({ ok: true, failures: [] })}
        />
      </TestProviders>
    ),
    { width: 220, height: 34 }
  );

  await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Welcome back!"));
  mockInput.pressEnter();
  await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Step 2/4: Provider"));
  mockInput.pressEscape();
  await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("Skipped — no AI provider configured."));
  mockInput.pressEnter();
  const frame = await waitForFrame(
    captureCharFrame,
    renderOnce,
    (f) => f.includes("Step 3/4: Install") && (f.includes("found") || f.includes("No supported"))
  );
  return { frame, renderOnce, mockInput, captureCharFrame, renderer };
}

const ompRuntime = {
  integration: false,
  polling_interval_ms: 120000,
  extraction_model: "some-model-guid",
  last_sync: "2026-10-20T10:00:00.000Z",
  processed_sessions: { "tree-a": "2026-10-19T00:00:00.000Z" },
  current_tree: { tree: "tree-b", planned_at: "2026-10-20T09:00:00.000Z", done: ["blk-1"] },
};
const piRuntime = {
  integration: false,
  polling_interval_ms: 90000,
  last_sync: "2026-10-18T10:00:00.000Z",
  processed_sessions: { "/pi/session.jsonl": "2026-10-18T09:00:00.000Z" },
};

describe("defaultDetectImportSources - Pi and OMP evidence", () => {
  const cases: Array<{ name: string; files: string[]; pi: boolean; omp: boolean }> = [
    { name: "only OMP evidence", files: [".omp/agent/auth.json"], pi: false, omp: true },
    { name: "only Pi evidence", files: [".pi/agent/settings.json"], pi: true, omp: false },
    { name: "both", files: [".pi/agent/auth.json", ".omp/agent/config.yml"], pi: true, omp: true },
    { name: "neither", files: [], pi: false, omp: false },
  ];

  for (const c of cases) {
    it(`reports ${c.name} independently`, async () => {
      const home = mkdtempSync(join(tmpdir(), "ei-onboarding-omp-home-"));
      const realHome = process.env.HOME;
      try {
        for (const file of c.files) {
          mkdirSync(join(home, file, ".."), { recursive: true });
          writeFileSync(join(home, file), "");
        }
        process.env.HOME = home;
        const detection = await defaultDetectImportSources();
        expect(detection.pi).toBe(c.pi);
        expect(detection.omp).toBe(c.omp);
      } finally {
        process.env.HOME = realHome;
        await rm(home, { recursive: true, force: true });
      }
    });
  }
});

describe("OnboardingOverlay - Pi and OMP offer", () => {
  const cases: Array<{ name: string; pi: boolean; omp: boolean }> = [
    { name: "Pi only", pi: true, omp: false },
    { name: "OMP only", pi: false, omp: true },
    { name: "both", pi: true, omp: true },
  ];

  for (const c of cases) {
    it(`lists Pi and OMP as separate entries with their own state when ${c.name} is detected`, async () => {
      const { frame, renderer } = await walkToInstall({ ...noneDetected, pi: c.pi, omp: c.omp }, {});
      try {
        const lineOf = (label: string) => frame.split("\n").find((l) => l.includes(label)) ?? "";
        expect(frame).not.toContain("Pi / OMP");
        expect(lineOf("Pi:")).toContain(c.pi ? "[✓] found" : "[ ] not found");
        expect(lineOf("OMP:")).toContain(c.omp ? "[✓] found" : "[ ] not found");
        expect(lineOf("Pi:")).not.toContain("OMP");
      } finally {
        await stopProcessorAndDestroy(renderer);
      }
    }, 20000);
  }

  it("shows the no-supported-tool text, not a Pi or OMP row, when neither is detected", async () => {
    const { frame, renderer } = await walkToInstall(noneDetected, {});
    try {
      expect(frame).toContain("No supported coding tools detected on this machine.");
      expect(frame).not.toContain("Pi:");
      expect(frame).not.toContain("OMP:");
    } finally {
      await stopProcessorAndDestroy(renderer);
    }
  }, 20000);
});

describe("OnboardingOverlay - Pi and OMP enablement", () => {
  // Records an immutable copy of each payload handed to the real updateSettings,
  // before it runs, so the importer's later `last_sync` advance cannot rewrite it.
  async function confirmInstall(detection: ImportSourceDetection, settings: Record<string, unknown>) {
    const { renderOnce, mockInput, captureCharFrame, renderer } = await walkToInstall(detection, settings);
    const ei = capturedEi!;
    const realUpdateSettings = ei.updateSettings;
    const payloads: unknown[] = [];
    ei.updateSettings = (updates) => {
      payloads.push(structuredClone(updates));
      return realUpdateSettings.call(ei, updates);
    };
    try {
      await mockInput.typeText("y");
      await waitForFrame(captureCharFrame, renderOnce, (f) => f.includes("installed."));
      return { payloads, human: await ei.getHuman() };
    } finally {
      ei.updateSettings = realUpdateSettings;
      await stopProcessorAndDestroy(renderer);
    }
  }

  // The enabled integration's own importer may advance `last_sync` after the write,
  // so the persisted value is only required not to move backwards; the exact seed is
  // asserted on the payload captured at the write boundary.

  it("OMP only: writes omp.integration true, keeps settings.omp's runtime fields and writes nothing to pi", async () => {
    const { payloads, human } = await confirmInstall({ ...noneDetected, omp: true }, { omp: ompRuntime, pi: piRuntime });

    expect(payloads).toEqual([{ omp: { ...ompRuntime, integration: true } }]);
    expect(human.settings?.omp).toEqual({ ...ompRuntime, integration: true, last_sync: expect.any(String) });
    expect(Date.parse(human.settings!.omp!.last_sync as string)).toBeGreaterThanOrEqual(Date.parse(ompRuntime.last_sync));
    expect(human.settings?.pi).toEqual(piRuntime);
  }, 20000);

  it("Pi only: writes pi.integration true and writes nothing to omp", async () => {
    const { payloads, human } = await confirmInstall({ ...noneDetected, pi: true }, { omp: ompRuntime, pi: piRuntime });

    expect(payloads).toEqual([{ pi: { ...piRuntime, integration: true } }]);
    expect(human.settings?.pi).toEqual({ ...piRuntime, integration: true, last_sync: expect.any(String) });
    expect(Date.parse(human.settings!.pi!.last_sync as string)).toBeGreaterThanOrEqual(Date.parse(piRuntime.last_sync));
    expect(human.settings?.omp).toEqual(ompRuntime);
  }, 20000);
});

afterAll(async () => {
  // EiProvider's cleanup save chain is fire-and-forget; give it real time to
  // settle before the data directory is removed.
  await wait(150);
  await rm(testDataDir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
  process.env.HOME = realHome;
  await rm(testHome, { recursive: true, force: true });
});
