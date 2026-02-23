import type { StorageState } from "../types.js";
import type { Storage } from "../../storage/interface.js";

const DEBOUNCE_MS = 100;

export class PersistenceState {
  private storage: Storage | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingState: StorageState | null = null;
  private loadedExistingData = false;

  setStorage(storage: Storage): void {
    this.storage = storage;
  }

  scheduleSave(state: StorageState): void {
    this.pendingState = state;
    
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    this.saveTimeout = setTimeout(async () => {
      this.saveTimeout = null;
      if (this.pendingState) {
        await this.saveNow(this.pendingState);
        this.pendingState = null;
      }
    }, DEBOUNCE_MS);
  }

  async saveNow(state: StorageState): Promise<void> {
    if (!this.storage) throw new Error("Storage not initialized");
    await this.storage.save(state);
  }

  async load(): Promise<StorageState | null> {
    if (!this.storage) throw new Error("Storage not initialized");
    const state = await this.storage.load();
    this.loadedExistingData = state !== null;
    return state;
  }

  hasExistingData(): boolean {
    return this.loadedExistingData;
  }

  async flush(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.pendingState && this.storage) {
      await this.storage.save(this.pendingState);
      this.pendingState = null;
    }
  }

  async moveToBackup(): Promise<void> {
    if (!this.storage) throw new Error("Storage not initialized");
    await this.storage.moveToBackup();
  }

  async loadBackup(): Promise<StorageState | null> {
    if (!this.storage) throw new Error("Storage not initialized");
    return this.storage.loadBackup();
  }
}