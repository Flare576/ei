/**
 * TUI E2E tests for /me fact new stub schema and name filtering.
 *
 * Uses a capture editor (exits immediately, no changes) to inspect the
 * YAML that the TUI would open in $EDITOR — verifying stub presence and
 * filter behaviour without modifying state.
 */
import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3124;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("me-stub-schema");
const CAPTURE_FILE = join(TEST_DATA_PATH, "yaml-capture.txt");
const CAPTURE_SCRIPT = join(TEST_DATA_PATH, "capture-editor.sh");

// ─────────────────────────────────────────────────────────────────────────────
// Module-level setup
// ─────────────────────────────────────────────────────────────────────────────

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });

writeFileSync(CAPTURE_SCRIPT, `#!/bin/bash\ncp "$1" "${CAPTURE_FILE}"\n`);
chmodSync(CAPTURE_SCRIPT, 0o755);

const ts = new Date().toISOString();
const checkpoint = {
  version: 1,
  timestamp: ts,
  human: {
    entity: "human",
    facts: [
      {
        id: "fact-coffee",
        name: "Coffee Preference",
        description: "Loves dark roast",
        sentiment: 0.9,
        validated_date: ts,
        last_updated: ts,
      },
      {
        id: "fact-tea",
        name: "Tea Preference",
        description: "Also enjoys green tea",
        sentiment: 0.7,
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
          verbal_response: "Hello! I'm ready for testing.",
          timestamp: ts,
          read: true,
          context_status: "default",
        },
      ],
    },
  },
  queue: [],
};

writeFileSync(join(TEST_DATA_PATH, "state.json"), JSON.stringify(checkpoint, null, 2));

const mockServer = new MockLLMServerImpl();
await mockServer.start(MOCK_PORT, { responses: {}, defaultDelay: 50, enableLogging: false });
mockServer.setResponseForType("response", {
  type: "fixed",
  content: JSON.stringify({ should_respond: true, verbal_response: "Test response", reason: "responding" }),
});

process.on("exit", () => { mockServer.stop().catch(() => {}); });
process.on("SIGINT", () => { mockServer.stop().then(() => process.exit(0)); });
process.on("SIGTERM", () => { mockServer.stop().then(() => process.exit(0)); });

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.use({
  program: { file: BUN_PATH, args: ["run", "dev"] },
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

test.describe("/me fact new — stub schema and filtering", () => {
  test("/me fact new opens editor with facts section and commented stub only", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/me fact new");
    terminal.submit();

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await expect(terminal.getByText("No changes made")).toBeVisible({ timeout: 8000 });

    expect(existsSync(CAPTURE_FILE)).toBe(true);
    const yaml = readFileSync(CAPTURE_FILE, "utf8");

    expect(yaml).toContain("facts:");
    expect(yaml).toContain("# --- New Fact (uncomment to create) ---");
    expect(yaml).toContain("# - name: ''");
    expect(yaml).not.toContain("topics:");
    expect(yaml).not.toContain("people:");
    expect(yaml).not.toContain("Coffee Preference");
  });

  test("/me fact coffee filters to matching facts only", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/me fact coffee");
    terminal.submit();

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await expect(terminal.getByText("No changes made")).toBeVisible({ timeout: 8000 });

    expect(existsSync(CAPTURE_FILE)).toBe(true);
    const yaml = readFileSync(CAPTURE_FILE, "utf8");

    expect(yaml).toContain("Coffee Preference");
    expect(yaml).not.toContain("Tea Preference");
    expect(yaml).toContain("# --- New Fact (uncomment to create) ---");
  });
});
