import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { InstanceLock, type LockData } from "../../../src/util/instance-lock.js";

describe("InstanceLock", () => {
  let dataPath: string;

  beforeEach(async () => {
    dataPath = await mkdtemp(join(tmpdir(), "ei-lock-test-"));
  });

  afterEach(async () => {
    await rm(dataPath, { recursive: true, force: true });
  });

  it("acquires lock when no lock file exists", async () => {
    const lock = new InstanceLock(dataPath);
    const result = await lock.acquire();
    expect(result.acquired).toBe(true);
    await lock.release();
  });

  it("writes lock file with correct shape", async () => {
    const lock = new InstanceLock(dataPath);
    await lock.acquire();

    const file = Bun.file(join(dataPath, "ei.lock"));
    expect(await file.exists()).toBe(true);

    const data = JSON.parse(await file.text()) as LockData;
    expect(data.pid).toBe(process.pid);
    expect(data.frontend).toBe("tui");
    expect(typeof data.started).toBe("string");

    await lock.release();
  });

  it("removes lock file on release", async () => {
    const lock = new InstanceLock(dataPath);
    await lock.acquire();
    await lock.release();

    const file = Bun.file(join(dataPath, "ei.lock"));
    expect(await file.exists()).toBe(false);
  });

  it("release is idempotent (safe to call multiple times)", async () => {
    const lock = new InstanceLock(dataPath);
    await lock.acquire();
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it("returns live_process error when lock is held by a live PID", async () => {
    // Write a lock with the current process's PID (which is definitely alive)
    const lockData: LockData = {
      pid: process.pid,
      started: new Date().toISOString(),
      frontend: "tui",
    };
    await Bun.write(join(dataPath, "ei.lock"), JSON.stringify(lockData));

    const lock = new InstanceLock(dataPath);
    const result = await lock.acquire();

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.reason).toBe("live_process");
      expect(result.pid).toBe(process.pid);
    }
  });

  it("steals stale lock (dead PID) and acquires successfully", async () => {
    // PID 999999999 is virtually guaranteed to not exist
    const lockData: LockData = {
      pid: 999999999,
      started: new Date(Date.now() - 60_000).toISOString(),
      frontend: "tui",
    };
    await Bun.write(join(dataPath, "ei.lock"), JSON.stringify(lockData));

    const lock = new InstanceLock(dataPath);
    const result = await lock.acquire();
    expect(result.acquired).toBe(true);

    // Lock file should now contain current PID
    const data = JSON.parse(await Bun.file(join(dataPath, "ei.lock")).text()) as LockData;
    expect(data.pid).toBe(process.pid);

    await lock.release();
  });

  it("steals corrupted/unreadable lock file", async () => {
    // Write garbage instead of valid JSON
    await Bun.write(join(dataPath, "ei.lock"), "not valid json {{{{");

    const lock = new InstanceLock(dataPath);
    const result = await lock.acquire();
    expect(result.acquired).toBe(true);
    await lock.release();
  });
});
