// Fixture for the instance-lock exit-release regression test
// (see tui/tests/unit/util/instance-lock.test.ts and
// .sisyphus/investigations/tui-instance-lock-exit-release.md §4.5).
//
// Runs as its own Bun subprocess so the test can observe real Node/Bun
// "exit" event semantics — a real process.exit() call, a real "exit"
// listener, and the actual InstanceLock class — rather than mocking
// timing that can't be faithfully mocked in-process.
//
// Mirrors tui/src/index.tsx:43's exit-time lock release exactly:
//   process.on("exit", () => { lock.releaseSync(); });
import { InstanceLock } from "../../../../src/util/instance-lock.js";

const dataPath = process.argv[2];
if (!dataPath) {
  throw new Error("usage: bun exit-lock-sim.ts <dataPath>");
}

const lock = new InstanceLock(dataPath);
await lock.acquire();

process.on("exit", () => {
  lock.releaseSync();
});

process.exit(0);
