import { test, expect } from "@microsoft/tui-test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { BUN_PATH, createCheckpointWithTwoPersonas } from "./fixtures.js";

// Tested by Beta — 2026-08-08

const STALE_VERSION = "0.0.1";
const UPGRADE_PROMPT = "A new Ei harness version is available. Install the latest skills, hooks, and integrations now?";
const FAILED_INSTALL_WARNING = "Some integrations failed to install: Claude Code";
const OLD_SKILL_CONTENT = "old ei-curate skill sentinel\n";
const SANDBOX = mkdtempSync(join(tmpdir(), "ei-e2e-upgrade-prompt-"));
const TEST_DATA_PATH = join(SANDBOX, "data");
const TEST_HOME = join(SANDBOX, "home");
const LOCAL_STATE_PATH = join(TEST_DATA_PATH, "local.json");
const DRIVER_PID_FILE = join(SANDBOX, "upgrade-prompt-driver.json");
const CLAUDE_DIR = join(TEST_HOME, ".claude");
const SKILL_DESTINATION = join(CLAUDE_DIR, "skills", "ei-curate", "SKILL.md");
const INJECT_HOOK_PATH = join(CLAUDE_DIR, "hooks", "ei-inject.ts");
const BOOT_MARKER_PREFIX = `ei-upgrade-prompt-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
// tui-test imports a compiled copy under `.tui-test`; use its stable working
// directory rather than import.meta.url so fixtures refer to the repository.
const REPOSITORY_ROOT = resolve(process.cwd(), "..");
const PACKAGE_JSON_PATH = join(REPOSITORY_ROOT, "package.json");
const PACKAGED_SKILL_PATH = join(REPOSITORY_ROOT, "skills", "ei-curate", "SKILL.md");
const RELAUNCH_DRIVER_PATH = join(process.cwd(), "tests", "e2e", "fixtures", "upgrade-prompt-relaunch-driver.ts");
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as { version?: unknown };

if (typeof packageJson.version !== "string") {
  throw new Error("Upgrade prompt E2E fixture requires a string package version.");
}

const CURRENT_VERSION = packageJson.version;
const PACKAGED_SKILL_CONTENT = readFileSync(PACKAGED_SKILL_PATH, "utf8");
const CONSTRAINED_PATH = [dirname(BUN_PATH), "/usr/bin", "/bin"].join(delimiter);

mkdirSync(TEST_DATA_PATH, { recursive: true });
mkdirSync(TEST_HOME, { recursive: true });
writeFileSync(
  join(TEST_DATA_PATH, "state.json"),
  JSON.stringify(createCheckpointWithTwoPersonas("http://127.0.0.1:65535/v1"), null, 2),
  "utf8",
);
writeFileSync(LOCAL_STATE_PATH, JSON.stringify({ installed_version: STALE_VERSION }), "utf8");
writeFileSync(CLAUDE_DIR, "Boot one Claude installer blocker.\n", "utf8");

test.use({
  program: {
    file: BUN_PATH,
    args: ["run", RELAUNCH_DRIVER_PATH],
  },
  rows: 30,
  columns: 120,
  env: {
    BUN_PATH,
    EI_DATA_PATH: TEST_DATA_PATH,
    EI_UPGRADE_PROMPT_BOOT_MARKER_PREFIX: BOOT_MARKER_PREFIX,
    EI_UPGRADE_PROMPT_PID_FILE: DRIVER_PID_FILE,
    EI_UPGRADE_PROMPT_STALE_VERSION: STALE_VERSION,
    EI_UPGRADE_PROMPT_OLD_SKILL_CONTENT: OLD_SKILL_CONTENT,
    HOME: TEST_HOME,
    PATH: CONSTRAINED_PATH,
    TERM: "xterm-256color",
  },
});

type TuiTerminal = Parameters<Parameters<typeof test>[1]>[0]["terminal"];

interface BootWindow {
  boot: number;
  outputStart: number;
}

function markerFor(boot: number): string {
  return `${BOOT_MARKER_PREFIX}:boot-${boot}`;
}

function bufferText(buffer: string[][]): string {
  const lines = buffer.map((line) => line.join(""));
  return lines.join("\n");
}

function normalized(text: string): string {
  // The real terminal wraps the ConfirmOverlay inside box-drawing borders.
  // Remove only those rendering glyphs before comparing the logical text.
  const withoutBoxDrawing = text.replace(/[\u2500-\u257f]/g, " ");
  const collapsedWhitespace = withoutBoxDrawing.replace(/\s+/g, " ");
  return collapsedWhitespace.trim();
}

function includesText(text: string, expected: string): boolean {
  return normalized(text).includes(normalized(expected));
}

function scopedOutput(terminal: TuiTerminal, boot: BootWindow): string {
  const linesAfterBootMarker = terminal.getBuffer().slice(boot.outputStart);
  return bufferText(linesAfterBootMarker);
}

async function waitForPtyBufferUpdate(): Promise<void> {
  // tui-test exposes no buffer-change event. This real-PTY poll yields only between
  // output probes; it is not a guessed completion delay or a substitute for an oracle.
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}
async function waitUntil(predicate: () => boolean, description: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await waitForPtyBufferUpdate();
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function beginBoot(terminal: TuiTerminal, boot: number): Promise<BootWindow> {
  const marker = markerFor(boot);
  let markerLine = -1;

  try {
    await waitUntil(() => {
      markerLine = terminal.getBuffer().findIndex((line) => line.join("").includes(marker));
      return markerLine >= 0;
    }, `boot ${boot} marker`);
  } catch {
    throw new Error(
      `Boot ${boot} marker was not emitted. Terminal output: ` +
      JSON.stringify(normalized(bufferText(terminal.getBuffer()))),
    );
  }

  return { boot, outputStart: markerLine + 1 };
}

async function waitForScopedText(terminal: TuiTerminal, boot: BootWindow, expected: string): Promise<void> {
  let output = "";
  try {
    await waitUntil(() => {
      output = scopedOutput(terminal, boot);
      return includesText(output, expected);
    }, `boot ${boot.boot} output ${JSON.stringify(expected)}`);
  } catch {
    throw new Error(
      `Boot ${boot.boot} never displayed ${JSON.stringify(expected)} after its marker. ` +
      `Scoped terminal output: ${JSON.stringify(normalized(output))}`,
    );
  }
  expect(normalized(output)).toContain(normalized(expected));
}

async function waitForCurrentViewText(terminal: TuiTerminal, expected: string): Promise<void> {
  let view = "";
  await waitUntil(() => {
    view = bufferText(terminal.getViewableBuffer());
    return includesText(view, expected);
  }, `current terminal view ${JSON.stringify(expected)}`);
  expect(normalized(view)).toContain(normalized(expected));
}

async function waitForCurrentViewTextToDisappear(terminal: TuiTerminal, expected: string): Promise<void> {
  await waitUntil(
    () => !includesText(bufferText(terminal.getViewableBuffer()), expected),
    `current terminal view to dismiss ${JSON.stringify(expected)}`,
  );
}

async function assertScopedTextNeverAppears(
  terminal: TuiTerminal,
  boot: BootWindow,
  unexpected: string,
  observationMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + observationMs;
  let output = scopedOutput(terminal, boot);
  while (Date.now() < deadline) {
    output = scopedOutput(terminal, boot);
    if (includesText(output, unexpected)) {
      throw new Error(`Boot ${boot.boot} displayed unexpected text: ${unexpected}`);
    }
    await waitForPtyBufferUpdate();
  }
  expect(normalized(output)).not.toContain(normalized(unexpected));
}

function installedVersion(): string | undefined {
  const localState = JSON.parse(readFileSync(LOCAL_STATE_PATH, "utf8")) as { installed_version?: unknown };
  return typeof localState.installed_version === "string" ? localState.installed_version : undefined;
}

async function waitForExactFile(path: string, expectedContent: string, description: string): Promise<void> {
  await waitUntil(() => {
    try {
      return readFileSync(path, "utf8") === expectedContent;
    } catch {
      return false;
    }
  }, description);
  expect(readFileSync(path, "utf8")).toBe(expectedContent);
}

function quitCurrentBoot(terminal: TuiTerminal): void {
  terminal.write("/quit force");
  terminal.submit();
}

test("retains a stale upgrade marker through failed acceptance and decline, then installs once and stays quiet after relaunch", async ({ terminal }) => {
  expect(installedVersion()).toBe(STALE_VERSION);

  const bootOne = await beginBoot(terminal, 1);
  await waitForScopedText(terminal, bootOne, UPGRADE_PROMPT);
  await waitForCurrentViewText(terminal, UPGRADE_PROMPT);
  terminal.write("y");
  await waitForScopedText(terminal, bootOne, FAILED_INSTALL_WARNING);
  await waitForCurrentViewTextToDisappear(terminal, UPGRADE_PROMPT);
  expect(installedVersion()).toBe(STALE_VERSION);
  quitCurrentBoot(terminal);

  const bootTwo = await beginBoot(terminal, 2);
  await waitForScopedText(terminal, bootTwo, UPGRADE_PROMPT);
  await waitForCurrentViewText(terminal, UPGRADE_PROMPT);
  terminal.write("n");
  await waitForCurrentViewTextToDisappear(terminal, UPGRADE_PROMPT);
  await waitForScopedText(terminal, bootTwo, "Ready");
  await waitForCurrentViewText(terminal, "Ready");
  expect(installedVersion()).toBe(STALE_VERSION);
  expect(readFileSync(SKILL_DESTINATION, "utf8")).toBe(OLD_SKILL_CONTENT);
  expect(existsSync(INJECT_HOOK_PATH)).toBe(false);
  quitCurrentBoot(terminal);

  const bootThree = await beginBoot(terminal, 3);
  await waitForScopedText(terminal, bootThree, UPGRADE_PROMPT);
  await waitForCurrentViewText(terminal, UPGRADE_PROMPT);
  terminal.write("y");
  await waitForCurrentViewTextToDisappear(terminal, UPGRADE_PROMPT);
  await waitUntil(() => installedVersion() === CURRENT_VERSION, "successful installer to stamp the package version");
  expect(installedVersion()).toBe(CURRENT_VERSION);
  await waitForExactFile(SKILL_DESTINATION, PACKAGED_SKILL_CONTENT, "Ei Curate skill replacement");
  await waitUntil(() => existsSync(INJECT_HOOK_PATH), "Claude injection hook installation");
  expect(existsSync(INJECT_HOOK_PATH)).toBe(true);
  await waitForScopedText(terminal, bootThree, "Ready");
  await waitForCurrentViewText(terminal, "Ready");
  quitCurrentBoot(terminal);

  const bootFour = await beginBoot(terminal, 4);
  await waitForScopedText(terminal, bootFour, "Ready");
  await waitForCurrentViewText(terminal, "Ready");
  await assertScopedTextNeverAppears(terminal, bootFour, UPGRADE_PROMPT);
  expect(installedVersion()).toBe(CURRENT_VERSION);
});
