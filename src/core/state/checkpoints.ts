import type { Checkpoint, StorageState } from "../types.js";
import type { Storage } from "../../storage/interface.js";

export class CheckpointState {
  private storage: Storage | null = null;

  setStorage(storage: Storage): void {
    this.storage = storage;
  }

  async saveAuto(state: StorageState): Promise<void> {
    if (!this.storage) throw new Error("Storage not initialized");
    state.timestamp = new Date().toISOString();
    await this.storage.saveAutoCheckpoint(state);
  }

  async saveManual(index: number, name: string, state: StorageState): Promise<void> {
    if (!this.storage) throw new Error("Storage not initialized");
    state.timestamp = new Date().toISOString();
    await this.storage.saveManualCheckpoint(index, name, state);
  }

  async list(): Promise<Checkpoint[]> {
    if (!this.storage) throw new Error("Storage not initialized");
    return this.storage.listCheckpoints();
  }

  async delete(index: number): Promise<boolean> {
    if (!this.storage) throw new Error("Storage not initialized");
    return this.storage.deleteManualCheckpoint(index);
  }

  async load(index: number): Promise<StorageState | null> {
    if (!this.storage) throw new Error("Storage not initialized");
    return this.storage.loadCheckpoint(index);
  }

  async loadNewest(): Promise<StorageState | null> {
    if (!this.storage) throw new Error("Storage not initialized");
    const checkpoints = await this.storage.listCheckpoints();
    if (checkpoints.length === 0) return null;

    const newest = checkpoints.reduce((a, b) =>
      new Date(a.timestamp).getTime() > new Date(b.timestamp).getTime() ? a : b
    );
    return this.storage.loadCheckpoint(newest.index);
  }
}
