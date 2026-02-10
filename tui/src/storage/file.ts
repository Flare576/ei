import type { Checkpoint, StorageState } from "../../../src/core/types";
import type { Storage } from "../../../src/storage/interface";
import { join } from "path";
import { mkdir } from "fs/promises";

const AUTO_SAVES_FILE = "autosaves.json";
const MANUAL_SAVE_PREFIX = "manual_";
const MAX_AUTO_SAVES = 10;
const MANUAL_SLOT_MIN = 10;
const MANUAL_SLOT_MAX = 14;

interface ManualSaveEntry {
  name: string;
  state: StorageState;
}

export class FileStorage implements Storage {
  private dataPath: string;

  constructor(dataPath?: string) {
    this.dataPath = dataPath || process.env.EI_DATA_PATH || join(process.env.HOME || "~", ".ei");
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

  async listCheckpoints(): Promise<Checkpoint[]> {
    const result: Checkpoint[] = [];

    const autoSaves = await this.getAutoSavesArray();
    autoSaves.forEach((state, i) => {
      result.push({ index: i, timestamp: state.timestamp });
    });

    for (let slot = MANUAL_SLOT_MIN; slot <= MANUAL_SLOT_MAX; slot++) {
      const entry = await this.getManualEntry(slot);
      if (entry) {
        result.push({ index: slot, timestamp: entry.state.timestamp, name: entry.name });
      }
    }

    return result;
  }

  async loadCheckpoint(index: number): Promise<StorageState | null> {
    if (index < MANUAL_SLOT_MIN) {
      const autoSaves = await this.getAutoSavesArray();
      return autoSaves[index] ?? null;
    }

    const entry = await this.getManualEntry(index);
    return entry?.state ?? null;
  }

  async saveAutoCheckpoint(state: StorageState): Promise<void> {
    await this.ensureDataDir();
    const autoSaves = await this.getAutoSavesArray();
    autoSaves.push(state);
    if (autoSaves.length > MAX_AUTO_SAVES) {
      autoSaves.shift();
    }

    try {
      const filePath = join(this.dataPath, AUTO_SAVES_FILE);
      await Bun.write(filePath, JSON.stringify(autoSaves, null, 2));
    } catch (e) {
      if (this.isQuotaError(e)) {
        throw new Error("STORAGE_SAVE_FAILED: Disk quota exceeded");
      }
      throw e;
    }
  }

  async saveManualCheckpoint(index: number, name: string, state: StorageState): Promise<void> {
    if (index < MANUAL_SLOT_MIN || index > MANUAL_SLOT_MAX) {
      throw new Error(`CHECKPOINT_INVALID_SLOT: Manual saves must use slots ${MANUAL_SLOT_MIN}-${MANUAL_SLOT_MAX}`);
    }

    await this.ensureDataDir();
    const entry: ManualSaveEntry = { name, state };
    const filePath = join(this.dataPath, `${MANUAL_SAVE_PREFIX}${index}.json`);

    try {
      await Bun.write(filePath, JSON.stringify(entry, null, 2));
    } catch (e) {
      if (this.isQuotaError(e)) {
        throw new Error("STORAGE_SAVE_FAILED: Disk quota exceeded");
      }
      throw e;
    }
  }

  async deleteManualCheckpoint(index: number): Promise<boolean> {
    if (index < MANUAL_SLOT_MIN || index > MANUAL_SLOT_MAX) {
      throw new Error("CHECKPOINT_SLOT_PROTECTED: Cannot delete auto-save slots (0-9)");
    }

    const filePath = join(this.dataPath, `${MANUAL_SAVE_PREFIX}${index}.json`);
    const file = Bun.file(filePath);
    const existed = await file.exists();

    if (existed) {
      await Bun.write(filePath, "");
    }

    return existed;
  }

  private async ensureDataDir(): Promise<void> {
    try {
      await mkdir(this.dataPath, { recursive: true });
    } catch {
      return;
    }
  }

  private async getAutoSavesArray(): Promise<StorageState[]> {
    try {
      const filePath = join(this.dataPath, AUTO_SAVES_FILE);
      const file = Bun.file(filePath);
      if (!(await file.exists())) return [];
      const text = await file.text();
      if (!text) return [];
      return JSON.parse(text) as StorageState[];
    } catch {
      return [];
    }
  }

  private async getManualEntry(index: number): Promise<ManualSaveEntry | null> {
    try {
      const filePath = join(this.dataPath, `${MANUAL_SAVE_PREFIX}${index}.json`);
      const file = Bun.file(filePath);
      if (!(await file.exists())) return null;
      const text = await file.text();
      if (!text) return null;
      return JSON.parse(text) as ManualSaveEntry;
    } catch {
      return null;
    }
  }

  private isQuotaError(e: unknown): boolean {
    return (
      e instanceof Error &&
      (e.message.includes("ENOSPC") || e.message.includes("quota"))
    );
  }
}
