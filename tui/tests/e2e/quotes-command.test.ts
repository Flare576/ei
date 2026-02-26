import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3106;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("quotes");

function createCheckpointWithQuotes() {
  const timestamp = new Date().toISOString();
  const msgTimestamp = new Date(Date.now() - 60000).toISOString();
  
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
          text: "This is a memorable quote",
          speaker: "human",
          timestamp: msgTimestamp,
          start: 0,
          end: 25,
          created_at: timestamp,
          created_by: "human",
        },
        {
          id: "quote-2",
          message_id: "msg-3",
          data_item_ids: [],
          persona_groups: [],
          text: "Ei's wise words",
          speaker: "ei",
          timestamp: msgTimestamp,
          start: 0,
          end: 15,
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
            verbal_response: "Hello! System initialized.",
            timestamp: new Date(Date.now() - 120000).toISOString(),
            read: true,
            context_status: "default",
          },
          {
            id: "msg-2",
            role: "user",
            verbal_response: "This is a memorable quote from the human user.",
            timestamp: msgTimestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "msg-3",
            role: "assistant",
            verbal_response: "Ei's wise words about life and coding.",
            timestamp: new Date(Date.now() - 30000).toISOString(),
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
const checkpoint = createCheckpointWithQuotes();
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

test.describe("/quotes Command", () => {
  test("/quotes opens editor with all quotes", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/quotes");
    terminal.submit();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/quotes N shows overlay for message N", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/quotes 2");
    terminal.submit();
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    await expect(terminal.getByText("memorable")).toBeVisible({ timeout: 5000 });
  });

  test("/quotes N with no quotes shows empty state", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/quotes 1");
    terminal.submit();
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    await expect(terminal.getByText("No quotes")).toBeVisible({ timeout: 5000 });
  });

  test("/quotes me opens editor filtered to human quotes", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/quotes me");
    terminal.submit();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/quotes Ei opens editor filtered to persona quotes", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/quotes Ei");
    terminal.submit();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("message index markers display", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    await expect(terminal.getByText("1]")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("2]")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("3]")).toBeVisible({ timeout: 5000 });
  });

  test("escape closes quote overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/quotes 2");
    terminal.submit();
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    await expect(terminal.getByText("memorable")).toBeVisible({ timeout: 5000 });
    
    terminal.write("\x1b");
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });
});
