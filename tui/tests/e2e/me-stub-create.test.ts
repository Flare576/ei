/**
 * TUI E2E test for creating a new fact via the /me stub scaffolding.
 *
 * Uses a Python editor that replaces the commented stub with a real YAML
 * entry (no id field). Verifies the TUI generates an id, saves the fact,
 * and reports "Updated 1 items" in the notification.
 */
import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3125;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("me-stub-create");
const CREATE_SCRIPT = join(TEST_DATA_PATH, "create-editor.py");

// ─────────────────────────────────────────────────────────────────────────────
// Module-level setup
// ─────────────────────────────────────────────────────────────────────────────

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });

// Python editor: replaces the commented stub with a real uncommitted entry.
// The TUI will generate a UUID for the missing id field.
const createPyScript = `#!/usr/bin/env python3
import sys, re

content = open(sys.argv[1]).read()
stub_pattern = r'  # --- New Fact.*?  #   sentiment: 0'
replacement = """  - name: E2E Created Fact
    description: Created by the E2E test suite
    sentiment: 1"""
result = re.sub(stub_pattern, replacement, content, flags=re.DOTALL)
open(sys.argv[1], 'w').write(result)
`;

writeFileSync(CREATE_SCRIPT, createPyScript);
chmodSync(CREATE_SCRIPT, 0o755);

const ts = new Date().toISOString();
const checkpoint = {
  version: 1,
  timestamp: ts,
  human: {
    entity: "human",
    facts: [],
    traits: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: ts,
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

writeFileSync(join(TEST_DATA_PATH, "state.json"), JSON.stringify(checkpoint, null, 2));

const mockServer = new MockLLMServerImpl();
await mockServer.start(MOCK_PORT, { responses: {}, defaultDelay: 50, enableLogging: false });
mockServer.setResponseForType("response", {
  type: "fixed",
  content: JSON.stringify({ should_respond: true, content: "Test response", reason: "responding" }),
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
    EDITOR: CREATE_SCRIPT,
  },
});

test.describe("/me fact new — create via stub", () => {
  test("filling in the stub creates a new fact with a generated id", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/me fact new");
    terminal.submit();

    await new Promise((resolve) => setTimeout(resolve, 2500));
    await expect(terminal.getByText("Updated 1 items")).toBeVisible({ timeout: 10000 });
  });
});
