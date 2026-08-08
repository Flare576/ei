import type { StorageState } from "../../../src/core/types";
import type { Storage } from "../../../src/storage/interface";
import { encodeAllEmbeddings, decodeAllEmbeddings } from "../../../src/storage/embeddings";
import { withLock, atomicWrite } from "../../../src/storage/file-lock";
import { join } from "path";
import { mkdir, rename, unlink, readdir } from "fs/promises";
import { resolveDataPath } from "../util/resolve-data-path.js";

const STATE_FILE = "state.json";
const BACKUP_FILE = "state.backup.json";
const BACKUPS_DIR = "backups";

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

    await withLock(filePath, async () => {
      try {
        await atomicWrite(filePath, JSON.stringify(encodeAllEmbeddings(state), null, 2));
      } catch (e) {
        if (this.isQuotaError(e)) {
          throw new Error("STORAGE_SAVE_FAILED: Disk quota exceeded");
        }
        throw e;
      }
    });
  }

  /**
   * Reads under state.json's own advisory lock — the SAME lock
   * `src/cli/corrections-writer.ts`'s self-drain holds for its entire
   * read-apply-write-clear sequence. Without this, a TUI starting up
   * concurrently with a self-drain could read the pre-write snapshot
   * (unlocked, no wait) and later `save()` it back over the self-drain's
   * already-committed write, silently resurrecting whatever it just
   * removed/applied (self-drain-tui-startup-lost-write-race). Taking the
   * lock here — inside `load()` itself, not at each call site — means
   * either ordering is safe: startup waits out an in-flight self-drain
   * and gets the post-write state, or self-drain waits out an in-flight
   * startup load; the two can never interleave. Every caller of `load()`
   * (the pre-render validation read in `tui/src/index.tsx` and the
   * `PersistenceState`/`StateManager` read in `src/core/state/checkpoints.ts`,
   * reached via `Processor.start()`) goes through this one method, so
   * both get the protection without needing their own locking.
   *
   * ensureDataDir() runs first (as save() already does) because the
   * advisory lock is itself a file: acquiring it on a data path whose
   * directory doesn't exist yet — a brand-new EI_DATA_PATH with no
   * state.json at all — would otherwise fail every create attempt until
   * the lock's own timeout, turning a legitimate "nothing to load yet"
   * into a spurious STORAGE_LOCK_TIMEOUT.
   */
  async load(): Promise<StorageState | null> {
    await this.ensureDataDir();
    const filePath = join(this.dataPath, STATE_FILE);

    return await withLock(filePath, async (): Promise<StorageState | null> => {
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
    });
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
    await atomicWrite(backupPath, JSON.stringify(encodeAllEmbeddings(state), null, 2));
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
    await atomicWrite(destPath, JSON.stringify(encodeAllEmbeddings(state), null, 2));

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
}
