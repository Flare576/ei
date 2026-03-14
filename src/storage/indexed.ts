import type { StorageState } from "../core/types.js";
import type { Storage } from "./interface.js";
import { compress, decompress, isCompressed } from "./compress.js";
import { encodeAllEmbeddings, decodeAllEmbeddings } from "./embeddings.js";

const DB_NAME = "ei_db";
const DB_VERSION = 1;
const STORE_NAME = "state";
const PRIMARY_KEY = "primary";
const BACKUP_KEY = "backup";

export class IndexedDBStorage implements Storage {
  async isAvailable(): Promise<boolean> {
    try {
      const db = await this.openDB();
      db.close();
      return true;
    } catch {
      return false;
    }
  }

  async save(state: StorageState): Promise<void> {
    state.timestamp = new Date().toISOString();
    try {
      const json = JSON.stringify(encodeAllEmbeddings(state));
      const payload = await compress(json);
      await this.setItem(PRIMARY_KEY, payload);
    } catch (e) {
      if (this.isQuotaError(e)) {
        throw new Error("STORAGE_SAVE_FAILED: IndexedDB quota exceeded");
      }
      throw e;
    }
  }

  async load(): Promise<StorageState | null> {
    const current = await this.getItem(PRIMARY_KEY);
    if (current) {
      try {
        const json = isCompressed(current) ? await decompress(current) : current;
        return decodeAllEmbeddings(JSON.parse(json) as StorageState);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Move current state to backup location and clear primary state.
   * Used after successful remote sync to signal "no local state to load" on next launch.
   * Backup can be restored manually if remote pull fails.
   */
  async moveToBackup(): Promise<void> {
    const current = await this.getItem(PRIMARY_KEY);
    if (current) {
      // Remove primary first so backup write doesn't double-count against quota.
      await this.deleteItem(PRIMARY_KEY);
      await this.setItem(BACKUP_KEY, current);
    }
  }

  /**
   * Read backup state without removing it.
   * Used to peek sync credentials from a previous session's backup.
   */
  async loadBackup(): Promise<StorageState | null> {
    const backup = await this.getItem(BACKUP_KEY);
    if (backup) {
      try {
        const json = isCompressed(backup) ? await decompress(backup) : backup;
        return decodeAllEmbeddings(JSON.parse(json) as StorageState);
      } catch {
        return null;
      }
    }
    return null;
  }

  /** No-op in browser — rolling backups are TUI-only (filesystem required). */
  async saveRollingBackup(_state: StorageState, _maxBackups: number): Promise<void> {
    // Intentional no-op: IndexedDB has no directory/file concept.
    // The Processor gates this call with `this.isTUI` so it never runs in the browser.
  }

  // ─── Private IDB helpers ──────────────────────────────────────────────────

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  private async getItem(key: string): Promise<string | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = (event) => {
        const result = (event.target as IDBRequest).result;
        db.close();
        resolve(result ?? null);
      };

      request.onerror = (event) => {
        db.close();
        reject((event.target as IDBRequest).error);
      };
    });
  }

  private async setItem(key: string, value: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => {
        db.close();
        resolve();
      };

      request.onerror = (event) => {
        db.close();
        reject((event.target as IDBRequest).error);
      };
    });
  }

  private async deleteItem(key: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => {
        db.close();
        resolve();
      };

      request.onerror = (event) => {
        db.close();
        reject((event.target as IDBRequest).error);
      };
    });
  }

  private isQuotaError(e: unknown): boolean {
    return (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")
    );
  }
}
