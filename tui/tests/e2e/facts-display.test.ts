/**
 * TUI E2E tests for built-in fact display and YAML format validation.
 *
 * Uses a "capture" editor that copies the YAML to a side-file before the TUI
 * reads it back. That lets us inspect what was written without modifying it
 * (so content === null → "No changes made").
 *
 * Covers:
 *   - Built-in facts appear in /me facts view (Full Name in YAML)
 *   - YAML output has no legacy `validated:` field (ValidationLevel removed)
 *   - YAML output still has `validated_date:` field (new format)
 */
import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3120;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("facts-display");
const CAPTURE_FILE = join(TEST_DATA_PATH, "yaml-capture.txt");
const CAPTURE_SCRIPT = join(TEST_DATA_PATH, "capture-editor.sh");

// ─────────────────────────────────────────────────────────────────────────────
// Module-level setup (runs once before terminals spawn)
// ─────────────────────────────────────────────────────────────────────────────

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });

// Write the capture editor script: copies YAML to side-file, exits without modifying
writeFileSync(
  CAPTURE_SCRIPT,
  `#!/bin/bash\ncp "$1" "${CAPTURE_FILE}"\n`
);
chmodSync(CAPTURE_SCRIPT, 0o755);

// Checkpoint: "Full Name" (built-in) already seeded with description
const ts = new Date().toISOString();
const checkpoint = {
  version: 1,
  timestamp: ts,
  human: {
    entity: "human",
    facts: [
      {
        id: "builtin-full-name",
        name: "Full Name",
        description: "John Doe",
        confidence: 0.9,
        sentiment: 0,
        validated_date: ts,
        last_updated: ts,
      },
    ],
    traits: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: ts,
    last_activity: ts,
    settings: createTestSettings(MOCK_SERVER_URL),
  },
  personas: {
    ei: {
      entity: {
        entity: "system",
        id: "ei",
        display_name: "Ei",
        aliases: ["Ei"],
        short_description: "Test companion",
        long_description: "A test companion",
        traits: [],
        topics: [],
        facts: [],
        people: [],
        is_paused: false,
        is_archived: false,
        is_static: false,
        last_updated: ts,
        last_activity: ts,
        last_heartbeat: ts,
        heartbeat_delay_ms: 999999999,
      },
      messages: [
        {
          id: "msg-1",
          role: "system",
          content: "Hello! I'm ready for testing.",
          timestamp: ts,
          read: true,
          context_status: "default",
        },
      ],
    },
  },
  queue: [],
};

const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

// Mock server
const mockServer = new MockLLMServerImpl();
await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: false,
});

mockServer.setResponseForType("response", {
  type: "fixed",
  content: JSON.stringify({
    should_respond: true,
    content: "Test response",
    reason: "responding",
  }),
});

process.on("exit", () => { mockServer.stop().catch(() => {}); });
process.on("SIGINT", () => { mockServer.stop().then(() => process.exit(0)); });
process.on("SIGTERM", () => { mockServer.stop().then(() => process.exit(0)); });

// ─────────────────────────────────────────────────────────────────────────────
// Test configuration: uses capture editor
// ─────────────────────────────────────────────────────────────────────────────

test.use({
  program: {
    file: BUN_PATH,
    args: ["run", "dev"],
  },
  rows: 30,
  columns: 120,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: CAPTURE_SCRIPT,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("/me facts — Built-in Display and YAML Format", () => {
  test("built-in facts appear in /me facts YAML output", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/me facts");
    terminal.submit();

    // Capture editor exits immediately (no changes → "No changes made")
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 8000 });

    // The capture script writes the YAML to CAPTURE_FILE before the TUI reads it back
    expect(existsSync(CAPTURE_FILE)).toBe(true);

    const capturedYaml = readFileSync(CAPTURE_FILE, "utf8");

    // "Full Name" (built-in) must appear in the facts section
    expect(capturedYaml).toContain("name: Full Name");

    // The full description we seeded should be there
    expect(capturedYaml).toContain("John Doe");
  });

  test("YAML output has no legacy validated: field (ValidationLevel removed)", async ({
    terminal,
  }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/me facts");
    terminal.submit();

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 8000 });

    expect(existsSync(CAPTURE_FILE)).toBe(true);
    const capturedYaml = readFileSync(CAPTURE_FILE, "utf8");

    // Must NOT contain the old `validated:` enum field (e.g. "validated: 0" / "validated: None")
    // Note: `validated_date:` is the new field and IS expected to be present
    expect(capturedYaml).not.toMatch(/^\s+validated:\s/m);

    // Must still contain the new validated_date field
    expect(capturedYaml).toContain("validated_date:");
  });
});
