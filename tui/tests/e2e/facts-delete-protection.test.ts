/**
 * TUI E2E test for built-in fact delete protection.
 *
 * Uses a Python editor script that sets `_delete: true` on the "Full Name"
 * built-in fact. After the TUI processes the YAML, the notification should
 * show "deleted 0" because built-in facts are protected from deletion in
 * humanFromYAML (Task 9 change).
 *
 * Without protection, the notification would say "deleted 1".
 */
import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3121;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("facts-delete");
const DELETE_SCRIPT = join(TEST_DATA_PATH, "delete-editor.py");

// ─────────────────────────────────────────────────────────────────────────────
// Module-level setup (runs once before terminals spawn)
// ─────────────────────────────────────────────────────────────────────────────

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });

// Python editor: finds `name: Full Name` then flips the nearest `_delete: false`
// to `_delete: true`, simulating a user who tries to delete a built-in fact.
const deletePyScript = `#!/usr/bin/env python3
import sys

lines = open(sys.argv[1]).read().split('\\n')
full_name_idx = None
for i, line in enumerate(lines):
    if 'name: Full Name' in line:
        full_name_idx = i
        break

if full_name_idx is not None:
    # Look within next 30 lines for _delete: false
    for i in range(full_name_idx, min(full_name_idx + 30, len(lines))):
        if '_delete: false' in lines[i]:
            lines[i] = lines[i].replace('_delete: false', '_delete: true')
            break

open(sys.argv[1], 'w').write('\\n'.join(lines))
`;

writeFileSync(DELETE_SCRIPT, deletePyScript);
chmodSync(DELETE_SCRIPT, 0o755);

// Checkpoint: "Full Name" as the only fact (makes counting easy)
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
// Test configuration: uses Python delete editor
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
    EDITOR: DELETE_SCRIPT,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("/me facts — Built-in Delete Protection", () => {
  test("built-in facts are NOT deleted when _delete: true in YAML", async ({
    terminal,
  }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/me facts");
    terminal.submit();

    // Python editor runs, sets _delete: true for "Full Name"
    // humanFromYAML sees _delete: true + BUILT_IN_FACT_NAMES.has("Full Name") = true
    // → falls into else branch → fact is upserted, NOT deleted
    // → updateCount=1, deleteCount=0
    // → notification: "Updated 1 items, deleted 0"
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify protection: notification should say "deleted 0" (not "deleted 1")
    await expect(terminal.getByText("deleted 0")).toBeVisible({ timeout: 5000 });

    // TUI should return to ready state without errors
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 8000 });
  });
});
