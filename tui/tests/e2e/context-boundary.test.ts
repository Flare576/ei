import { test, expect } from "@microsoft/tui-test";
import { MockLLMServerImpl } from "./framework/mock-server.js";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createCheckpointWithTwoPersonas, getTestDataPath, BUN_PATH } from "./fixtures.js";

const MOCK_PORT = 3102;
const TEST_DATA_PATH = getTestDataPath("context-boundary");

const mockServer = new MockLLMServerImpl();

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });
const checkpoint = createCheckpointWithTwoPersonas();
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

test.describe("/new context boundary", () => {
  test("shows divider immediately after /new command", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });
    await expect(terminal.getByText(/Hello.*ready for testing/gi)).toBeVisible({ timeout: 5000 });

    terminal.write("/new");
    terminal.submit();
    await expect(terminal.getByText(/Context boundary set/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/New Context/g)).toBeVisible({ timeout: 5000 });
  });

  test("toggle: second /new removes divider when no messages sent", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/new");
    terminal.submit();
    await expect(terminal.getByText(/Context boundary set/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/New Context/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/new");
    terminal.submit();
    await expect(terminal.getByText(/Context boundary cleared/g)).toBeVisible({ timeout: 5000 });
    await expect(terminal.getByText(/New Context/g)).not.toBeVisible({ timeout: 8000 });
  });

  test("divider appears between old and new messages", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("Hello before boundary");
    terminal.submit();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });
    await expect(terminal.getByText(/Test response/g)).toBeVisible({ timeout: 5000 });

    terminal.write("/new");
    terminal.submit();
    await expect(terminal.getByText(/Context boundary set/g)).toBeVisible({ timeout: 5000 });

    terminal.write("Hello after boundary");
    terminal.submit();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    await expect(terminal.getByText(/New Context/g)).toBeVisible({ timeout: 5000 });
  });

  test("only one divider shown even with multiple messages after boundary", async ({ terminal }) => {
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15000 });

    terminal.write("/new");
    terminal.submit();
    await expect(terminal.getByText(/Context boundary set/g)).toBeVisible({ timeout: 5000 });

    terminal.write("First message");
    terminal.submit();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });
    await expect(terminal.getByText(/Test response/g)).toBeVisible({ timeout: 5000 });

    terminal.write("Second message");
    terminal.submit();
    await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 30000 });

    const dividers = terminal.getByText(/New Context/g);
    await expect(dividers).toBeVisible({ timeout: 5000 });
  });
});
