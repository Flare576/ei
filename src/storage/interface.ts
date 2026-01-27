import type { Checkpoint, StorageState } from "../core/types.js";

export interface Storage {
  isAvailable(): Promise<boolean>;

  listCheckpoints(): Promise<Checkpoint[]>;

  loadCheckpoint(index: number): Promise<StorageState | null>;

  saveAutoCheckpoint(state: StorageState): Promise<void>;

  saveManualCheckpoint(index: number, name: string, state: StorageState): Promise<void>;

  deleteManualCheckpoint(index: number): Promise<boolean>;
}
