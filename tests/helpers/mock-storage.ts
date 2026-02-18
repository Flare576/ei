import { vi } from "vitest";
import type { Storage } from "../../src/storage/interface.js";
import type { StorageState } from "../../src/core/types.js";

export function createMockStorage(): Storage & {
  _savedState: StorageState | null;
} {
  let savedState: StorageState | null = null;

  return {
    _savedState: savedState,

    isAvailable: vi.fn(async () => true),

    load: vi.fn(async (): Promise<StorageState | null> => {
      return savedState;
    }),

    save: vi.fn(async (state: StorageState): Promise<void> => {
      savedState = state;
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
      quotes: [],
      last_updated: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    },
    personas: {},
    queue: [],
  };
}
