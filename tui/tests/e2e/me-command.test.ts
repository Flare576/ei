import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3105;
const TEST_DATA_PATH = getTestDataPath("me");

function createCheckpointWithHumanData() {
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [
        { id: "f1", fact: "Lives in Chicago", confidence: 0.9, last_updated: timestamp },
      ],
      traits: [
        { id: "t1", trait: "curious", strength: 0.8, confidence: 0.9, last_updated: timestamp },
      ],
      topics: [
        { id: "top1", topic: "programming", exposure_current: 0.7, exposure_desired: 0.5, last_updated: timestamp },
      ],
      people: [
        { id: "p1", name: "Alice", relationship: "friend", sentiment: 0.8, last_updated: timestamp },
      ],
      quotes: [],
      last_updated: timestamp,
      last_activity: timestamp,
      settings: { auto_save_interval_ms: 999999999 },
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
const checkpoint = createCheckpointWithHumanData();
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
    EI_LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
  },
});

test.describe("/me Command", () => {
  test("/me is recognized as command", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/me");
    terminal.submit();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });
});
