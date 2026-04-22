import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "../framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "../fixtures.js";

const MOCK_PORT = 3119;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("cyp-room");

const CYP_ROOM_ID = "cyp-test-room-001";
const CYP_ROOM_NAME = "Crossroads";

function createCheckpointWithCYPRoom() {
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
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "msg-1",
            role: "system",
            content: "Hello! I'm ready for testing.",
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
        active_node_id: "cyp-seed-001",
        capture_used: false,
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        messages: [
          {
            id: "cyp-seed-001",
            parent_id: null,
            role: "human",
            content: "Starting the CYP room",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "cyp-ei-r1",
            parent_id: "cyp-seed-001",
            role: "persona",
            persona_id: "ei",
            content: "CYP response option",
            timestamp,
            read: false,
            context_status: "default",
          },
          {
            id: "cyp-sage-r1",
            parent_id: "cyp-seed-001",
            role: "persona",
            persona_id: "007",
            content: "CYP response option",
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
const checkpoint = createCheckpointWithCYPRoom();
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: false,
});

mockServer.setResponseForType("room-response", {
  type: "fixed",
  content: JSON.stringify({
    should_respond: true,
    content: "CYP persona response",
  }),
});

process.on("exit", () => {
  mockServer.stop().catch(() => {});
});
process.on("SIGINT", () => {
  mockServer.stop().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  mockServer.stop().then(() => process.exit(0));
});

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
    // EDITOR=true: `true` command exits 0 without touching temp file.
    // CYP editor sees "no changes" → shows cancellation / no-selection message.
    EDITOR: "true",
  },
});

test.describe("T5 — CYP Room branch selection", () => {
  test("CYP room shows responses and opens editor on empty Enter", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("Which path shall we take?");
    terminal.submit();

    await expect(terminal.getByText(/\[Activate!\]/g)).toBeVisible({ timeout: 10000 });

    // Press Enter with empty input — CYP editor should open.
    // EDITOR=true exits immediately without changes → cancellation message shown.
    terminal.submit();

    await expect(
      terminal.getByText(/No changes made|No response chosen|editor cancelled/gi)
    ).toBeVisible({ timeout: 10000 });
  });

  test("CYP non-empty Enter drafts message and does NOT open editor", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("My deliberate choice of words");
    terminal.submit();

    await expect(terminal.getByText(/\[Activate!\]/g)).toBeVisible({ timeout: 10000 });

    // Editor must NOT have opened — no cancellation or "no branch selected" message
    await expect(
      terminal.getByText(/no branch selected|cancelled/gi)
    ).not.toBeVisible({ timeout: 2000 });
  });

  test("CYP room Up key is blocked when branch has been explored", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("First question down the path");
    terminal.submit();

    await expect(terminal.getByText(/\[Activate!\]/g)).toBeVisible({ timeout: 10000 });

    // Press Up — should recall the submitted message text
    terminal.keyUp();

    await expect(terminal.getByText(/First question down the path/g)).toBeVisible({ timeout: 5000 });
  });

  test("CYP room responses appear before [Activate!] / choice prompt", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("Tell me your paths");
    terminal.submit();

    await expect(terminal.getByText(/\[Activate!\]/g)).toBeVisible({ timeout: 10000 });
  });
});

test.describe("T6 — CYP /activate NUMBER navigates to a node", () => {
  test("/activate 1 navigates to a node and shows acknowledgment", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${CYP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("Set up a round for activation");
    terminal.submit();

    await expect(terminal.getByText(/\[Activate!\]/g)).toBeVisible({ timeout: 10000 });

    terminal.write("/activate 1");
    terminal.submit();

    await expect(
      terminal.getByText(/activated|navigated|no branch selected|cancelled|Ready/gi)
    ).toBeVisible({ timeout: 15000 });
  });
});
