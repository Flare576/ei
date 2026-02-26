import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestSettings, getTestDataPath, BUN_PATH } from "./fixtures.js";

const MOCK_PORT = 3103;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("delete-command");

function createCheckpointWithThreePersonas() {
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
          is_paused: false,
          is_archived: false,
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "ei-msg-1",
            role: "assistant",
            verbal_response: "Hello from Ei!",
            timestamp,
            read: true,
            context_status: "default",
          },
        ],
      },
      "001": {
        entity: {
          entity: "system",
          id: "001",
          display_name: "Alice",
          aliases: ["Alice"],
          short_description: "A helpful assistant",
          long_description: "Alice is a helpful assistant for testing",
          traits: [],
          topics: [],
          is_paused: false,
          is_archived: false,
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "alice-msg-1",
            role: "assistant",
            verbal_response: "Hello from Alice!",
            timestamp,
            read: true,
            context_status: "default",
          },
        ],
      },
      "002": {
        entity: {
          entity: "system",
          id: "002",
          display_name: "ToDelete",
          aliases: ["ToDelete"],
          short_description: "A persona to be deleted",
          long_description: "ToDelete will be removed in tests",
          traits: [],
          topics: [],
          is_paused: false,
          is_archived: false,
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "todelete-msg-1",
            role: "assistant",
            verbal_response: "Hello from ToDelete!",
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
const checkpoint = createCheckpointWithThreePersonas();
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: false,
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

test.describe("/delete command", () => {
  test("shows persona list overlay when no argument", async ({ terminal }) => {
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 15000 });

    terminal.write("/delete");
    terminal.submit();

    await expect(terminal.getByText(/Select persona to delete/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/Alice/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/ToDelete/gi)).toBeVisible({ timeout: 5000 });

    terminal.keyEscape();
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 5000 });
  });

  test("/del alias works", async ({ terminal }) => {
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 15000 });

    terminal.write("/del");
    terminal.submit();

    await expect(terminal.getByText(/Select persona to delete/gi)).toBeVisible({ timeout: 5000 });
    terminal.keyEscape();
  });

  test("cannot delete active persona", async ({ terminal }) => {
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 15000 });

    terminal.write("/delete ei");
    terminal.submit();

    await expect(terminal.getByText(/Cannot delete active persona/gi)).toBeVisible({ timeout: 5000 });
  });

  test("shows confirmation dialog before deletion", async ({ terminal }) => {
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 15000 });

    terminal.write("/delete alice");
    terminal.submit();

    await expect(terminal.getByText(/Delete "Alice"/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/cannot be undone/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/\(y\/N\)/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("n");
    await expect(terminal.getByText(/Cancelled/gi)).toBeVisible({ timeout: 5000 });
  });

  test("escape cancels confirmation", async ({ terminal }) => {
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 15000 });

    terminal.write("/delete alice");
    terminal.submit();

    await expect(terminal.getByText(/Delete "Alice"/gi)).toBeVisible({ timeout: 5000 });
    terminal.keyEscape();
    await expect(terminal.getByText(/Cancelled/gi)).toBeVisible({ timeout: 5000 });
  });

  test("confirming deletion removes persona", async ({ terminal }) => {
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/ToDelete/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("/delete todelete");
    terminal.submit();

    await expect(terminal.getByText(/Delete "ToDelete"/gi)).toBeVisible({ timeout: 5000 });
    terminal.write("y");

    await expect(terminal.getByText(/Deleted ToDelete/gi)).toBeVisible({ timeout: 5000 });

    // Even with the word boundaries, we keep finding the alert - need to wait for the alert to fade
    await new Promise(resolve => setTimeout(resolve, 5500));

    let toDeleteFound = false;
    try {
      await expect(terminal.getByText(/\bToDelete\b/g)).toBeVisible({ timeout: 1000 });
      toDeleteFound = true;
    } catch {
      toDeleteFound = false;
    }
    expect(toDeleteFound).toBe(false);
  });

  test("deleting from overlay shows confirmation", async ({ terminal }) => {
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 15000 });

    terminal.write("/delete");
    terminal.submit();

    await expect(terminal.getByText(/Select persona to delete/gi)).toBeVisible({ timeout: 5000 });
    
    terminal.submit();

    await expect(terminal.getByText(/Delete "/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/\(y\/N\)/gi)).toBeVisible({ timeout: 5000 });
    
    terminal.write("n");
    await expect(terminal.getByText(/Cancelled/gi)).toBeVisible({ timeout: 5000 });
  });

  test("nonexistent persona shows error", async ({ terminal }) => {
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 15000 });

    terminal.write("/delete nonexistent");
    terminal.submit();

    await expect(terminal.getByText(/not found/gi)).toBeVisible({ timeout: 5000 });
  });

  test("active persona excluded from delete list", async ({ terminal }) => {
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 15000 });

    terminal.write("/delete");
    terminal.submit();

    await expect(terminal.getByText(/Select persona to delete/gi)).toBeVisible({ timeout: 5000 });

    let eiInList = false;
    try {
      await expect(terminal.getByText(/> Ei$/gm)).toBeVisible({ timeout: 1000 });
      eiInList = true;
    } catch {
      eiInList = false;
    }
    expect(eiInList).toBe(false);

    terminal.keyEscape();
  });
});
