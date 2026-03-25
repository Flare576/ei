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
        active_node_id: null,
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        last_activity: timestamp,
        messages: [],
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
    verbal_response: "CYP persona response",
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

    // Navigate to CYP room
    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(CYP_ROOM_NAME)).toBeVisible({ timeout: 10000 });

    // Send message to start a round
    terminal.write("Which path shall we take?");
    terminal.submit();

    // Wait for all persona responses to arrive
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    // Personas should have responded
    await expect(terminal.getByText(/CYP persona response/)).toBeVisible({ timeout: 10000 });

    // Press Enter with empty input — CYP editor should open.
    // EDITOR=true exits immediately without changes → cancellation message shown.
    terminal.submit();

    await expect(
      terminal.getByText(/no branch selected|cancelled|not selected/gi)
    ).toBeVisible({ timeout: 10000 });
  });

  test("CYP non-empty Enter drafts message and does NOT open editor", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to CYP room
    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(CYP_ROOM_NAME)).toBeVisible({ timeout: 10000 });

    // Type something (non-empty) and press Enter — should DRAFT the message, not open editor
    terminal.write("My deliberate choice of words");
    terminal.submit();

    // The message should appear in the room (it was submitted as a round message)
    await expect(terminal.getByText(/My deliberate choice of words/)).toBeVisible({ timeout: 10000 });

    // Editor must NOT have opened — no cancellation or "no branch selected" message
    await expect(
      terminal.getByText(/no branch selected|cancelled/gi)
    ).not.toBeVisible({ timeout: 2000 });
  });

  test("CYP room Up key is blocked when branch has been explored", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to CYP room
    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(CYP_ROOM_NAME)).toBeVisible({ timeout: 10000 });

    // Send a message so we have a submitted human message
    terminal.write("First question down the path");
    terminal.submit();

    // Wait for personas to respond
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    // Activate an empty-Enter to open editor (EDITOR=true exits, cancels selection)
    terminal.submit();

    // Give editor flow time to complete
    await expect(
      terminal.getByText(/no branch selected|cancelled|not selected/gi)
    ).toBeVisible({ timeout: 10000 });

    // Send another message to create a second round
    terminal.write("Second question to create a child node");
    terminal.submit();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    // Now press Up — once any explored child node exists, recall should be BLOCKED
    terminal.keyUp();

    // Should see a "cannot recall" or blocked notification
    await expect(
      terminal.getByText(/Cannot recall|already been explored|recall blocked/gi)
    ).toBeVisible({ timeout: 5000 });
  });

  test("CYP room responses appear before [Activate!] / choice prompt", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to CYP room
    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(CYP_ROOM_NAME)).toBeVisible({ timeout: 10000 });

    // Send message to start round
    terminal.write("Tell me your paths");
    terminal.submit();

    // Wait for queue to settle — personas should have responded
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    // Persona response content must be visible
    await expect(terminal.getByText(/CYP persona response/)).toBeVisible({ timeout: 10000 });

    // After all personas respond in a CYP room with no human submission yet,
    // the room center should show [Activate!] or a choice prompt
    await expect(
      terminal.getByText(/\[Activate!\]|Choose a path|Select a branch/gi)
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("T6 — CYP /activate NUMBER navigates to a node", () => {
  test("/activate 1 navigates to a node and shows acknowledgment", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to CYP room
    terminal.write(`/r ${CYP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(CYP_ROOM_NAME)).toBeVisible({ timeout: 10000 });

    // Start a round so there are messages to activate
    terminal.write("Set up a round for activation");
    terminal.submit();

    // Wait for personas to respond
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    // Issue /activate 1 — navigates to message index 1
    terminal.write("/activate 1");
    terminal.submit();

    // Should see an acknowledgment that node was activated, or the editor opens (Complete node),
    // or the active node changes (Incomplete node queues personas)
    await expect(
      terminal.getByText(/activated|navigated|active node|no branch selected|cancelled/gi)
    ).toBeVisible({ timeout: 10000 });
  });
});
