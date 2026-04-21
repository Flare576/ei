import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "../framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestSettings, BUN_PATH, getTestDataPath, TAB } from "../fixtures.js";

const MOCK_PORT = 3121;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("room-details");

const ROOM_ID = "room-details-fellowship-001";
const ROOM_NAME = "Fellowship";

function createCheckpointWithFFARoom() {
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
    },
    rooms: {
      [ROOM_ID]: {
        id: ROOM_ID,
        display_name: ROOM_NAME,
        entity: "room",
        mode: "free_for_all",
        persona_ids: ["ei", "007"],
        active_node_id: null,
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        last_activity: timestamp,
        messages: [],
      },
    },
    queue: [],
  };
}

const mockServer = new MockLLMServerImpl();

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
const checkpoint = createCheckpointWithFFARoom();
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

test.describe("T8: /details in room mode", () => {
  test("/d in room mode opens room editor", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to the Fellowship room
    terminal.write(`/r ${ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Issue /d with no args — should open the room editor
    // EDITOR=true exits immediately (no-op editor), so we just verify no crash
    terminal.write("/d");
    terminal.submit();

    // After EDITOR=true exits, the TUI should return to Ready state
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 10000 });

    // Room name should still be visible (still in room mode after editor closes)
    await expect(terminal.getByText(`Switched to ${ROOM_NAME}`)).toBeVisible({ timeout: 5000 });
  });

  test("/d PersonaName in room mode opens persona editor not room", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to the Fellowship room first
    terminal.write(`/r ${ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Issue /d Ei — should open the Ei persona editor, not the room editor
    // EDITOR=true exits immediately
    terminal.write("/d Ei");
    terminal.submit();

    // After EDITOR=true exits, TUI should return to Ready
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("T9: Sidebar Tab cycling behavior", () => {
  test("Tab cycles rooms when in room mode", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Navigate to room mode
    terminal.write(`/r ${ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Press Tab — with only one room, should wrap back to same room
    terminal.write(TAB);

    // Still in room mode, room name still visible
    await expect(terminal.getByText(`Switched to ${ROOM_NAME}`)).toBeVisible({ timeout: 5000 });
  });

  test("Tab cycles personas when in persona mode", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Default mode is persona mode — Ei should be active (sidebar shows * prefix for active)
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });

    // Press Tab to cycle to next persona (Sage / 007)
    terminal.write(TAB);

    // Should now show Sage (007's display name) as active
    await expect(terminal.getByText(/\* Sage/g)).toBeVisible({ timeout: 5000 });

    // Press Tab again to cycle back to Ei
    terminal.write(TAB);

    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });
  });

  test("/p PersonaName switches back to persona mode", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Enter room mode first
    terminal.write(`/r ${ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    // Switch back to persona mode via /p Ei
    terminal.write("/p Ei");
    terminal.submit();

    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 10000 });
  });

  test("/r RoomName switches to room mode", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });

    // Switch to room mode
    terminal.write(`/r ${ROOM_NAME}`);
    terminal.submit();

    // Sidebar should now show the room name
    await expect(terminal.getByText(`Switched to ${ROOM_NAME}`)).toBeVisible({ timeout: 10000 });
  });
});
