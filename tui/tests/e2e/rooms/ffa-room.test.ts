import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "../framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createTestSettings, BUN_PATH, getTestDataPath } from "../fixtures.js";

const MOCK_PORT = 3117;
const MOCK_SERVER_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const TEST_DATA_PATH = getTestDataPath("ffa-room");
const CONTEXT_DATA_PATH = getTestDataPath("ffa-room-context");

const FFA_ROOM_ID = "ffa-fellowship-room-001";
const FFA_ROOM_NAME = "Fellowship";

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
      [FFA_ROOM_ID]: {
        id: FFA_ROOM_ID,
        display_name: FFA_ROOM_NAME,
        entity: "room",
        mode: "free_for_all",
        persona_ids: ["ei", "007"],
        active_node_id: "ffa-root-msg-001",
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        last_activity: timestamp,
        messages: [
          {
            id: "ffa-root-msg-001",
            parent_id: null,
            role: "human",
            content: "Let's begin.",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "ffa-root-ei-resp",
            parent_id: "ffa-root-msg-001",
            role: "persona",
            persona_id: "ei",
            content: "Ei's initial greeting.",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "ffa-root-sage-resp",
            parent_id: "ffa-root-msg-001",
            role: "persona",
            persona_id: "007",
            content: "Sage's initial greeting.",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "ffa-human-round2",
            parent_id: "ffa-root-msg-001",
            role: "human",
            content: "Round two starts here.",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "ffa-round2-ei-resp",
            parent_id: "ffa-human-round2",
            role: "persona",
            persona_id: "ei",
            content: "Ei's round two reply.",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "ffa-round2-sage-resp",
            parent_id: "ffa-human-round2",
            role: "persona",
            persona_id: "007",
            content: "Sage's round two reply.",
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

// Python editor: marks the first non-root human message _delete: true.
// Used to trigger the cascade confirm in the /context FFA test.
const DELETE_HUMAN_SCRIPT = join(TEST_DATA_PATH, "delete-human-editor.py");
const deleteHumanPy = `#!/usr/bin/env python3
import sys, re

content = open(sys.argv[1]).read()

# Find second occurrence of "_delete: false" with role: human context
# (first is the root, second is the first round human message)
idx = content.find('_delete: false')
if idx != -1:
    idx2 = content.find('_delete: false', idx + 1)
    if idx2 != -1:
        content = content[:idx2] + '_delete: true' + content[idx2 + len('_delete: false'):]

open(sys.argv[1], 'w').write(content)
`;

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
rmSync(CONTEXT_DATA_PATH, { recursive: true, force: true });
mkdirSync(CONTEXT_DATA_PATH, { recursive: true });

writeFileSync(DELETE_HUMAN_SCRIPT, deleteHumanPy);
chmodSync(DELETE_HUMAN_SCRIPT, 0o755);

const checkpoint = createCheckpointWithFFARoom();
const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(checkpoint, null, 2));

const contextStatePath = join(CONTEXT_DATA_PATH, "state.json");
writeFileSync(contextStatePath, JSON.stringify(checkpoint, null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: false,
});

mockServer.setResponseForType("room-response", {
  type: "fixed",
  content: "Ei's response to your message",
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
  rows: 80,
  columns: 120,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
  },
});

test.describe("FFA Room — Free-For-All message flow", () => {
  test("navigating to FFA room via /r shows room in sidebar", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });
  });

  test("sending message in FFA room triggers both persona responses", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("Hello everyone in the fellowship!");
    terminal.submit();

    await expect(terminal.getByText(/Processing \(\d+\)/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });
  });

  test("FFA room messages show per-speaker attribution", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("Who speaks here?");
    terminal.submit();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    await expect(terminal.getByText(/Ei's response to your message/g)).toBeVisible({ timeout: 10000 });
  });

  test("sending second message starts new round", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    const msg1 = "First fellowship round";
    terminal.write(msg1);
    terminal.submit();

    await expect(terminal.getByText(/Processing \(\d+\)/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    const msg2 = "Second fellowship round";
    terminal.write(msg2);
    terminal.submit();

    await expect(terminal.getByText(/Processing \(\d+\)/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });
  });
});

test.describe("FFA Room — /context command (no-op editor)", () => {
  test.use({
    program: { file: BUN_PATH, args: ["run", "dev"] },
    rows: 80,
    columns: 120,
    env: {
      EI_DATA_PATH: CONTEXT_DATA_PATH,
      PATH: process.env.PATH!,
      HOME: process.env.HOME!,
      TERM: "xterm-256color",
      EDITOR: "true",
    },
  });

  test("/context in FFA room opens YAML tree and returns to Ready", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("/context");
    terminal.submit();

    await new Promise(resolve => setTimeout(resolve, 500));

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("FFA Room — /context cascade delete confirm", () => {
  test.use({
    program: { file: BUN_PATH, args: ["run", "dev"] },
    rows: 80,
    columns: 120,
    env: {
      EI_DATA_PATH: CONTEXT_DATA_PATH,
      PATH: process.env.PATH!,
      HOME: process.env.HOME!,
      TERM: "xterm-256color",
      EDITOR: DELETE_HUMAN_SCRIPT,
    },
  });

  test("marking a human message _delete:true shows cascade confirm with child count", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write(`/r ${FFA_ROOM_NAME}`);
    terminal.submit();

    await expect(terminal.getByText(`Switched to ${FFA_ROOM_NAME}`)).toBeVisible({ timeout: 10000 });

    terminal.write("/context");
    terminal.submit();

    await new Promise(resolve => setTimeout(resolve, 500));

    await expect(terminal.getByText(/Delete \d+ messages?/g)).toBeVisible({ timeout: 5000 });

    terminal.write("N");
    terminal.submit();

    await expect(terminal.getByText("Delete cancelled")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 10000 });
  });
});
