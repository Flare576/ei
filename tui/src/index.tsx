import { render } from "@opentui/solid";
import { App } from "./app";
import { InstanceLock } from "./util/instance-lock";
import { FileStorage } from "./storage/file";

const storage = new FileStorage(Bun.env.EI_DATA_PATH);
const lock = new InstanceLock(storage.getDataPath());
const lockResult = await lock.acquire();

if (!lockResult.acquired) {
  process.stderr.write(
    `\nEi cannot start: another instance is already running.\n` +
    `  PID:     ${lockResult.pid}\n` +
    `  Started: ${lockResult.started}\n` +
    `  Lock:    ${storage.getDataPath()}/ei.lock\n\n` +
    `Close the other instance first, or delete the lock file if it is stale.\n\n`
  );
  process.exit(1);
}

// Release lock when the app exits (keyboard context calls process.exit(0) on normal quit)
process.on("exit", () => { void lock.release(); });

render(App, {
  exitOnCtrlC: false,
  targetFps: 30,
  useAlternateScreen: true,
});
