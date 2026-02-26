import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3106;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("editor");

function createMinimalCheckpoint() {
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
          id: "ei",
          display_name: "Ei",
          entity: "system",
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
    queue: [],
  };
}

const mockServer = new MockLLMServerImpl();

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
const checkpoint = createMinimalCheckpoint();
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: true,
});

mockServer.setResponseForType("response", {
  type: "fixed",
  content: JSON.stringify({
    should_respond: true,
    verbal_response: "Test response",
    reason: "responding"
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
  columns: 100,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
  },
});

test.describe("/editor Command", () => {
  test("/editor is recognized as command", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/editor");
    terminal.submit();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/e alias is recognized as command", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/e");
    terminal.submit();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });
});
