import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Tested by Beta — 2026-08-08

const BUN_PATH = process.env.BUN_PATH;
const DATA_PATH = process.env.EI_DATA_PATH;
const TEST_HOME = process.env.HOME;
const MARKER_PREFIX = process.env.EI_UPGRADE_PROMPT_BOOT_MARKER_PREFIX;
const OLD_SKILL_CONTENT = process.env.EI_UPGRADE_PROMPT_OLD_SKILL_CONTENT;
const STALE_VERSION = process.env.EI_UPGRADE_PROMPT_STALE_VERSION;
const PID_FILE = process.env.EI_UPGRADE_PROMPT_PID_FILE;
const GRACEFUL_STOP_MS = 2_000;
const FORCED_STOP_MS = 1_000;

if (
  !BUN_PATH ||
  !DATA_PATH ||
  !TEST_HOME ||
  !MARKER_PREFIX ||
  OLD_SKILL_CONTENT === undefined ||
  !STALE_VERSION ||
  !PID_FILE
) {
  throw new Error(
    "Upgrade prompt E2E driver requires Bun, data path, HOME, marker, sentinel, stale-version, and pid-file environment variables.",
  );
}

interface DriverOwnership {
  driverPid: number;
  childPid?: number;
}

let currentChild: ChildProcess | undefined;
let currentChildExit: Promise<void> | undefined;
let stopping = false;

// This real PTY driver has no child-exit deadline API; a bounded platform-clock
// wait is required before escalating an orphaned child after Terminal.kill().
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStillRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await wait(50);
  }
  return !isProcessRunning(pid);
}

async function stopRecordedProcess(pid: number): Promise<void> {
  if (pid === process.pid || !isProcessRunning(pid)) return;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  if (await waitForProcessExit(pid, GRACEFUL_STOP_MS)) return;

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
  if (!(await waitForProcessExit(pid, FORCED_STOP_MS))) {
    throw new Error(`Previous upgrade-prompt test process ${pid} did not exit before retry.`);
  }
}

function readPreviousOwnership(): DriverOwnership | undefined {
  try {
    const value = JSON.parse(readFileSync(PID_FILE, "utf8")) as Partial<DriverOwnership>;
    if (!Number.isInteger(value.driverPid) || value.driverPid! <= 0) return undefined;
    if (value.childPid !== undefined && (!Number.isInteger(value.childPid) || value.childPid <= 0)) return undefined;
    return { driverPid: value.driverPid, childPid: value.childPid };
  } catch {
    return undefined;
  }
}

function recordOwnership(childPid?: number): void {
  mkdirSync(dirname(PID_FILE), { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify({ driverPid: process.pid, childPid }), "utf8");
}

function clearOwnership(): void {
  const ownership = readPreviousOwnership();
  if (ownership?.driverPid === process.pid) {
    unlinkSync(PID_FILE);
  }
}

async function reclaimPriorRun(): Promise<void> {
  const ownership = readPreviousOwnership();
  if (!ownership) return;

  // Stop the driver first so it can relay SIGTERM to its child, then explicitly
  // reclaim a hard-timeout orphan if the driver's async cleanup was bypassed.
  await stopRecordedProcess(ownership.driverPid);
  if (ownership.childPid && ownership.childPid !== ownership.driverPid) {
    await stopRecordedProcess(ownership.childPid);
  }
}

function resetFixtureForAttempt(): void {
  const claudeDir = join(TEST_HOME, ".claude");
  mkdirSync(DATA_PATH, { recursive: true });
  writeFileSync(join(DATA_PATH, "local.json"), JSON.stringify({ installed_version: STALE_VERSION }), "utf8");
  rmSync(claudeDir, { recursive: true, force: true });
  writeFileSync(claudeDir, "Boot one Claude installer blocker.\n", "utf8");
}

// Node 20 is mandated by tui-test but does not implement Promise.withResolvers().
function waitForChildExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isStillRunning(child)) {
      resolve();
      return;
    }

    child.once("error", reject);
    child.once("exit", () => resolve());
  });
}

async function stopCurrentChild(signal: NodeJS.Signals): Promise<void> {
  const child = currentChild;
  const childExit = currentChildExit;
  if (!child || !childExit || !isStillRunning(child)) return;

  try {
    child.kill(signal);
  } catch {
    // The child can exit between the liveness check and signal delivery.
  }

  const exitedGracefully = await Promise.race([
    childExit.then(() => true, () => true),
    wait(GRACEFUL_STOP_MS).then(() => false),
  ]);
  if (exitedGracefully || !isStillRunning(child)) return;

  try {
    child.kill("SIGKILL");
  } catch {
    // The child can exit between the liveness check and signal delivery.
  }

  await Promise.race([
    childExit.catch(() => undefined),
    wait(FORCED_STOP_MS),
  ]);
}

async function launchBoot(boot: number): Promise<void> {
  process.stdout.write(`${MARKER_PREFIX}:boot-${boot}\n`);

  const child = spawn(BUN_PATH, ["run", "dev"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  const childExit = waitForChildExit(child);
  currentChild = child;
  currentChildExit = childExit;
  recordOwnership(child.pid);

  try {
    await childExit;
  } finally {
    if (currentChild === child) {
      currentChild = undefined;
      currentChildExit = undefined;
      recordOwnership();
    }
  }
}

function stageSuccessfulInstallFixture(): void {
  const claudeDir = join(TEST_HOME, ".claude");
  rmSync(claudeDir, { recursive: true, force: true });
  const oldSkillPath = join(claudeDir, "skills", "ei-curate", "SKILL.md");
  mkdirSync(join(claudeDir, "skills", "ei-curate"), { recursive: true });
  writeFileSync(oldSkillPath, OLD_SKILL_CONTENT, "utf8");
}

async function terminateDriver(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  await stopCurrentChild(signal);
  clearOwnership();
  process.exit(signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    void terminateDriver(signal);
  });
}

process.once("exit", () => {
  const child = currentChild;
  if (child && isStillRunning(child)) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Process teardown is best-effort when no asynchronous cleanup remains possible.
    }
  }
  clearOwnership();
});

async function run(): Promise<void> {
  await reclaimPriorRun();
  resetFixtureForAttempt();
  recordOwnership();

  try {
    await launchBoot(1);
    stageSuccessfulInstallFixture();
    await launchBoot(2);
    await launchBoot(3);
    await launchBoot(4);
  } finally {
    await stopCurrentChild("SIGTERM");
    clearOwnership();
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
