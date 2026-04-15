import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "../framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "../fixtures.js";

const MOCK_PORT = 3120;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("cyp-tree-overlay");

const CYP_ROOM_ID = "cyp-tree-room-001";
const CYP_ROOM_NAME = "Crossroads";

/**
 * Complete round-1 family: all 3 siblings present (human + ei + 007).
 * active_node_id = "cyp-ei-r1" (the chosen branch).
 * cyp-007-r1 is a visible pending leaf.
 *
 *   cyp-seed-001  (root, null parent — the opening prompt)
 *   ├── cyp-human-r1  (human's round-1 choice)
 *   ├── cyp-ei-r1     (persona:ei — activated, active_node_id)
 *   └── cyp-007-r1    (persona:007 — pending leaf, visible)
 */
function createCheckpointWithExploredCYPRoom() {
  const timestamp = new Date().toISOString();
  return {
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
      last_activity: timestamp,
      settings: createTestSettings(MOCK_SERVER_URL),
    },
    personas: {
      ei: {
        entity: {
          entity: "system",
          id: "ei",
          display_name: "Ei",
          aliases: ["Ei"],
          short_description: "Your personal companion",
          long_description: "A friendly AI companion for testing",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "msg-1",
            role: "system",
            verbal_response: "Hello! I'm ready for testing.",
            timestamp,
            read: true,
            context_status: "default",
          },
        ],
      },
      "007": {
        entity: {
          entity: "system",
          id: "007",
          display_name: "Sage",
          aliases: ["Sage"],
          short_description: "A wise mentor",
          long_description: "A wise mentor for testing",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [],
      },
    },
    rooms: {
      [CYP_ROOM_ID]: {
        id: CYP_ROOM_ID,
        display_name: CYP_ROOM_NAME,
        entity: "room",
        mode: "choose_your_path",
        persona_ids: ["ei", "007"],
        active_node_id: "cyp-ei-r1",
        capture_used: false,
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        last_activity: timestamp,
        messages: [
          {
            id: "cyp-seed-001",
            parent_id: null,
            role: "human",
            verbal_response: "Starting the CYP room",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "cyp-human-r1",
            parent_id: "cyp-seed-001",
            role: "human",
            verbal_response: "My round-one choice",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "cyp-ei-r1",
            parent_id: "cyp-seed-001",
            role: "persona",
            persona_id: "ei",
            verbal_response: "Ei round-one path",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "cyp-007-r1",
            parent_id: "cyp-seed-001",
            role: "persona",
            persona_id: "007",
            verbal_response: "Sage round-one path",
            timestamp,
            read: false,
            context_status: "default",
          },
        ],
      },
    },
    queue: [],
  };
}

const mockServer = new MockLLMServerImpl();

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
const checkpoint = createCheckpointWithExploredCYPRoom();
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: false,
});

process.on("exit", () => { mockServer.stop().catch(() => {}); });
process.on("SIGINT", () => { mockServer.stop().then(() => process.exit(0)); });
process.on("SIGTERM", () => { mockServer.stop().then(() => process.exit(0)); });

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
    EDITOR: "true",
  },
});

test.describe("T7 — CYP Tree Overlay (/context in CYP room)", () => {
  test("/context in a CYP room opens the tree overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();
    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("/context");
    terminal.submit();

    await expect(terminal.getByText(/active.*activated.*unexplored.*masked/gi)).toBeVisible({ timeout: 5000 });
  });

  test("tree overlay shows room messages as navigable nodes", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();
    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("/context");
    terminal.submit();

    await expect(terminal.getByText(/active.*activated.*unexplored.*masked/gi)).toBeVisible({ timeout: 5000 });

    await expect(terminal.getByText(/You:.*Starting the CYP room/gi)).toBeVisible({ timeout: 3000 });
    await expect(terminal.getByText(/Ei:.*Ei round-one path/gi)).toBeVisible({ timeout: 3000 });
    await expect(terminal.getByText(/Sage:.*Sage round-one path/gi)).toBeVisible({ timeout: 3000 });
  });

  test("tree overlay dismisses with q", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();
    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("/context");
    terminal.submit();
    await expect(terminal.getByText(/active.*activated.*unexplored.*masked/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("q");

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("tree overlay shows footer with navigation hints", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();
    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("/context");
    terminal.submit();
    await expect(terminal.getByText(/active.*activated.*unexplored.*masked/gi)).toBeVisible({ timeout: 5000 });

    await expect(terminal.getByText(/\[i\] zoom in.*\[o\] zoom out.*\[q\] quit/gi)).toBeVisible({ timeout: 3000 });
  });

  test("/messages alias also opens CYP tree overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();
    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("/messages");
    terminal.submit();

    await expect(terminal.getByText(/active.*activated.*unexplored.*masked/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("q");
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });
});
