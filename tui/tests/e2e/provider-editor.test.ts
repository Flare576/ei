import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3108;
const TEST_DATA_PATH = getTestDataPath("provider-editor");
const WITH_PROVIDER_DATA_PATH = getTestDataPath("provider-editor-existing");

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
      settings: {
        auto_save_interval_ms: 999999999,
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

function createCheckpointWithExistingProvider() {
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
        auto_save_interval_ms: 999999999,
        accounts: [
          {
            id: "existing-provider-id",
            name: "ExistingProvider",
            type: "llm",
            url: `http://localhost:${MOCK_PORT}/v1`,
            enabled: true,
            created_at: new Date().toISOString(),
          },
        ],
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
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

rmSync(WITH_PROVIDER_DATA_PATH, { recursive: true, force: true });
mkdirSync(WITH_PROVIDER_DATA_PATH, { recursive: true });
const checkpointWithProvider = createCheckpointWithExistingProvider();
const withProviderStatePath = join(WITH_PROVIDER_DATA_PATH, "state.json");
writeFileSync(withProviderStatePath, JSON.stringify(checkpointWithProvider, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: false,
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
    EDITOR: `bash -c 'sed -i "" "s/My Provider/EditorProv/;s|https://api.example.com/v1|http://localhost:${MOCK_PORT}/v1|" "$1"' --`,
  },
});

test.describe("/provider new — editor flow", () => {
  test("/provider new opens editor, creates provider, shows 'Provider EditorProv created!'", async ({ terminal }) => {
    // Welcome overlay appears when no accounts exist (local LLM detection fails)
    await expect(terminal.getByText("Welcome to Ei!")).toBeVisible({ timeout: 15000 });
    terminal.keyEscape(); // Dismiss welcome overlay
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
    terminal.write("/provider new");
    terminal.submit();
    await expect(terminal.getByText(/EditorProv/gi)).toBeVisible({ timeout: 10000 });
  });
});

test.describe("/provider overlay edit — with existing provider", () => {
  test.use({
    program: {
      file: BUN_PATH,
      args: ["run", "dev"],
    },
    rows: 30,
    columns: 100,
    env: {
      EI_DATA_PATH: WITH_PROVIDER_DATA_PATH,
      PATH: process.env.PATH!,
      HOME: process.env.HOME!,
      TERM: "xterm-256color",
      EDITOR: `bash -c 'sed -i "" "s/ExistingProvider/UpdatedProvider/" "$1"' --`,
    },
  });

  test("pressing 'e' in overlay opens editor for selected provider", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/provider");
    terminal.submit();

    await expect(terminal.getByText("Select Provider")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/ExistingProvider/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("e");

    await expect(terminal.getByText(/UpdatedProvider/gi)).toBeVisible({ timeout: 10000 });
  });
});
