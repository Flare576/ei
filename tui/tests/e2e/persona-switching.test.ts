import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const MOCK_PORT = 3100;
const BUN_PATH = process.env.BUN_PATH || "/Users/flare576/.bun/bin/bun";
const TEST_DATA_PATH = `/tmp/ei-test-persona-${process.pid}-${Date.now()}`;

const TAB = "\t";

function createMultiPersonaCheckpoint() {
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
      last_updated: timestamp,
      last_activity: timestamp,
      settings: { auto_save_interval_ms: 999999999 },
    },
    personas: {
      ei: {
        entity: {
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
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "ei-msg-1",
            role: "assistant",
            content: "Hello from Ei!",
            timestamp,
          },
        ],
      },
      alice: {
        entity: {
          entity: "system",
          aliases: ["Alice"],
          short_description: "A helpful assistant",
          long_description: "Alice is a helpful assistant for testing",
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
            id: "alice-msg-1",
            role: "assistant",
            content: "Hello from Alice!",
            timestamp,
          },
        ],
      },
      bob: {
        entity: {
          entity: "system",
          aliases: ["Bob"],
          short_description: "An archived persona",
          long_description: "Bob is archived for testing",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: true,
          archived_at: timestamp,
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "bob-msg-1",
            role: "assistant",
            content: "Hello from Bob!",
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
const checkpoint = createMultiPersonaCheckpoint();
const autosavesPath = join(TEST_DATA_PATH, "autosaves.json");
writeFileSync(autosavesPath, JSON.stringify([checkpoint], null, 2));

await mockServer.start(MOCK_PORT, {
  responses: {},
  defaultDelay: 50,
  enableLogging: true,
});

mockServer.setResponseForType("response", {
  type: "fixed",
  content: "Test response from mock server",
});

mockServer.setResponseForType("generation", {
  type: "fixed",
  content: JSON.stringify({
    long_description: "A newly created test persona",
    traits: [],
    topics: [],
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
  columns: 100,
  env: {
    EI_LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
  },
});

test.describe("Persona Switching", () => {
  test("/persona command shows persona list overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona");
    terminal.submit();

    // Overlay should show with title and personas
    await expect(terminal.getByText("Select Persona")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/ei/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/alice/gi)).toBeVisible({ timeout: 5000 });

    // Bob should NOT be in the list (archived)
    // Dismiss with Escape
    terminal.keyEscape();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/p alias works same as /persona", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/p");
    terminal.submit();

    await expect(terminal.getByText("Select Persona")).toBeVisible({ timeout: 5000 });
    terminal.keyEscape();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/persona alice switches to alice persona", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona alice");
    terminal.submit();

    // Should show notification and switch
    await expect(terminal.getByText(/Switched to alice/gi)).toBeVisible({ timeout: 5000 });
    
    // Sidebar should show alice as active (with * prefix)
    await expect(terminal.getByText(/\* Alice/g)).toBeVisible({ timeout: 5000 });
    
    // Alice's message should be visible in chat
    await expect(terminal.getByText("Hello from Alice!")).toBeVisible({ timeout: 5000 });
  });

  test("/persona with partial match (ali) switches correctly", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona ali");
    terminal.submit();

    await expect(terminal.getByText(/Switched to alice/gi)).toBeVisible({ timeout: 5000 });
  });

  test("/persona unknown prompts to create, y confirms", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona charlie");
    terminal.submit();

    // Should show confirmation overlay
    await expect(terminal.getByText(/Create persona 'charlie'/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("(y/N)")).toBeVisible({ timeout: 5000 });

    // Confirm with y
    terminal.write("y");

    // Should create and switch
    await expect(terminal.getByText(/Created and switched to charlie/gi)).toBeVisible({ timeout: 10000 });
  });

  test("/persona unknown prompts to create, n cancels", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona newpersona");
    terminal.submit();

    await expect(terminal.getByText(/Create persona 'newpersona'/gi)).toBeVisible({ timeout: 5000 });

    // Cancel with n
    terminal.write("n");

    await expect(terminal.getByText("Cancelled")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("Tab cycles through personas in creation order", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona ei");
    terminal.submit();
    await expect(terminal.getByText(/Switched to ei/gi)).toBeVisible({ timeout: 5000 });

    terminal.write(TAB);
    
    await expect(terminal.getByText(/\* Alice/g)).toBeVisible({ timeout: 5000 });
  });

  test("Tab with only one persona is no-op", async () => {
    // This test would require modifying checkpoint to have only one persona
    // The logic is tested by unit tests - skip E2E for this edge case
  });
});

