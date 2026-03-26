import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "../framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "../fixtures.js";

const MOCK_PORT = 3117;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("ffa-room");

const FFA_ROOM_ID = "ffa-fellowship-room-001";
const FFA_ROOM_NAME = "Fellowship";

function createCheckpointWithFFARoom() {
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
      [FFA_ROOM_ID]: {
        id: FFA_ROOM_ID,
        display_name: FFA_ROOM_NAME,
        entity: "room",
        mode: "free_for_all",
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
const checkpoint = createCheckpointWithFFARoom();
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
    verbal_response: "Ei's response to your message",
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
    EDITOR: "true",
  },
});

test.describe("FFA Room — Free-For-All message flow", () => {
  test("navigating to FFA room via /r shows room in sidebar", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });
  });

  test("sending message in FFA room triggers both persona responses", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("Hello everyone in the fellowship!");
    terminal.submit();

    await expect(terminal.getByText(/Processing \(\d+\)/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    await expect(terminal.getByText(/Ei's response to your message/g)).toBeVisible({ timeout: 10000 });
  });

  test("FFA room messages show per-speaker attribution", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("Who speaks here?");
    terminal.submit();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    await expect(terminal.getByText(/Ei \(\d{2}:\d{2}\)/g)).toBeVisible({ timeout: 10000 });
  });

  test("sending second message starts new round", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    const msg1 = "First round message in the fellowship";
    terminal.write(msg1);
    terminal.submit();

    await expect(terminal.getByText(/Processing \(\d+\)/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    await expect(terminal.getByText(msg1, { full: true })).toBeVisible({ timeout: 5000 });

    const msg2 = "Second round message in the fellowship";
    terminal.write(msg2);
    terminal.submit();

    await expect(terminal.getByText(/Processing \(\d+\)/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    await expect(terminal.getByText(msg1, { full: true })).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(msg2, { full: true })).toBeVisible({ timeout: 5000 });
  });
});
