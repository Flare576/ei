// THROWAWAY QA ARTIFACT — Final Verification Wave, item F3 (Beta).
// Not a plan deliverable.
//
// REAL tui-test E2E happy-path drive of the onboarding wizard through a
// genuine PTY under Node 20 (per Main's live confirmation that tui-test
// itself works fine here, and their explicit ask for one real PTY-driven
// scenario modeled on provider-command.test.ts's structure, rather than
// bun:test-only component-tree coverage).
//
// Run at columns:220 (matching onboarding-overlay.test.tsx's bun:test
// viewport) — see the sibling final-qa-onboarding-width-regression.test.ts
// for the real finding that this repo's OWN standard e2e width (100
// columns) makes the wizard entirely invisible. This file exists to answer
// a DIFFERENT question, in isolation from that layout bug: once the wizard
// is actually visible, do its own step-navigation mechanics (confirm/decline,
// path validation, provider skip) genuinely work end to end against a real
// terminal, real keyboard events, and a real child process — not just
// bun:test's SolidJS-only render tree?
//
// Deliberately stops right after the Provider step (does NOT press Enter to
// advance into Import). This is a REAL, unmocked child process — there is
// no way to inject a fake `detectIntegrations`/`runHarnessInstall` prop
// through a black-box PTY the way the bun:test component tests do.
// Advancing into the Import step here would run the REAL
// defaultDetectImportSources() against this literal dev machine (which has
// real Claude Code project data) and could flip a real integration flag on,
// which the project's own notepad (.sisyphus/notepads/.../issues.md, T12
// entry) documents as having independently, intermittently woken a real
// background sync/extraction pipeline that attempts a real fetch() to
// api.anthropic.com using a real API key. That is a disclosed, pre-existing,
// out-of-scope risk this QA pass must not itself trigger as a side effect —
// so Install is also always declined ('n'), never invoking the real
// installMcpClients() side effects on this machine.
import { test, expect } from "@microsoft/tui-test";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { BUN_PATH } from "./fixtures.js";

const TEST_DATA_PATH = `/tmp/ei-final-qa-happy-${process.pid}-${Date.now()}`;
rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
const timestamp = new Date().toISOString();
writeFileSync(
  join(TEST_DATA_PATH, "state.json"),
  JSON.stringify({
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
      settings: { auto_save_interval_ms: 999999999 },
    },
    personas: {},
    queue: [],
  })
);

test.use({
  program: { file: BUN_PATH, args: ["run", "dev"] },
  rows: 34,
  columns: 220,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
    // Skip BOTH local and cloud provider auto-detect probes (see
    // tui/src/util/e2e-flags.ts) — deterministic, and defense in depth
    // against this real dev machine's real env vars triggering a real
    // cloud-provider /models probe during the Provider-detection IIFE that
    // runs ahead of the wizard showing.
    EI_E2E_MODE: "3",
  },
});

test("fresh first boot at an adequate terminal width: the wizard renders and real keyboard-driven navigation actually works", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to Ei!")).toBeVisible({ timeout: 15000 });
  await expect(terminal.getByText("Step 1/6: Welcome")).toBeVisible({ timeout: 5000 });

  terminal.submit(); // any key -> advance to Install
  await expect(terminal.getByText("Step 2/6: Install")).toBeVisible({ timeout: 5000 });
  await expect(terminal.getByText("Set up recommended Skills")).toBeVisible({ timeout: 5000 });

  // Decline — never invoke the real installer on this machine.
  terminal.write("n");
  await expect(terminal.getByText(/Skipped — run this later/gi)).toBeVisible({ timeout: 5000 });

  terminal.submit();
  await expect(terminal.getByText("Step 3/6: Data Path")).toBeVisible({ timeout: 5000 });
  await expect(terminal.getByText(`Data path: ${TEST_DATA_PATH}`)).toBeVisible({ timeout: 5000 });

  // Continue without changing the path.
  terminal.submit();
  await expect(terminal.getByText("Step 4/6: Provider")).toBeVisible({ timeout: 5000 });

  // ProviderForm mounts for real (no accounts configured) — Escape at its
  // first field skips, matching onboarding-overlay-negative.test.tsx's
  // established bun:test coverage of the exact same affordance.
  terminal.keyEscape();
  await expect(terminal.getByText("Skipped — no AI provider configured.")).toBeVisible({ timeout: 5000 });

  // Deliberately stop here — see the file header for why we never
  // advance into the real Import step in an unmocked child process.
});
