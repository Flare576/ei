import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "../framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "../fixtures.js";

const MOCK_PORT = 3122;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("map-score");

const MAP_ROOM_ID = "map-score-room-001";
const MAP_ROOM_NAME = "ScoreTest";

const JUDGE_PERSONA_ID = "oracle-judge-score";

function createCheckpointWithMAPScoreRoom() {
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
            verbal_response: "Hello! I'm ready for testing.",
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
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [],
      },
      [JUDGE_PERSONA_ID]: {
        entity: {
          entity: "system",
          id: JUDGE_PERSONA_ID,
          display_name: "Oracle",
          aliases: ["Oracle"],
          short_description: "A discerning judge",
          long_description: "An impartial judge persona for testing MAP rooms",
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
        messages: [],
      },
    },
    rooms: {
      [MAP_ROOM_ID]: {
        id: MAP_ROOM_ID,
        display_name: MAP_ROOM_NAME,
        entity: "room",
        mode: "messages_against_persona",
        persona_ids: ["ei", "007", JUDGE_PERSONA_ID],
        judge_persona_id: JUDGE_PERSONA_ID,
        active_node_id: "map-winner-msg",
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        last_activity: timestamp,
        messages: [
          {
            id: "map-seed",
            parent_id: null,
            role: "human",
            verbal_response: "Topic: nature",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "map-winner-msg",
            parent_id: "map-seed",
            role: "persona",
            persona_id: "ei",
            verbal_response: "The sky is vast.",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "map-verdict-msg",
            parent_id: "map-seed",
            role: "persona",
            persona_id: JUDGE_PERSONA_ID,
            silence_reason: "Evocative",
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
const checkpoint = createCheckpointWithMAPScoreRoom();
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
  columns: 120,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
  },
});

test.describe("MAP score overlay — /context command", () => {
  test("/context in MAP room shows MAP Scoreboard header", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to the MAP room
    terminal.write(`/r ${MAP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${MAP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Open the MAP scoreboard via /context
    terminal.write("/context");
    terminal.submit();

    // Verify the MAP Scoreboard overlay header is visible
    await expect(terminal.getByText(/MAP Scoreboard/)).toBeVisible({ timeout: 5000 });

    // Close the overlay
    terminal.write("q");
  });

  test("/context in MAP room shows winning persona name in scoreboard", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to the MAP room
    terminal.write(`/r ${MAP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${MAP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Open the MAP scoreboard via /context
    terminal.write("/context");
    terminal.submit();

    // Verify the winning persona "Ei" appears in the scoreboard
    await expect(terminal.getByText(/MAP Scoreboard/)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/Ei/)).toBeVisible({ timeout: 5000 });

    // Close the overlay
    terminal.write("q");
  });
});
