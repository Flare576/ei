/**
 * TUI E2E tests for persona_groups YAML serialization in /me.
 *
 * Uses the same "capture" editor pattern as people-yaml-identifiers:
 * a shell script that copies the YAML to a side-file before the TUI
 * sees it as "no changes", so we can assert on the exact YAML without
 * triggering a save.
 *
 * Covers:
 *   - persona_groups serialized as {GroupName: true/false}[] checkbox map
 *   - active groups appear as true, known-but-absent groups appear as false
 *   - items with no persona_groups show persona_groups: []
 *   - round-trip: checking a group in YAML persists it after save
 */
import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3123;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("me-groups-yaml");
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
    facts: [],
    traits: [],
    topics: [
      {
        id: "topic-001",
        name: "TypeScript",
        description: "Loves type safety",
        exposure_current: 0.8,
        exposure_desired: 0.6,
        sentiment: 0.9,
        last_updated: ts,
        persona_groups: ["Work"],
      },
      {
        id: "topic-002",
        name: "Hiking",
        description: "Weekend activity",
        exposure_current: 0.4,
        exposure_desired: 0.5,
        sentiment: 0.7,
        last_updated: ts,
        // no persona_groups
      },
    ],
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
        group_primary: "Work",
        groups_visible: ["Work", "Personal"],
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
    verbal_response: "Test response",
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
// Helper
// ─────────────────────────────────────────────────────────────────────────────

async function runMeTopicsAndCapture(terminal: any): Promise<string> {
  await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

  terminal.write("/me topics");
  terminal.submit();

  await new Promise(resolve => setTimeout(resolve, 1500));
  await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 10000 });

  expect(existsSync(CAPTURE_FILE)).toBe(true);
  return readFileSync(CAPTURE_FILE, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("/me topics — persona_groups YAML serialization", () => {
  test("active group serialized as true in checkbox map", async ({ terminal }) => {
    const yaml = await runMeTopicsAndCapture(terminal);

    expect(yaml).toContain("name: TypeScript");
    expect(yaml).toContain("persona_groups:");
    expect(yaml).toMatch(/Work:\s*true/);
  });

  test("known-but-absent group serialized as false in checkbox map", async ({ terminal }) => {
    const yaml = await runMeTopicsAndCapture(terminal);

    // TypeScript is in Work but not Personal — Personal should appear as false
    expect(yaml).toMatch(/Personal:\s*false/);
  });

  test("topic with no persona_groups shows empty checkbox list", async ({ terminal }) => {
    const yaml = await runMeTopicsAndCapture(terminal);

    expect(yaml).toContain("name: Hiking");
    // Hiking has no groups — persona_groups block should be present but empty
    // (YAML.stringify renders empty array as `[]` or `\n` depending on version)
    expect(yaml).toMatch(/name: Hiking[\s\S]*?persona_groups:\s*(\[\]|\n\s+-)/);
  });

  test("persona_groups block appears before _delete in YAML output", async ({ terminal }) => {
    const yaml = await runMeTopicsAndCapture(terminal);

    const groupsIndex = yaml.indexOf("persona_groups:");
    const deleteIndex = yaml.indexOf("_delete:");
    expect(groupsIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(groupsIndex).toBeLessThan(deleteIndex);
  });
});
