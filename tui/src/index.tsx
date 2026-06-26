import { join } from "path";
import { render } from "@opentui/solid";
import { App } from "./app";

import { InstanceLock } from "./util/instance-lock";
import { FileStorage } from "./storage/file";
import pkg from "../../package.json";

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("version") || args.includes("-v")) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

const storage = new FileStorage(Bun.env.EI_DATA_PATH);
const lock = new InstanceLock(storage.getDataPath());
const lockResult = await lock.acquire().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  const dataPath = storage.getDataPath();
  process.stderr.write(
    `\nEi cannot start: cannot write to data directory.\n\n` +
    `  Path:  ${dataPath}\n` +
    `  Error: ${msg}\n\n` +
    `Fix options:\n` +
    `  - Fix Permissions  (sudo chown $USER $EI_DATA_PATH)\n` +
    `  - Change Data Path (EI_DATA_PATH=~/ei-data ei)\n\n`
  );
  process.exit(1);
});

if (!lockResult.acquired) {
  process.stderr.write(
    `\nEi cannot start: another instance is already running.\n` +
    `  PID:     ${lockResult.pid}\n` +
    `  Started: ${lockResult.started}\n` +
    `  Lock:    ${join(storage.getDataPath(), "ei.lock")}\n\n` +
    `Close the other instance first, or delete the lock file if it is stale.\n\n`
  );
  process.exit(1);
}

// Release lock when the app exits (keyboard context calls process.exit(0) on normal quit)
process.on("exit", () => { void lock.release(); });

// Validate state.json is parseable before handing off to the app.
// A corrupt file must never silently wipe all data — exit cleanly with recovery instructions.
try {
  await storage.load();
} catch (e) {
  await lock.release();
  process.stderr.write(
    `\nEi cannot start: state.json failed to load.\n\n` +
    `  ${e instanceof Error ? e.message : String(e)}\n\n` +
    `Fix the file manually, restore from a backup, or delete it to start fresh (all data will be lost).\n\n`
  );
  process.exit(1);
}

render(App, {
  exitOnCtrlC: false,
  targetFps: 30,
  useAlternateScreen: true,
});
