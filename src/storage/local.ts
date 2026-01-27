import type { Checkpoint, StorageState } from "../core/types.js";
import type { Storage } from "./interface.js";

const AUTO_SAVES_KEY = "ei_autosaves";
const MANUAL_SAVE_PREFIX = "ei_manual_";
const MAX_AUTO_SAVES = 10;
const MANUAL_SLOT_MIN = 10;
const MANUAL_SLOT_MAX = 14;

interface ManualSaveEntry {
  name: string;
  state: StorageState;
}

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

  async listCheckpoints(): Promise<Checkpoint[]> {
    const result: Checkpoint[] = [];

    const autoSaves = this.getAutoSavesArray();
    autoSaves.forEach((state, i) => {
      result.push({ index: i, timestamp: state.timestamp });
    });

    for (let slot = MANUAL_SLOT_MIN; slot <= MANUAL_SLOT_MAX; slot++) {
      const entry = this.getManualEntry(slot);
      if (entry) {
        result.push({ index: slot, timestamp: entry.state.timestamp, name: entry.name });
      }
    }

    return result;
  }

  async loadCheckpoint(index: number): Promise<StorageState | null> {
    if (index < MANUAL_SLOT_MIN) {
      const autoSaves = this.getAutoSavesArray();
      return autoSaves[index] ?? null;
    }

    const entry = this.getManualEntry(index);
    return entry?.state ?? null;
  }

  async saveAutoCheckpoint(state: StorageState): Promise<void> {
    const autoSaves = this.getAutoSavesArray();
    autoSaves.push(state);
    if (autoSaves.length > MAX_AUTO_SAVES) {
      autoSaves.shift();
    }

    try {
      globalThis.localStorage.setItem(AUTO_SAVES_KEY, JSON.stringify(autoSaves));
    } catch (e) {
      if (this.isQuotaError(e)) {
        throw new Error("STORAGE_SAVE_FAILED: localStorage quota exceeded");
      }
      throw e;
    }
  }

  async saveManualCheckpoint(index: number, name: string, state: StorageState): Promise<void> {
    if (index < MANUAL_SLOT_MIN || index > MANUAL_SLOT_MAX) {
      throw new Error(`CHECKPOINT_INVALID_SLOT: Manual saves must use slots ${MANUAL_SLOT_MIN}-${MANUAL_SLOT_MAX}`);
    }

    const entry: ManualSaveEntry = { name, state };
    const key = MANUAL_SAVE_PREFIX + index;

    try {
      globalThis.localStorage.setItem(key, JSON.stringify(entry));
    } catch (e) {
      if (this.isQuotaError(e)) {
        throw new Error("STORAGE_SAVE_FAILED: localStorage quota exceeded");
      }
      throw e;
    }
  }

  async deleteManualCheckpoint(index: number): Promise<boolean> {
    if (index < MANUAL_SLOT_MIN || index > MANUAL_SLOT_MAX) {
      throw new Error("CHECKPOINT_SLOT_PROTECTED: Cannot delete auto-save slots (0-9)");
    }

    const key = MANUAL_SAVE_PREFIX + index;
    const existed = globalThis.localStorage?.getItem(key) !== null;

    if (existed) {
      globalThis.localStorage.removeItem(key);
    }

    return existed;
  }

  private getAutoSavesArray(): StorageState[] {
    try {
      const data = globalThis.localStorage?.getItem(AUTO_SAVES_KEY);
      if (!data) return [];
      return JSON.parse(data) as StorageState[];
    } catch {
      return [];
    }
  }

  private getManualEntry(index: number): ManualSaveEntry | null {
    try {
      const key = MANUAL_SAVE_PREFIX + index;
      const data = globalThis.localStorage?.getItem(key);
      if (!data) return null;
      return JSON.parse(data) as ManualSaveEntry;
    } catch {
      return null;
    }
  }

  private isQuotaError(e: unknown): boolean {
    return (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")
    );
  }
}
