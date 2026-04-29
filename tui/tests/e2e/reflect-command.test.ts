import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestSettings, getTestDataPath, BUN_PATH } from "./fixtures.js";

const MOCK_PORT = 3127;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("reflect-command");

/**
 * Creates a checkpoint where Ei has a pending_update (reflection) and Sage does not.
 * Ei is the active persona on startup.
 */
function createCheckpointWithPendingReflection() {
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
          traits: [
            {
              id: "trait-1",
              name: "Warmth",
              description: "Speaks with warmth and empathy",
              strength: 0.8,
              sentiment: 0.7,
              last_updated: timestamp,
            },
          ],
          topics: [
            {
              id: "topic-1",
              name: "Testing",
              perspective: "Tests are important",
              approach: "Write thorough tests",
              personal_stake: "Quality matters",
              sentiment: 0.6,
              exposure_current: 0.5,
              exposure_desired: 0.7,
              last_updated: timestamp,
            },
          ],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
          pending_update: {
            short_description: "Your evolving personal companion",
            long_description: "A friendly AI companion that has grown through conversation",
            traits: [
              {
                id: "trait-1",
                name: "Warmth",
                description: "Speaks with deep warmth and genuine empathy",
                strength: 0.9,
                sentiment: 0.8,
                last_updated: timestamp,
              },
              {
                id: "trait-2",
                name: "Curiosity",
                description: "Asks thoughtful follow-up questions",
                strength: 0.7,
                sentiment: 0.6,
                last_updated: timestamp,
              },
            ],
            topics: [
              {
                id: "topic-1",
                name: "Testing",
                perspective: "Tests reveal truth about code",
                approach: "TDD when possible",
                personal_stake: "Reliable systems matter",
                sentiment: 0.8,
                exposure_current: 0.6,
                exposure_desired: 0.8,
                last_updated: timestamp,
              },
            ],
            critique: "Ei has shown growth in empathy and curiosity. The warmth trait should be strengthened based on recent interactions.",
            created_at: timestamp,
          },
        },
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            content: "Hello! I'm ready for testing.",
            timestamp,
            read: true,
            context_status: "default",
          },
        ],
      },
      "007": {
        entity: {
          entity: "system",
          id: "007",
          display_name: "Sage",
          aliases: ["Sage"],
          short_description: "A wise mentor",
          long_description: "A wise mentor for testing",
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
        messages: [],
      },
    },
    queue: [],
  };
}

const mockServer = new MockLLMServerImpl();

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
const checkpoint = createCheckpointWithPendingReflection();
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

test.describe("/reflect with no pending update", () => {
  test("shows error when persona has no pending_update", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Switch to Sage (no pending_update) via Tab
    terminal.write("\t");
    await expect(terminal.getByText(/\* Sage/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/reflect generate");
    terminal.submit();

    await expect(terminal.getByText(/No pending reflection for Sage/g)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/reflect (no subcommand)", () => {
  test("shows reflection overlay when active persona has pending_update", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/reflect");
    terminal.submit();

    // The overlay shows the persona name and subcommand help
    await expect(terminal.getByText(/Persona Reflection/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/reflect generate/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/reflect apply/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/reflect dismiss/g)).toBeVisible({ timeout: 5000 });

    // Press any key to close
    terminal.write(" ");
    // After closing, we should be back at the chat
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/reflect generate", () => {
  test("generates reflection files and shows success notification", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/reflect generate");
    terminal.submit();

    await expect(terminal.getByText(/Reflection files written/g)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/reflect dismiss", () => {
  test("shows confirmation prompt and cancels on 'n'", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/reflect dismiss");
    terminal.submit();

    // ConfirmOverlay shows the discard message
    await expect(terminal.getByText(/Discard this reflection/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/\(y\/N\)/g)).toBeVisible({ timeout: 5000 });

    terminal.write("n");
    await expect(terminal.getByText(/Cancelled/g)).toBeVisible({ timeout: 5000 });
  });

  test("confirms dismiss and clears pending_update", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/reflect dismiss");
    terminal.submit();

    await expect(terminal.getByText(/Discard this reflection/g)).toBeVisible({ timeout: 5000 });
    terminal.write("y");

    await expect(terminal.getByText(/Dismissed reflection for Ei/g)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/reflect apply", () => {
  test("applies pending_update and shows success notification", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/reflect apply");
    terminal.submit();

    await expect(terminal.getByText(/Applied reflection for Ei/g)).toBeVisible({ timeout: 5000 });
  });
});
