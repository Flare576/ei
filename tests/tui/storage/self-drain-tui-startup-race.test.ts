import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync } from "fs";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { FileStorage } from "../../../tui/src/storage/file";
import { InstanceLock } from "../../../tui/src/util/instance-lock";
import { acquireLock, releaseLock, getLockPath } from "../../../src/storage/file-lock";
import { writeCorrection } from "../../../src/cli/corrections-writer";
import type { StorageState, HumanEntity, Fact } from "../../../src/core/types";
import type { CorrectionRecord } from "../../../src/core/corrections";

const NOW = "2026-01-01T00:00:00Z";

function makeState(facts: Fact[]): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts,
      topics: [],
      people: [],
      quotes: [],
      last_updated: NOW,
    } as HumanEntity,
    personas: {},
    queue: [],
    providers: [],
    tools: [],
  };
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Polls for lockPath to appear on disk instead of sleeping a fixed
 * duration and hoping the timing lines up. Its existence is a
 * deterministic signal that whoever we're racing against has acquired
 * the lock — used to pin the exact moment self-drain is parked
 * mid-critical-section, holding state.json.lock, before we exercise
 * anything that depends on it still holding it.
 *
 * This polls the real filesystem against real wall-clock delays rather
 * than driving a fake clock: the mechanism under test IS a real
 * advisory file lock (src/storage/file-lock.ts) with its own real
 * setTimeout-based retry loop, backed by real fs I/O. There is no
 * in-process clock to fake — the state we're waiting on only changes
 * when the OS actually completes a file write.
 */
async function waitForLock(lockPath: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(lockPath)) return;
    await delay(5);
  }
  throw new Error(`Timed out waiting for lock file ${lockPath}`);
}

/**
 * Oracle for .sisyphus/issues/self-drain-tui-startup-lost-write-race.md.
 *
 * Reproduces the issue's own documented methodology verbatim, as a
 * permanent fixture rather than a disposable probe:
 *   1. Hold corrections.json.lock so a real writeCorrection() call gets
 *      past both of its "no live instance" checks, acquires
 *      state.json.lock, and parks — blocked acquiring corrections.json's
 *      lock — before it can read/apply/write state.json.
 *   2. While parked, use the real InstanceLock + FileStorage.load() to
 *      emulate a TUI starting up concurrently.
 *   3. Release the corrections lock. The self-drain completes and
 *      reports an authoritative, confirmed "self" result.
 *   4. Call the real FileStorage.save() with the TUI's snapshot from
 *      step 2. The just-confirmed removal must still be on disk
 *      afterward — corrections.json was already cleared in step 3, so
 *      there is nothing left to recover it from if this save() clobbers
 *      it.
 *
 * Must fail on code where FileStorage.load() reads state.json
 * unlocked, and pass once load() shares self-drain's state.json.lock.
 */
describe("self-drain vs. a concurrently starting TUI (self-drain-tui-startup-lost-write-race)", () => {
  let dataPath: string;

  beforeEach(async () => {
    dataPath = join(tmpdir(), `ei-self-drain-race-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dataPath, { recursive: true });
    process.env.EI_DATA_PATH = dataPath;
  });

  afterEach(async () => {
    delete process.env.EI_DATA_PATH;
    await rm(dataPath, { recursive: true, force: true });
  });

  test("a startup load() that races an in-flight self-drain must not let a later save() resurrect the record self-drain just removed", async () => {
    const statePath = join(dataPath, "state.json");
    const correctionsPath = join(dataPath, "corrections.json");
    const fact: Fact = {
      id: "fact-race",
      name: "Race Fact",
      description: "Present before self-drain removes it",
      sentiment: 0,
      last_updated: NOW,
      validated_date: NOW,
    };
    await writeFile(statePath, JSON.stringify(makeState([fact]), null, 2));

    const heldCorrectionsLock = await acquireLock(correctionsPath);
    expect(heldCorrectionsLock).toBe(true);

    const removeFact: CorrectionRecord = { op: "remove", entity_type: "fact", id: fact.id, timestamp: NOW };
    const drainPromise = writeCorrection(removeFact);

    await waitForLock(getLockPath(statePath));

    // Emulate a TUI starting up mid-self-drain, exactly as
    // tui/src/index.tsx does: acquire ei.lock, then load() state.json.
    const lock = new InstanceLock(dataPath);
    const acquireResult = await lock.acquire();
    expect(acquireResult.acquired).toBe(true);

    const storage = new FileStorage(dataPath);
    // Under the fix, this blocks on state.json.lock (still held by the
    // parked self-drain above) until the drain finishes — so it must be
    // started concurrently with, not awaited before, releasing
    // corrections.json's lock below, or the two would deadlock: the
    // drain can't finish until we release that lock, and (post-fix) this
    // load() can't return until the drain finishes.
    const startupLoadPromise = storage.load();

    await releaseLock(correctionsPath);
    const [startupSnapshot, result] = await Promise.all([startupLoadPromise, drainPromise]);
    expect(result.drainMode).toBe("self");
    expect(result.skipped).toEqual([]);

    // Sanity check independent of the race: self-drain's own write
    // actually removed the fact from disk before we exercise the TUI's
    // later save().
    const postDrainOnDisk = JSON.parse(await readFile(statePath, "utf-8")) as StorageState;
    expect(postDrainOnDisk.human.facts.some((f) => f.id === fact.id)).toBe(false);

    // The TUI now does what every real startup eventually does: persists
    // its in-memory state (here, unmodified from what load() gave it)
    // back via save().
    await storage.save(startupSnapshot!);
    await lock.release();

    const finalOnDisk = JSON.parse(await readFile(statePath, "utf-8")) as StorageState;
    expect(finalOnDisk.human.facts.some((f) => f.id === fact.id)).toBe(false);
  });
});
