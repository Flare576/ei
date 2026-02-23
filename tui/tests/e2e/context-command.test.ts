import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3109;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("context");

function createCheckpointWithMessages() {
  const timestamp = new Date().toISOString();
  const oldTimestamp = new Date(Date.now() - 120000).toISOString();
  const recentTimestamp = new Date(Date.now() - 60000).toISOString();

  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [],
      quotes: [
        {
          id: "quote-1",
          message_id: "msg-2",
          data_item_ids: [],
          persona_groups: [],
          text: "A quoted message",
          speaker: "human",
          timestamp: recentTimestamp,
          start: 0,
          end: 16,
          created_at: timestamp,
          created_by: "extraction",
        },
      ],
      last_updated: timestamp,
      last_activity: timestamp,
      settings: createTestSettings(MOCK_SERVER_URL),
    },
    personas: {
      ei: {
        entity: {
          entity: "system",
          aliases: ["Ei"],
          id: "ei",
          display_name: "Ei",
          short_description: "Test companion",
          long_description: "A test companion",
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
            content: "Hello! I'm ready for testing.",
            timestamp: oldTimestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "msg-2",
            role: "human",
            content: "A quoted message from the user.",
            timestamp: recentTimestamp,
            read: true,
            context_status: "always",
          },
          {
            id: "msg-3",
            role: "system",
            content: "A response that should never be in context.",
            timestamp: new Date(Date.now() - 30000).toISOString(),
            read: true,
            context_status: "never",
          },
        ],
      },
    },
    queue: [],
  };
}

function createCheckpointNoMessages() {
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
          aliases: ["Ei"],
          id: "ei",
          display_name: "Ei",
          short_description: "Test companion",
          long_description: "A test companion",
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
    queue: [],
  };
}

const mockServer = new MockLLMServerImpl();

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
const checkpoint = createCheckpointWithMessages();
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: true,
});

mockServer.setResponseForType("response", {
  type: "fixed",
  content: "Test response",
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
  columns: 100,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
  },
});

test.describe("/context Command", () => {
  test("/context opens editor and returns to Ready", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/context");
    terminal.submit();

    await new Promise(resolve => setTimeout(resolve, 500));

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/messages alias works", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/messages");
    terminal.submit();

    await new Promise(resolve => setTimeout(resolve, 500));

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });
});
