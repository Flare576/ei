import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createCheckpointWithTwoPersonas, getTestDataPath, BUN_PATH, TAB } from "./fixtures.js";

const MOCK_PORT = 3101;
const TEST_DATA_PATH = getTestDataPath("basic-commands");

const mockServer = new MockLLMServerImpl();

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
const checkpoint = createCheckpointWithTwoPersonas();
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
    EI_LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
  },
});

test.describe("/new command", () => {
  test("sets context boundary and shows notification", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/new");
    terminal.submit();

    await expect(terminal.getByText(/Context boundary set/g)).toBeVisible({ timeout: 5000 });
  });

  test("requires active persona", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/pause command", () => {
  test("pauses persona indefinitely without duration", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/pause");
    terminal.submit();

    await expect(terminal.getByText(/Paused Ei indefinitely/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("⏸")).toBeVisible({ timeout: 5000 });
  });

  test("pauses persona with duration", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/pause 2h");
    terminal.submit();

    await expect(terminal.getByText(/Paused Ei for 2h/g)).toBeVisible({ timeout: 5000 });
  });

  test("rejects invalid duration format", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/pause abc");
    terminal.submit();

    await expect(terminal.getByText(/Invalid duration/g)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/resume command", () => {
  test("shows warning when persona not paused", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/resume");
    terminal.submit();

    await expect(terminal.getByText(/is not paused/g)).toBeVisible({ timeout: 5000 });
  });

  test("unpause alias works", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/unpause");
    terminal.submit();

    await expect(terminal.getByText(/is not paused/g)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("/model command", () => {
  test("shows usage when no argument provided", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/model");
    terminal.submit();

    await expect(terminal.getByText(/Usage:/g)).toBeVisible({ timeout: 5000 });
  });

  test("rejects invalid model format (missing colon)", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/model gpt4");
    terminal.submit();

    await expect(terminal.getByText(/Invalid model format/g)).toBeVisible({ timeout: 5000 });
  });

  test("accepts valid model format", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/model openai:gpt-4o");
    terminal.submit();

    await expect(terminal.getByText(/Model set to openai:gpt-4o/g)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("pause/resume visual state", () => {
  test("pause shows icon in sidebar, resume removes it", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });

    await expect(terminal.getByText("⏸")).not.toBeVisible({ timeout: 1000 });

    terminal.write("/pause");
    terminal.submit();
    await expect(terminal.getByText(/Paused Ei/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("⏸")).toBeVisible({ timeout: 5000 });

    terminal.write("/resume");
    terminal.submit();
    await expect(terminal.getByText(/Resumed Ei/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("⏸")).not.toBeVisible({ timeout: 8000 });
  });

  test("pause with duration shows icon", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/pause 1d");
    terminal.submit();
    await expect(terminal.getByText(/Paused Ei for 1d/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("⏸")).toBeVisible({ timeout: 5000 });
  });

  test("pause persists after switching personas", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/\* Ei/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/Sage/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/pause");
    terminal.submit();
    await expect(terminal.getByText(/Paused Ei/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText("⏸")).toBeVisible({ timeout: 5000 });

    terminal.write(TAB);
    await expect(terminal.getByText(/\* Sage/g)).toBeVisible({ timeout: 5000 });

    await expect(terminal.getByText("⏸")).toBeVisible({ timeout: 5000 });
  });
});
