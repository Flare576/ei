// REAL tui-test E2E coverage for the onboarding install-failure path.
// Tested by Beta — 2026-08-08.
//
// This test accepts the real installer only inside a sandboxed HOME and data
// path. A regular-file $HOME/.claude makes the real Claude Code hook setup
// fail, while the controlled PATH prevents host harness tools from being
// selected during integration detection or installation.
import { test, expect } from "@microsoft/tui-test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BUN_PATH } from "./fixtures.js";

const TEST_DATA_PATH = mkdtempSync(join(tmpdir(), "ei-final-qa-install-failure-data-"));
const TEST_HOME = mkdtempSync(join(tmpdir(), "ei-final-qa-install-failure-home-"));
const TEST_BIN_PATH = join(TEST_HOME, "bin");
const LOCAL_STATE_PATH = join(TEST_DATA_PATH, "local.json");

mkdirSync(TEST_BIN_PATH);
// The installer invokes only these utilities before the seeded .claude file
// makes its Claude Code step fail. Keeping PATH to this directory prevents a
// host Codex, Claude, Cursor, Pi, or OMP executable from being discovered.
symlinkSync(BUN_PATH, join(TEST_BIN_PATH, "bun"));
symlinkSync("/bin/mkdir", join(TEST_BIN_PATH, "mkdir"));
symlinkSync("/bin/test", join(TEST_BIN_PATH, "test"));

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

// A file rather than a directory forces the production installClaudeCodeHooks
// mkdir to fail. This is the real installer path, not an injected fake.
writeFileSync(join(TEST_HOME, ".claude"), "sandbox install failure blocker\n");
if (existsSync(LOCAL_STATE_PATH)) {
  throw new Error("Onboarding install-failure fixture must begin without local.json");
}

test.use({
  program: { file: BUN_PATH, args: ["run", "dev"] },
  rows: 34,
  columns: 220,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    HOME: TEST_HOME,
    PATH: TEST_BIN_PATH,
    TERM: "xterm-256color",
    EDITOR: "true",
    // Skip both provider auto-detection probes; the source-detection and
    // installer paths remain real and exercise the sandbox above.
    EI_E2E_MODE: "3",
  },
});

test("real installer failure reaches Done without stamping an install marker", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to Ei!")).toBeVisible({ timeout: 15000 });
  await expect(terminal.getByText("Step 1/4: Welcome")).toBeVisible({ timeout: 5000 });

  terminal.submit();
  await expect(terminal.getByText("Step 2/4: Provider")).toBeVisible({ timeout: 5000 });
  terminal.keyEscape();
  await expect(terminal.getByText("Skipped — no AI provider configured.")).toBeVisible({ timeout: 5000 });

  terminal.submit();
  await expect(terminal.getByText("Step 3/4: Install")).toBeVisible({ timeout: 5000 });
  await expect(terminal.getByText("Set up Skills, hooks, and harness integrations")).toBeVisible({ timeout: 5000 });

  terminal.write("y");
  await expect(terminal.getByText("Some integrations failed to install: Claude Code")).toBeVisible({ timeout: 15000 });

  terminal.submit();
  await expect(terminal.getByText("Step 4/4: Done")).toBeVisible({ timeout: 5000 });
  await expect(terminal.getByText("Install: failed (Claude Code)")).toBeVisible({ timeout: 5000 });

  terminal.submit();
  await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });

  const localState = existsSync(LOCAL_STATE_PATH)
    ? (JSON.parse(readFileSync(LOCAL_STATE_PATH, "utf8")) as { installed_version?: string })
    : undefined;
  expect(localState?.installed_version).toBeUndefined();
});
