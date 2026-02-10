import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const MOCK_PORT = 3098;
const BUN_PATH = process.env.BUN_PATH || "/Users/flare576/.bun/bin/bun";
const TEST_DATA_PATH = `${process.env.HOME}/.ei-test-chat`;

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
          short_description: "Your personal companion",
          long_description: "A friendly AI companion for testing",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "welcome-1",
            role: "assistant",
            content: "Hello! I'm ready for testing.",
            timestamp,
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

const EXPECTED_RESPONSE = "UNIQUE_E2E_TEST_RESPONSE_XYZ123";
mockServer.setResponseForType("response", {
  type: "fixed",
  content: EXPECTED_RESPONSE,
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
  },
});

test.describe("Chat Flow", () => {
  test("user can send message and receive LLM response", async ({ terminal }) => {
    mockServer.clearRequestHistory();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("Hello from the test!");
    terminal.submit();

    await expect(terminal.getByText(/Processing \(\d+\)/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    await expect(terminal.getByText(EXPECTED_RESPONSE, { full: true })).toBeVisible({ timeout: 10000 });
  });

  test("user message appears in chat after sending", async ({ terminal }) => {
    const userMessage = "This is my unique test message ABC789";
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(userMessage);
    terminal.submit();

    // User message should appear immediately in the chat
    await expect(terminal.getByText(userMessage, { full: true })).toBeVisible({ timeout: 5000 });
    
    // Also verify "Human" label appears (message attribution)
    await expect(terminal.getByText(/Human \(/g)).toBeVisible({ timeout: 5000 });
  });

  test("multiple messages can be sent in sequence", async ({ terminal }) => {
    const message1 = "First message in sequence DEF456";
    const message2 = "Second message in sequence GHI789";
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Send first message
    terminal.write(message1);
    terminal.submit();
    
    // Wait for response to complete
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });
    
    // Verify first message and response are visible
    await expect(terminal.getByText(message1, { full: true })).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(EXPECTED_RESPONSE, { full: true })).toBeVisible({ timeout: 5000 });

    // Send second message
    terminal.write(message2);
    terminal.submit();
    
    // Wait for processing to start
    await expect(terminal.getByText(/Processing \(\d+\)/g)).toBeVisible({ timeout: 5000 });
    
    // Wait for second response
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });
    
    // Both messages should be visible in chat
    await expect(terminal.getByText(message1, { full: true })).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(message2, { full: true })).toBeVisible({ timeout: 5000 });
  });
});
