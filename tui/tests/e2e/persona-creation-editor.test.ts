import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3104;
const TEST_DATA_PATH = getTestDataPath("persona-editor");

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
      last_updated: timestamp,
      last_activity: timestamp,
      settings: { auto_save_interval_ms: 999999999 },
    },
    personas: {
      ei: {
        entity: {
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
const checkpoint = createMinimalCheckpoint();
const autosavesPath = join(TEST_DATA_PATH, "autosaves.json");
writeFileSync(autosavesPath, JSON.stringify([checkpoint], null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: true,
});

mockServer.setResponseForType("response", {
  type: "fixed",
  content: "Test response",
});

mockServer.setResponseForType("generation", {
  type: "fixed",
  content: JSON.stringify({
    short_description: "A new test persona",
    long_description: "A persona created for testing",
    traits: [],
    topics: [],
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
    EI_LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
  },
});

test.describe("Persona Creation with Editor", () => {
  test("/persona newpersona shows confirmation overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    
    terminal.write("/persona newtest");
    terminal.submit();
    
    await expect(terminal.getByText(/Create persona/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/newtest/g)).toBeVisible({ timeout: 5000 });
    
    terminal.keyEscape();
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });
});
