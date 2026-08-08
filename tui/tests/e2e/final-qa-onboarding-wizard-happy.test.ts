// THROWAWAY QA ARTIFACT — Final Verification Wave, item F3 (Beta).
// Tested by Beta — 2026-08-08.
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
// is actually visible, do its own step-navigation mechanics (provider skip,
// install confirm/decline) genuinely work end to end against a real
// terminal, real keyboard events, and a real child process — not just
// bun:test's SolidJS-only render tree?
//
// Wizard order as of the onboarding-polish rework: Welcome -> Provider ->
// Install -> Done (4 steps; the old, always-redundant Data Path step is
// gone — Ei already fails fast with actionable tips at boot, before the
// wizard can ever render, if EI_DATA_PATH is unwritable — and the old
// Import step is folded into Install: one y/N now gates both the harness
// installer AND the source-detection settings write together).
//
// Runs through Provider (skip, no accounts configured) and Install
// (decline, 'n') through Done and normal application readiness. Declining
// Install is safe here: integration flags are now only ever written from
// inside the Install step's explicit 'y' branch (runInstallYes), never as a
// side effect of detection alone. Detection itself
// (defaultDetectImportSources) is real and unmocked in this PTY — there's no
// prop-injection seam across a black-box child process — but it now runs
// eagerly on mount regardless of which step is showing, same as the
// pre-existing account-fetch. That's fine: it's read-only (file-existence
// checks + one `codex --version` spawn), never a write. The write this file
// must still never trigger is the real installMcpClients() install / the
// real integration-flag write, both gated behind Install's 'y' — which this
// test only ever declines.
// (Per the project notepad's T12 entry, flipping a real integration flag
// on this machine has independently, intermittently woken a real
// background sync/extraction pipeline that hits api.anthropic.com with a
// real API key — a disclosed, pre-existing, out-of-scope risk this QA pass
// must not itself trigger.)
import { test, expect } from "@microsoft/tui-test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { BUN_PATH } from "./fixtures.js";

const TEST_DATA_PATH = `/tmp/ei-final-qa-happy-${process.pid}-${Date.now()}`;
rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });

// Keep the fixture's per-machine marker absent so the post-finish assertion
// proves the declined install did not create it.
const LOCAL_STATE_PATH = join(TEST_DATA_PATH, "local.json");
if (existsSync(LOCAL_STATE_PATH)) {
  throw new Error("Onboarding decline fixture must begin without local.json");
}
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

test("fresh first boot at an adequate terminal width: declining installation completes the wizard without stamping an install marker", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to Ei!")).toBeVisible({ timeout: 15000 });
  await expect(terminal.getByText("Step 1/4: Welcome")).toBeVisible({ timeout: 5000 });

  terminal.submit(); // any key -> advance to Provider
  await expect(terminal.getByText("Step 2/4: Provider")).toBeVisible({ timeout: 5000 });

  // ProviderForm mounts for real (no accounts configured) — Escape at its
  // first field skips, matching onboarding-overlay-negative.test.tsx's
  // established bun:test coverage of the exact same affordance.
  terminal.keyEscape();
  await expect(terminal.getByText("Skipped — no AI provider configured.")).toBeVisible({ timeout: 5000 });

  terminal.submit();
  await expect(terminal.getByText("Step 3/4: Install")).toBeVisible({ timeout: 5000 });
  await expect(terminal.getByText("Set up Skills, hooks, and harness integrations")).toBeVisible({ timeout: 5000 });

  // Decline — never invoke the real installer, and never write a real
  // integration flag, on this machine.
  terminal.write("n");
  await expect(terminal.getByText(/Skipped — run this later/gi)).toBeVisible({ timeout: 5000 });

  terminal.submit();
  await expect(terminal.getByText("Step 4/4: Done")).toBeVisible({ timeout: 5000 });
  await expect(terminal.getByText("Install: skipped")).toBeVisible({ timeout: 5000 });

  terminal.submit();
  await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });

  const localState = existsSync(LOCAL_STATE_PATH)
    ? (JSON.parse(readFileSync(LOCAL_STATE_PATH, "utf8")) as { installed_version?: string })
    : undefined;
  expect(localState?.installed_version).toBeUndefined();
});
