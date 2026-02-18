import type { StorageState } from "../../../src/core/types";
import type { Storage } from "../../../src/storage/interface";
import { join } from "path";
import { mkdir, rename, unlink } from "fs/promises";

const STATE_FILE = "state.json";
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_DELAY_MS = 50;

export class FileStorage implements Storage {
  private dataPath: string;

  constructor(dataPath?: string) {
    if (dataPath) {
      this.dataPath = dataPath;
    } else if (process.env.EI_DATA_PATH) {
      this.dataPath = process.env.EI_DATA_PATH;
    } else {
      const xdgData = process.env.XDG_DATA_HOME || join(process.env.HOME || "~", ".local", "share");
      this.dataPath = join(xdgData, "ei");
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureDataDir();
      const testFile = join(this.dataPath, "__ei_storage_test__");
      await Bun.write(testFile, "1");
      await Bun.write(testFile, "");
      return true;
    } catch {
      return false;
    }
  }

  async save(state: StorageState): Promise<void> {
    await this.ensureDataDir();
    const filePath = join(this.dataPath, STATE_FILE);
    state.timestamp = new Date().toISOString();

    await this.withLock(filePath, async () => {
      try {
        await this.atomicWrite(filePath, JSON.stringify(state, null, 2));
      } catch (e) {
        if (this.isQuotaError(e)) {
          throw new Error("STORAGE_SAVE_FAILED: Disk quota exceeded");
        }
        throw e;
      }
    });
  }

  async load(): Promise<StorageState | null> {
    const filePath = join(this.dataPath, STATE_FILE);
    const file = Bun.file(filePath);
    
    if (await file.exists()) {
      try {
        const text = await file.text();
        if (text) {
          return JSON.parse(text) as StorageState;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private async ensureDataDir(): Promise<void> {
    try {
      await mkdir(this.dataPath, { recursive: true });
    } catch {
      return;
    }
  }

  private isQuotaError(e: unknown): boolean {
    return (
      e instanceof Error &&
      (e.message.includes("ENOSPC") || e.message.includes("quota"))
    );
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    try {
      await Bun.write(tempPath, content);
      await rename(tempPath, filePath);
    } catch (e) {
      try {
        await unlink(tempPath);
      } catch {}
      throw e;
    }
  }

  private getLockPath(filePath: string): string {
    return `${filePath}.lock`;
  }

  private async acquireLock(filePath: string): Promise<boolean> {
    const lockPath = this.getLockPath(filePath);
    const startTime = Date.now();

    while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
      const lockFile = Bun.file(lockPath);
      if (await lockFile.exists()) {
        const lockContent = await lockFile.text();
        const lockTime = parseInt(lockContent, 10);
        if (!isNaN(lockTime) && Date.now() - lockTime > LOCK_TIMEOUT_MS) {
          try {
            await unlink(lockPath);
          } catch {}
        } else {
          await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
          continue;
        }
      }

      try {
        await Bun.write(lockPath, Date.now().toString());
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
      }
    }

    return false;
  }

  private async releaseLock(filePath: string): Promise<void> {
    const lockPath = this.getLockPath(filePath);
    try {
      await unlink(lockPath);
    } catch {}
  }

  private async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const acquired = await this.acquireLock(filePath);
    if (!acquired) {
      throw new Error("STORAGE_LOCK_TIMEOUT: Could not acquire file lock");
    }
    try {
      return await fn();
    } finally {
      await this.releaseLock(filePath);
    }
  }
}
