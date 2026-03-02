import type { StorageState } from "../core/types.js";

export interface Storage {
  isAvailable(): Promise<boolean>;
  save(state: StorageState): Promise<void>;
  load(): Promise<StorageState | null>;
  moveToBackup(): Promise<void>;
  loadBackup(): Promise<StorageState | null>;
  /** Save a rolling backup of state with a local timestamp filename. Prunes oldest if over limit. */
  saveRollingBackup(state: StorageState, maxBackups: number): Promise<void>;
}
