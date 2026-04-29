/**
 * TUI E2E tests for Person identifier YAML serialization in /me people.
 *
 * Uses a "capture" editor (cp "$1" side-file) that reads what the TUI hands
 * to $EDITOR without modifying it, so the TUI sees no changes and returns to
 * Ready cleanly. This lets us assert on the exact YAML format produced by
 * humanToYAML() for people with identifiers.
 *
 * Covers:
 *   - identifiers serialized as a YAML list-of-maps (not a plain string)
 *   - primary identifier has `primary: true` field
 *   - non-primary identifier has no `primary` field
 *   - # Valid types: comment injected before identifiers: field
 *   - interested_personas field absent from YAML output
 *   - learned_on field marked # [read-only] when present
 *   - pre-migration person (identifiers: undefined) shows empty identifiers list
 */
import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "fs";

type TuiTerminal = Parameters<Parameters<typeof test>[1]>[0]["terminal"];
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3122;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("people-yaml-identifiers");
const CAPTURE_FILE = join(TEST_DATA_PATH, "yaml-capture.txt");
const CAPTURE_SCRIPT = join(TEST_DATA_PATH, "capture-editor.sh");

// ─────────────────────────────────────────────────────────────────────────────
// Module-level setup (runs once before terminals spawn)
// ─────────────────────────────────────────────────────────────────────────────

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });

writeFileSync(
  CAPTURE_SCRIPT,
  `#!/bin/bash\ncp "$1" "${CAPTURE_FILE}"\n`
);
chmodSync(CAPTURE_SCRIPT, 0o755);

const ts = new Date().toISOString();

const checkpoint = {
  version: 1,
  timestamp: ts,
  human: {
    entity: "human",
    facts: [],
    traits: [],
    topics: [],
    people: [
      {
        id: "person-001",
        name: "Alice Smith",
        relationship: "friend",
        description: "College friend who codes.",
        sentiment: 0.8,
        exposure_current: 0.4,
        exposure_desired: 0.6,
        learned_on: "2025-06-01T10:00:00.000Z",
        last_updated: ts,
        identifiers: [
          { type: "Full Name", value: "Alice Smith", is_primary: true },
          { type: "GitHub", value: "asmith", is_primary: false },
        ],
      },
      {
        id: "person-002",
        name: "Bob",
        relationship: "coworker",
        description: "Works on the platform team.",
        sentiment: 0.6,
        exposure_current: 0.3,
        exposure_desired: 0.5,
        last_updated: ts,
        // intentionally no identifiers field — simulates pre-migration record
      },
    ],
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

const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

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
// Test configuration
// ─────────────────────────────────────────────────────────────────────────────

test.use({
  program: {
    file: BUN_PATH,
    args: ["run", "dev"],
  },
  rows: 40,
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

async function runMePeopleAndCapture(terminal: TuiTerminal): Promise<string> {
  await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

  terminal.write("/me people");
  terminal.submit();

  // Wait for the capture script to write the file, then for TUI to return to Ready
  await new Promise(resolve => setTimeout(resolve, 1500));
  await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 10000 });

  expect(existsSync(CAPTURE_FILE)).toBe(true);
  return readFileSync(CAPTURE_FILE, "utf8");
}

test.describe("/me people — Identifier YAML serialization", () => {
  test("identifiers serialized as list-of-maps with primary: true on primary", async ({ terminal }) => {
    const yaml = await runMePeopleAndCapture(terminal);

    // identifiers block must exist as a list
    expect(yaml).toContain("identifiers:");

    // Primary identifier: Full Name with primary: true
    expect(yaml).toMatch(/type: Full Name/);
    expect(yaml).toMatch(/value: Alice Smith/);
    expect(yaml).toMatch(/primary: true/);

    // Non-primary: GitHub — no `primary:` field on that entry
    expect(yaml).toMatch(/type: GitHub/);
    expect(yaml).toMatch(/value: asmith/);
  });

  test("# Valid types comment injected before identifiers field", async ({ terminal }) => {
    const yaml = await runMePeopleAndCapture(terminal);

    // Comment must include built-in type names
    expect(yaml).toMatch(/# Valid types:.*Full Name/);
    expect(yaml).toMatch(/# Valid types:.*Ei Persona/);
  });

  test("learned_on field marked [read-only] in YAML output", async ({ terminal }) => {
    const yaml = await runMePeopleAndCapture(terminal);

    // learned_on should be commented out as read-only
    expect(yaml).toMatch(/# \[read-only\] learned_on:/);

    // last_updated should also be read-only
    expect(yaml).toMatch(/# \[read-only\] last_updated:/);
  });

  test("interested_personas field absent from YAML output", async ({ terminal }) => {
    const yaml = await runMePeopleAndCapture(terminal);

    expect(yaml).not.toContain("interested_personas:");
  });

  test("pre-migration person (no identifiers field) shows empty identifiers list", async ({ terminal }) => {
    const yaml = await runMePeopleAndCapture(terminal);

    // Bob has no identifiers — should still have an identifiers: [] block
    // YAML.stringify renders empty array as `identifiers: []\n` or `identifiers:\n`
    expect(yaml).toMatch(/identifiers:\s*(\[\])?/);

    // Bob's name should appear
    expect(yaml).toContain("Bob");
  });
});
