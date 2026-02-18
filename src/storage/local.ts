import type { StorageState } from "../core/types.js";
import type { Storage } from "./interface.js";

const STATE_KEY = "ei_state";
const BACKUP_KEY = "ei_state_backup";

export class LocalStorage implements Storage {
  async isAvailable(): Promise<boolean> {
    try {
      const testKey = "__ei_storage_test__";
      globalThis.localStorage.setItem(testKey, "1");
      globalThis.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  async save(state: StorageState): Promise<void> {
    state.timestamp = new Date().toISOString();
    try {
      globalThis.localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
      if (this.isQuotaError(e)) {
        throw new Error("STORAGE_SAVE_FAILED: localStorage quota exceeded");
      }
      throw e;
    }
  }

  async load(): Promise<StorageState | null> {
    const current = globalThis.localStorage?.getItem(STATE_KEY);
    if (current) {
      try {
        return JSON.parse(current) as StorageState;
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
    const current = globalThis.localStorage?.getItem(STATE_KEY);
    if (current) {
      globalThis.localStorage.setItem(BACKUP_KEY, current);
      globalThis.localStorage.removeItem(STATE_KEY);
    }
  }

  private isQuotaError(e: unknown): boolean {
    return (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")
    );
  }
}
