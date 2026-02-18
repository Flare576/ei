import type { StorageState } from "../core/types.js";
import type { Storage } from "./interface.js";

const STATE_KEY = "ei_state";

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

  private isQuotaError(e: unknown): boolean {
    return (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")
    );
  }
}
