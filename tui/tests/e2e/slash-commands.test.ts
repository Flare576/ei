import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3097;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("commands");

const CTRL_B = String.fromCharCode(2);

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
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: true,
});

mockServer.setResponseForType("response", {
  type: "fixed",
  content: "Test response from mock server",
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
  },
});

test.describe("Slash Commands", () => {
  test("/help command shows help overlay and dismisses on Escape", async ({ terminal }) => {
    // HEADS UP: If this test fails, it's most likely because you added a new command or key combo and the help is now
    // stupid long. Make it shorter, or figure out how make it pages... probably shorter ¯\_(ツ)_/¯
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/help");
    terminal.submit();

    await expect(terminal.getByText("eternal")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Commands:")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Press any key to dismiss")).toBeVisible({ timeout: 5000 });

    terminal.keyEscape();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/h alias also shows help overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/h");
    terminal.submit();

    await expect(terminal.getByText("eternal")).toBeVisible({ timeout: 5000 });

    terminal.write("q");

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("Ctrl+B toggles sidebar and shows [S] indicator", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(CTRL_B);

    await expect(terminal.getByText("[S]")).toBeVisible({ timeout: 5000 });

    terminal.write(CTRL_B);

    await new Promise(resolve => setTimeout(resolve, 300));
    
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("unknown command shows error notification", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/notacommand");
    terminal.submit();

    await expect(terminal.getByText(/Unknown command/g)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Quit Command", () => {
  test("/quit command exits the application", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/quit");
    terminal.submit();

    await new Promise(resolve => setTimeout(resolve, 1000));
  });
});