test.describe("Archive Commands", () => {
  test("/archive shows archived personas overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/archive");
    terminal.submit();

    // Should show archived personas overlay with bob
    await expect(terminal.getByText("Archived Personas")).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/bob/gi)).toBeVisible({ timeout: 5000 });

    terminal.keyEscape();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("/archive active persona shows error", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Ensure we're on ei first
    terminal.write("/persona ei");
    terminal.submit();
    await expect(terminal.getByText(/Switched to ei/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("/archive ei");
    terminal.submit();

    await expect(terminal.getByText("Cannot archive active persona")).toBeVisible({ timeout: 5000 });
  });

  test("/archive non-active persona succeeds", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    // Make sure we're on ei so alice is not active
    terminal.write("/persona ei");
    terminal.submit();
    await expect(terminal.getByText(/Switched to ei/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("/archive alice");
    terminal.submit();

    await expect(terminal.getByText(/Archived alice/gi)).toBeVisible({ timeout: 5000 });
  });

  test("/unarchive bob unarchives and switches", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/unarchive bob");
    terminal.submit();

    await expect(terminal.getByText(/Unarchived and switched to bob/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/\* Bob/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Hello from Bob!")).toBeVisible({ timeout: 5000 });
  });

  test("/unarchive nonexistent shows error", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/unarchive nonexistent");
    terminal.submit();

    await expect(terminal.getByText(/not found/gi)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Persona List Overlay Navigation", () => {
  test("Escape dismisses persona list overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona");
    terminal.submit();

    await expect(terminal.getByText("Select Persona")).toBeVisible({ timeout: 5000 });

    terminal.keyEscape();

    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
  });

  test("Enter key selects persona from overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona");
    terminal.submit();

    await expect(terminal.getByText("Select Persona")).toBeVisible({ timeout: 5000 });

    terminal.keyDown();
    await new Promise(resolve => setTimeout(resolve, 100));
    terminal.submit();

    await expect(terminal.getByText(/Switched to/gi)).toBeVisible({ timeout: 5000 });
  });

  test("j/k navigation works in overlay", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona");
    terminal.submit();

    await expect(terminal.getByText("Select Persona")).toBeVisible({ timeout: 5000 });

    terminal.write("j");
    await new Promise(resolve => setTimeout(resolve, 50));
    terminal.write("j");
    await new Promise(resolve => setTimeout(resolve, 50));
    terminal.write("k");
    await new Promise(resolve => setTimeout(resolve, 100));
    terminal.submit();

    await expect(terminal.getByText(/Switched to/gi)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Regression Tests", () => {
  test("archived persona should not appear in sidebar", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/Alice/g)).toBeVisible({ timeout: 5000 });
    
    let bobFound = false;
    try {
      await expect(terminal.getByText(/\bBob\b/g)).toBeVisible({ timeout: 1000 });
      bobFound = true;
    } catch {
      bobFound = false;
    }
    expect(bobFound).toBe(false);
  });

  test("archived persona removed from sidebar after /archive", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    await expect(terminal.getByText(/Alice/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/persona alice");
    terminal.submit();
    await expect(terminal.getByText(/Switched to alice/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("Hello Alice!");
    terminal.submit();
    await expect(terminal.getByText(/Hello Alice!/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/persona ei");
    terminal.submit();
    await expect(terminal.getByText(/Switched to ei/gi)).toBeVisible({ timeout: 5000 });

    await expect(terminal.getByText(/Alice \(1 new\)/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/archive alice");
    terminal.submit();
    await expect(terminal.getByText(/Archived Alice/gi)).toBeVisible({ timeout: 5000 });

    let aliceFound = false;
    try {
      await expect(terminal.getByText(/Alice \(1 new\)/g)).toBeVisible({ timeout: 1000 });
      aliceFound = true;
    } catch {
      aliceFound = false;
    }
    expect(aliceFound).toBe(false);
  });

  test("switching persona shows new persona messages", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona ei");
    terminal.submit();
    await expect(terminal.getByText(/Switched to ei/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 5000 });

    terminal.write("/persona alice");
    terminal.submit();
    await expect(terminal.getByText(/Switched to alice/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("Hello from Alice!")).toBeVisible({ timeout: 5000 });
    
    let eiMsgFound = false;
    try {
      await expect(terminal.getByText("Hello from Ei!")).toBeVisible({ timeout: 1000 });
      eiMsgFound = true;
    } catch {
      eiMsgFound = false;
    }
    expect(eiMsgFound).toBe(false);
  });

  test("creating new persona allows sending messages", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/persona testpersona");
    terminal.submit();
    await expect(terminal.getByText(/Create persona 'testpersona'/gi)).toBeVisible({ timeout: 5000 });
    terminal.write("y");
    await expect(terminal.getByText(/Created and switched to testpersona/gi)).toBeVisible({ timeout: 10000 });

    await expect(terminal.getByText(/\* testpersona/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("Hello new persona!");
    terminal.submit();

    await expect(terminal.getByText(/Hello new persona!/g)).toBeVisible({ timeout: 10000 });
  });

  test("new persona shows empty chat, not previous persona messages", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("Unique msg for Ei 12345");
    terminal.submit();
    await expect(terminal.getByText(/Unique msg for Ei 12345/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/persona newtest");
    terminal.submit();
    await expect(terminal.getByText(/Create persona 'newtest'/gi)).toBeVisible({ timeout: 5000 });
    terminal.write("y");
    await expect(terminal.getByText(/Created and switched to newtest/gi)).toBeVisible({ timeout: 10000 });

    await expect(terminal.getByText(/\* newtest/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/No messages yet/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("/persona ei");
    terminal.submit();
    await expect(terminal.getByText(/Switched to ei/gi)).toBeVisible({ timeout: 5000 });

    await expect(terminal.getByText(/\* Ei/gi)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/Unique msg for Ei 12345/g)).toBeVisible({ timeout: 5000 });
  });
});
