import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "../framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "../fixtures.js";

const MOCK_PORT = 3118;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("map-activate");

const MAP_ROOM_ID = "map-test-room-001";
const MAP_ROOM_NAME = "ThinkTank";

const JUDGE_PERSONA_ID = "oracle-judge-001";

function createCheckpointWithMAPRoom() {
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
        active_node_id: "map-seed-001",
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        last_activity: timestamp,
        messages: [
          {
            id: "map-seed-001",
            parent_id: null,
            role: "human",
            content: "Starting the MAP room",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "map-ei-r1",
            parent_id: "map-seed-001",
            role: "persona",
            persona_id: "ei",
            content: "My MAP response",
            timestamp,
            read: false,
            context_status: "default",
          },
          {
            id: "map-sage-r1",
            parent_id: "map-seed-001",
            role: "persona",
            persona_id: "007",
            content: "My MAP response",
            timestamp,
            read: false,
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
const checkpoint = createCheckpointWithMAPRoom();
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: false,
});

mockServer.setResponseForType("room-response", {
  type: "fixed",
  content: JSON.stringify({
    should_respond: true,
    content: "My response",
  }),
});

mockServer.setResponseForType("room-judge", {
  type: "fixed",
  content: JSON.stringify({
    winner_message_id: "map-ei-r1",
    reason: "Best answer",
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
  columns: 120,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
  },
});

test.describe("T3 — MAP room activation cycle", () => {
  test("MAP room shows [Waiting] after message send", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to the MAP room
    terminal.write(`/r ${MAP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${MAP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Submit human message → [Activate!] immediately (personas pre-seeded)
    terminal.write("What is your perspective on this matter?");
    terminal.submit();

    await expect(terminal.getByText(/\[Activate!\]/g)).toBeVisible({ timeout: 10000 });

    // Activate → judge queued → [Waiting] during judge
    terminal.submit();
    await expect(terminal.getByText(/\[Waiting\]/g)).toBeVisible({ timeout: 10000 });
  });

  test("MAP room shows [Activate!] once all personas respond", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to the MAP room
    terminal.write(`/r ${MAP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${MAP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Send message → [Activate!] immediately (personas pre-seeded, queue empty = "Ready" already)
    terminal.write("Please share your thoughts.");
    terminal.submit();

    await expect(terminal.getByText(/\[Activate!\]/g)).toBeVisible({ timeout: 10000 });
  });

  test("MAP room shows human pending when human hasn't submitted", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to the MAP room
    terminal.write(`/r ${MAP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${MAP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Don't submit — personas already responded, human hasn't
    // Left section should show "Waiting for ... You ..."
    await expect(terminal.getByText(/Waiting for.*You/g)).toBeVisible({ timeout: 5000 });
  });

  test("MAP room activates on Enter with empty input after all responded", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to MAP room
    terminal.write(`/r ${MAP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${MAP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Send human message → [Activate!] immediately
    terminal.write("Activate test message.");
    terminal.submit();

    await expect(terminal.getByText(/\[Activate!\]/g)).toBeVisible({ timeout: 10000 });

    // Press Enter with empty input to trigger activation
    terminal.submit();

    // CRITICAL REGRESSION: [Activate!] must NOT persist while judge is running
    // After activation, center should show [Waiting] (judge phase), not [Activate!]
    await expect(terminal.getByText(/\[Waiting\]/g)).toBeVisible({ timeout: 10000 });
    await expect(terminal.getByText(/\[Activate!\]/g)).not.toBeVisible({ timeout: 2000 });
  });

  test("MAP judge verdict shows as verdict not chose-not-to-respond", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to MAP room
    terminal.write(`/r ${MAP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${MAP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Submit human message → [Activate!] immediately
    terminal.write("Judge this response please.");
    terminal.submit();

    await expect(terminal.getByText(/\[Activate!\]/g)).toBeVisible({ timeout: 10000 });

    // Activate the judge phase
    terminal.submit();

    // Wait for judge to complete
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    // Judge message must NOT show "chose not to respond" — it's a verdict
    await expect(terminal.getByText(/chose not to respond/g)).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe("T4 — MAP silence and recall", () => {
  test("MAP room silence command drafts silence message", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to MAP room
    terminal.write(`/r ${MAP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${MAP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Personas already responded, human not submitted — issue silence directly
    terminal.write("/silence just thinking");
    terminal.submit();

    // Silence should be recorded — notification or status change confirms it
    await expect(
      terminal.getByText(/Press \[Up\] to recall/gi)
    ).toBeVisible({ timeout: 5000 });
  });

  test("Up key recalls silence reason text", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to MAP room
    terminal.write(`/r ${MAP_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${MAP_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Issue silence command with a reason
    terminal.write("/silence just thinking");
    terminal.submit();

    // Wait for confirmation of silence
    await expect(
      terminal.getByText(/Press \[Up\] to recall/gi)
    ).toBeVisible({ timeout: 5000 });

    // Press Up to recall — should restore the silence reason text
    terminal.keyUp();

    // Input should now contain "just thinking"
    await expect(terminal.getByText(/just thinking/g)).toBeVisible({ timeout: 5000 });
  });
});
