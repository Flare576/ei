import type { StorageState } from "../../../src/core/types";
import type { Storage } from "../../../src/storage/interface";
import { encodeAllEmbeddings, decodeAllEmbeddings } from "../../../src/storage/embeddings";
import { join } from "path";
import { mkdir, rename, unlink, readdir } from "fs/promises";
import { resolveDataPath } from "../util/resolve-data-path.js";

const STATE_FILE = "state.json";
const BACKUP_FILE = "state.backup.json";
const BACKUPS_DIR = "backups";
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_DELAY_MS = 50;

export class FileStorage implements Storage {
  private readonly dataPath: string;

  constructor(dataPath?: string) {
    this.dataPath = resolveDataPath(dataPath);
  }

  getDataPath(): string {
    return this.dataPath;
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
        await this.atomicWrite(filePath, JSON.stringify(encodeAllEmbeddings(state), null, 2));
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
      let text: string;
      try {
        text = await file.text();
      } catch (e) {
        throw new Error(`STORAGE_READ_FAILED: Could not read ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (text) {
        try {
          return decodeAllEmbeddings(JSON.parse(text) as StorageState);
        } catch (e) {
          throw new Error(`STORAGE_PARSE_FAILED: ${filePath} exists but could not be parsed as JSON. Your data is intact — fix the file manually or restore from a backup in ${join(this.dataPath, "backups")}.\n  Parse error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return null;
  }

  async moveToBackup(): Promise<void> {
    const statePath = join(this.dataPath, STATE_FILE);
    const backupPath = join(this.dataPath, BACKUP_FILE);
    const stateFile = Bun.file(statePath);
    
    if (await stateFile.exists()) {
      await rename(statePath, backupPath);
    }
  }


  async saveBackup(state: StorageState): Promise<void> {
    await this.ensureDataDir();
    const backupPath = join(this.dataPath, BACKUP_FILE);
    await this.atomicWrite(backupPath, JSON.stringify(encodeAllEmbeddings(state), null, 2));
  }

  /**
   * Read backup state without removing it.
   * Used to peek sync credentials from a previous session's backup.
   */
  async loadBackup(): Promise<StorageState | null> {
    const backupPath = join(this.dataPath, BACKUP_FILE);
    const backupFile = Bun.file(backupPath);

    if (await backupFile.exists()) {
      try {
        const text = await backupFile.text();
        if (text) {
          return decodeAllEmbeddings(JSON.parse(text) as StorageState);
        }
      } catch {
        return null;
      }
    }

    return null;
  }
  async saveRollingBackup(state: StorageState, maxBackups: number): Promise<void> {
    const backupsPath = join(this.dataPath, BACKUPS_DIR);
    await mkdir(backupsPath, { recursive: true });

    // Filename is local timestamp: YYYY-MM-DDTHH-MM-SS (colons replaced for FS compat)
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const name = [
      now.getFullYear(),
      "-", pad(now.getMonth() + 1),
      "-", pad(now.getDate()),
      "T", pad(now.getHours()),
      "-", pad(now.getMinutes()),
      "-", pad(now.getSeconds()),
    ].join("") + ".json";

    const destPath = join(backupsPath, name);
    await this.atomicWrite(destPath, JSON.stringify(encodeAllEmbeddings(state), null, 2));

    // Prune: keep only the newest maxBackups files
    const entries = await readdir(backupsPath);
    const jsonFiles = entries
      .filter(f => f.endsWith(".json"))
      .sort();  // ISO-like names sort chronologically

    const excess = jsonFiles.length - maxBackups;
    if (excess > 0) {
      for (const old of jsonFiles.slice(0, excess)) {
        await unlink(join(backupsPath, old));
      }
    }
  }

  private async ensureDataDir(): Promise<void> {
    try {
      await mkdir(this.dataPath, { recursive: true });
    } catch (e: any) {
      if (e?.code === 'EACCES' || e?.code === 'EPERM') {
        throw new Error(
          `Cannot create data directory: ${this.dataPath}\n` +
          `Fix options:\n` +
          `  - Fix Permissions  (sudo chown $USER $EI_DATA_PATH)\n` +
          `  - Change Data Path (EI_DATA_PATH=~/ei-data ei-tui)`
        );
      }
      // Other errors (e.g., race conditions) are safe to ignore
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
        // Read may throw if another writer deleted the lock between exists() and text() —
        // treat that as "lock is gone, proceed to acquire" by falling through.
        let lockContent: string;
        try {
          lockContent = await lockFile.text();
        } catch {
          // Lock vanished in the race window — retry from top to re-check state cleanly.
          await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
          continue;
        }
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
