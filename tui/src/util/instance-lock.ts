import { join } from "path";
import { unlink } from "fs/promises";

const LOCK_FILE = "ei.lock";

export interface LockData {
  pid: number;
  started: string;
  frontend: string;
}

export type AcquireResult =
  | { acquired: true }
  | { acquired: false; reason: "live_process"; pid: number; started: string };

export class InstanceLock {
  private lockPath: string;
  private held = false;

  constructor(dataPath: string) {
    this.lockPath = join(dataPath, LOCK_FILE);
  }

  /**
   * Try to acquire the instance lock.
   *
   * - No lock file → write and proceed.
   * - Lock file exists, PID is dead → steal and proceed.
   * - Lock file exists, PID is live → return { acquired: false }.
   */
  async acquire(): Promise<AcquireResult> {
    const existing = await this.readLock();

    if (existing) {
      const alive = isProcessAlive(existing.pid);
      if (alive) {
        return { acquired: false, reason: "live_process", pid: existing.pid, started: existing.started };
      }
      // Stale lock — fall through and overwrite
    }

    await this.writeLock();
    this.held = true;
    return { acquired: true };
  }

  /**
   * Release the lock. Safe to call multiple times / if never acquired.
   */
  async release(): Promise<void> {
    if (!this.held) return;
    this.held = false;
    try {
      await unlink(this.lockPath);
    } catch {
      // Already gone — that's fine
    }
  }

  private async readLock(): Promise<LockData | null> {
    try {
      const file = Bun.file(this.lockPath);
      if (!(await file.exists())) return null;
      const text = await file.text();
      return JSON.parse(text) as LockData;
    } catch {
      return null;
    }
  }

  private async writeLock(): Promise<void> {
    const data: LockData = {
      pid: process.pid,
      started: new Date().toISOString(),
      frontend: "tui",
    };
    await Bun.write(this.lockPath, JSON.stringify(data, null, 2));
  }
}

/**
 * Check whether a process with the given PID is currently running.
 * Uses kill(pid, 0) — sends no signal, just checks existence.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
