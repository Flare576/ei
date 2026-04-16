import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3126;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("human-display-name");

const FFA_ROOM_ID = "ffa-display-name-room-001";
const FFA_ROOM_NAME = "Lounge";
const DISPLAY_NAME = "Flare";

function createCheckpointWithDisplayName() {
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
      settings: {
        ...createTestSettings(MOCK_SERVER_URL),
        name_display: DISPLAY_NAME,
      },
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
    },
    rooms: {
      [FFA_ROOM_ID]: {
        id: FFA_ROOM_ID,
        display_name: FFA_ROOM_NAME,
        entity: "room",
        mode: "free_for_all",
        persona_ids: ["ei"],
        active_node_id: "ffa-display-root-001",
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        last_activity: timestamp,
        messages: [
          {
            id: "ffa-display-root-001",
            parent_id: null,
            role: "human",
            verbal_response: "Let's begin.",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "ffa-display-ei-resp",
            parent_id: "ffa-display-root-001",
            role: "persona",
            persona_id: "ei",
            verbal_response: "Ei's initial greeting.",
            timestamp,
            read: true,
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
const checkpoint = createCheckpointWithDisplayName();
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: false,
});

mockServer.setResponseForType("response", {
  type: "fixed",
  content: JSON.stringify({
    should_respond: true,
    verbal_response: "Got your message.",
    reason: "responding",
  }),
});

mockServer.setResponseForType("room-response", {
  type: "fixed",
  content: JSON.stringify({
    should_respond: true,
    verbal_response: "Got your room message.",
  }),
});

process.on("exit", () => { mockServer.stop().catch(() => {}); });
process.on("SIGINT", () => { mockServer.stop().then(() => process.exit(0)); });
process.on("SIGTERM", () => { mockServer.stop().then(() => process.exit(0)); });

test.use({
  program: { file: BUN_PATH, args: ["run", "dev"] },
  rows: 30,
  columns: 100,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
  },
});

test.describe("Human display name — 1:1 chat", () => {
  test("uses name_display instead of 'Human' for message attribution", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("Hello there!");
    terminal.submit();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    await expect(terminal.getByText(new RegExp(`${DISPLAY_NAME} \\(`, "g"))).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Human display name — FFA room", () => {
  test("uses name_display instead of 'Human' for room message attribution", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("Anyone home?");
    terminal.submit();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    await expect(terminal.getByText(new RegExp(`${DISPLAY_NAME} \\(`, "g"))).toBeVisible({ timeout: 5000 });
  });
});
