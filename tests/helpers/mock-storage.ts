import { vi } from "vitest";
import type { Storage } from "../../src/storage/interface.js";
import type { StorageState, Checkpoint } from "../../src/core/types.js";

export function createMockStorage(): Storage & {
  _autoSaves: StorageState[];
  _manualSaves: Map<number, { state: StorageState; name: string }>;
} {
  const autoSaves: StorageState[] = [];
  const manualSaves = new Map<number, { state: StorageState; name: string }>();

  return {
    _autoSaves: autoSaves,
    _manualSaves: manualSaves,

    isAvailable: vi.fn().mockResolvedValue(true),

    listCheckpoints: vi.fn(async (): Promise<Checkpoint[]> => {
      const checkpoints: Checkpoint[] = [];
      
      autoSaves.forEach((state, i) => {
        checkpoints.push({
          index: i,
          timestamp: state.timestamp,
        });
      });
      
      manualSaves.forEach((data, index) => {
        checkpoints.push({
          index,
          timestamp: data.state.timestamp,
          name: data.name,
        });
      });
      
      return checkpoints.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    }),

    loadCheckpoint: vi.fn(async (index: number): Promise<StorageState | null> => {
      if (index < 10) {
        return autoSaves[index] ?? null;
      }
      return manualSaves.get(index)?.state ?? null;
    }),

    saveAutoCheckpoint: vi.fn(async (state: StorageState): Promise<void> => {
      autoSaves.push(state);
      if (autoSaves.length > 10) {
        autoSaves.shift();
      }
    }),

    saveManualCheckpoint: vi.fn(async (index: number, name: string, state: StorageState): Promise<void> => {
      if (index < 10 || index > 14) {
        throw new Error("Manual checkpoint index must be 10-14");
      }
      manualSaves.set(index, { state, name });
    }),

    deleteManualCheckpoint: vi.fn(async (index: number): Promise<boolean> => {
      if (index < 10 || index > 14) {
        return false;
      }
      return manualSaves.delete(index);
    }),
  };
}

export function createDefaultTestState(): StorageState {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    human: {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [],
      last_updated: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    },
    personas: {},
    queue: [],
    settings: {},
  };
}
