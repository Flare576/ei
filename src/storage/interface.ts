import type { StorageState } from "../core/types.js";

export interface Storage {
  isAvailable(): Promise<boolean>;
  save(state: StorageState): Promise<void>;
  load(): Promise<StorageState | null>;
  moveToBackup(): Promise<void>;
}
