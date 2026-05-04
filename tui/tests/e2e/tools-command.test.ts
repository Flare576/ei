import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { BUN_PATH, getTestDataPath } from "./fixtures.js";

const MOCK_PORT = 3115;
const TEST_DATA_PATH = getTestDataPath("tools-command");

// ─── Checkpoint ───────────────────────────────────────────────────────────────

/**
 * Checkpoint with a pre-seeded Ei Built-ins toolkit and two tools.
 * Pre-seeding avoids a race between bootstrapTools() and the test issuing /tools.
 */
function createCheckpointWithToolkit(mockServerUrl: string) {
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
      settings: {
        auto_save_interval_ms: 999999999,
        default_model: "Mock LLM:mock-model",
        ceremony: {
          time: "09:00",
          last_ceremony: timestamp,
        },
        accounts: [
          {
            id: "mock-llm-account",
            name: "Mock LLM",
            type: "llm",
            url: mockServerUrl,
            api_key: "",
            default_model: "mock-model",
            enabled: true,
            created_at: timestamp,
          },
        ],
      },
    },
    personas: {
      ei: {
        entity: {
          id: "ei",
          display_name: "Ei",
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
          is_static: false,
          last_updated: timestamp,
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
    tool_providers: [
      {
        id: "ei",
        name: "ei",
        display_name: "Ei Built-ins",
        description: "Built-in tools that ship with Ei.",
        builtin: true,
        config: {},
        enabled: true,
        created_at: timestamp,
      },
    ],
    tools: [
      {
        id: "tool-find-memory",
        provider_id: "ei",
        name: "find_memory",
        display_name: "Find Memory",
        description: "Search memory.",
        input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        runtime: "any",
        builtin: true,
        enabled: true,
        created_at: timestamp,
        max_calls_per_interaction: 3,
      },
      {
        id: "tool-file-read",
        provider_id: "ei",
        name: "file_read",
        display_name: "Read File",
        description: "Read a file.",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: timestamp,
        max_calls_per_interaction: 5,
      },
      {
        id: "tool-list-directory",
        provider_id: "ei",
        name: "list_directory",
        display_name: "List Directory",
        description: "List directory contents.",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: timestamp,
        max_calls_per_interaction: 5,
      },
      {
        id: "tool-directory-tree",
        provider_id: "ei",
        name: "directory_tree",
        display_name: "Directory Tree",
        description: "Show directory tree.",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: timestamp,
        max_calls_per_interaction: 3,
      },
      {
        id: "tool-search-files",
        provider_id: "ei",
        name: "search_files",
        display_name: "Search Files",
        description: "Search files by name pattern.",
        input_schema: { type: "object", properties: { path: { type: "string" }, pattern: { type: "string" } }, required: ["path", "pattern"] },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: timestamp,
        max_calls_per_interaction: 3,
      },
      {
        id: "tool-grep",
        provider_id: "ei",
        name: "grep",
        display_name: "Grep",
        description: "Search file contents.",
        input_schema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern", "path"] },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: timestamp,
        max_calls_per_interaction: 5,
      },
      {
        id: "tool-get-file-info",
        provider_id: "ei",
        name: "get_file_info",
        display_name: "Get File Info",
        description: "Get file metadata.",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: timestamp,
        max_calls_per_interaction: 5,
      },
      {
        id: "tool-web-fetch",
        provider_id: "ei",
        name: "web_fetch",
        display_name: "Web Fetch",
        description: "Fetch content from a URL.",
        input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: timestamp,
        max_calls_per_interaction: 3,
      },
    ],
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const mockServer = new MockLLMServerImpl();

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
writeFileSync(
  join(TEST_DATA_PATH, "state.json"),
  JSON.stringify(createCheckpointWithToolkit(`http://127.0.0.1:${MOCK_PORT}/v1`), null, 2)
);

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: false,
});

process.on("exit", () => { mockServer.stop().catch(() => {}); });
process.on("SIGINT", () => { mockServer.stop().then(() => process.exit(0)); });
process.on("SIGTERM", () => { mockServer.stop().then(() => process.exit(0)); });

// ─── Tests ───────────────────────────────────────────────────────────────────

test.use({
  program: { file: BUN_PATH, args: ["run", "dev"] },
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

test.describe("/tools command", () => {
  test("shows 'Toolkits' overlay title", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/tools");
    terminal.submit();

    await expect(terminal.getByText("Toolkits")).toBeVisible({ timeout: 5000 });

    terminal.keyEscape();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("lists the Ei Built-ins provider with tool count", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/tools");
    terminal.submit();

    await expect(terminal.getByText("Toolkits")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/Ei Built-ins \(7 tools\)/g)).toBeVisible({ timeout: 3000 });

    terminal.keyEscape();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("Escape dismisses the overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/tools");
    terminal.submit();

    await expect(terminal.getByText("Toolkits")).toBeVisible({ timeout: 5000 });

    terminal.keyEscape();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Toolkits")).not.toBeVisible({ timeout: 3000 });
  });

  test("shows keyboard hint line", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/tools");
    terminal.submit();

    await expect(terminal.getByText("Toolkits")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/j\/k.*navigate/g)).toBeVisible({ timeout: 3000 });

    terminal.keyEscape();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });
});
