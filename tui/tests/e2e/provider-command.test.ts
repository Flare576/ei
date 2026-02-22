import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3107;
const TEST_DATA_PATH = getTestDataPath("provider-command");
const EMPTY_DATA_PATH = getTestDataPath("provider-command-empty");

function createCheckpointWithProvider() {
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
        default_model: "TestProvider",
        accounts: [
          {
            id: "test-provider-id",
            name: "TestProvider",
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

function createCheckpointWithoutProvider() {
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

const mockServer = new MockLLMServerImpl();

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
const checkpoint = createCheckpointWithProvider();
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

rmSync(EMPTY_DATA_PATH, { recursive: true, force: true });
mkdirSync(EMPTY_DATA_PATH, { recursive: true });
const emptyCheckpoint = createCheckpointWithoutProvider();
const emptyStatePath = join(EMPTY_DATA_PATH, "state.json");
writeFileSync(emptyStatePath, JSON.stringify(emptyCheckpoint, null, 2));

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
    EDITOR: "true",
  },
});

test.describe("/provider command — with configured provider", () => {
  test("/provider shows overlay with 'Select Provider' title and TestProvider listed", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/provider");
    terminal.submit();

    await expect(terminal.getByText("Select Provider")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/TestProvider/gi)).toBeVisible({ timeout: 5000 });

    terminal.keyEscape();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/providers alias also shows overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/providers");
    terminal.submit();

    await expect(terminal.getByText("Select Provider")).toBeVisible({ timeout: 5000 });

    terminal.keyEscape();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("Escape dismisses the provider overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/provider");
    terminal.submit();

    await expect(terminal.getByText("Select Provider")).toBeVisible({ timeout: 5000 });

    terminal.keyEscape();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/provider TestProvider directly sets the provider on the persona", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/provider TestProvider");
    terminal.submit();

    await expect(terminal.getByText(/Provider set to TestProvider/gi)).toBeVisible({ timeout: 5000 });
  });

  test("/provider nonexistent shows 'No provider named' error", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/provider nonexistent");
    terminal.submit();

    await expect(terminal.getByText(/No provider named/gi)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/model smart inference — with configured provider", () => {
  test("after /provider TestProvider, /model some-model shows 'Model set to TestProvider:some-model'", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/provider TestProvider");
    terminal.submit();
    await expect(terminal.getByText(/Provider set to TestProvider/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("/model some-model");
    terminal.submit();

    await expect(terminal.getByText(/Model set to TestProvider:some-model/gi)).toBeVisible({ timeout: 5000 });
  });

  test("/model OtherProv:gpt-4o (explicit provider:model) sets model as-is", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/model OtherProv:gpt-4o");
    terminal.submit();

    await expect(terminal.getByText(/Model set to OtherProv:gpt-4o/gi)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/provider command — with NO configured providers", () => {
  test.use({
    program: {
      file: BUN_PATH,
      args: ["run", "dev"],
    },
    rows: 30,
    columns: 100,
    env: {
      EI_DATA_PATH: EMPTY_DATA_PATH,
      PATH: process.env.PATH!,
      HOME: process.env.HOME!,
      TERM: "xterm-256color",
      EDITOR: "true",
    },
  });

  test("/provider with empty accounts shows 'No providers configured' message", async ({ terminal }) => {
    // Welcome overlay appears when no accounts exist (local LLM detection fails)
    await expect(terminal.getByText("Welcome to Ei!")).toBeVisible({ timeout: 15000 });
    terminal.keyEscape(); // Dismiss welcome overlay
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
    terminal.write("/provider");
    terminal.submit();

    await expect(terminal.getByText(/No providers configured/gi)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/model command — with NO configured providers", () => {
  test.use({
    program: {
      file: BUN_PATH,
      args: ["run", "dev"],
    },
    rows: 30,
    columns: 100,
    env: {
      EI_DATA_PATH: EMPTY_DATA_PATH,
      PATH: process.env.PATH!,
      HOME: process.env.HOME!,
      TERM: "xterm-256color",
      EDITOR: "true",
    },
  });

  test("/provider with empty accounts shows 'No providers configured' message", async ({ terminal }) => {
    // Welcome overlay appears when no accounts exist (local LLM detection fails)
    await expect(terminal.getByText("Welcome to Ei!")).toBeVisible({ timeout: 15000 });
    terminal.keyEscape(); // Dismiss welcome overlay
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
    terminal.write("/provider");
    terminal.submit();

    await expect(terminal.getByText(/No providers configured/gi)).toBeVisible({ timeout: 5000 });
  });
  test("/model some-model with NO provider set on persona shows 'No provider set' error", async ({ terminal }) => {
    // Welcome overlay appears when no accounts exist (local LLM detection fails)
    await expect(terminal.getByText("Welcome to Ei!")).toBeVisible({ timeout: 15000 });
    terminal.keyEscape(); // Dismiss welcome overlay
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
    terminal.write("/model some-model");
    terminal.submit();

    await expect(terminal.getByText(/No provider set/gi)).toBeVisible({ timeout: 5000 });
  });
});
