import { describe, it, expect, beforeEach, vi } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import type { StorageState } from "../../../src/core/types.js";

const GUID = "11111111-1111-1111-1111-111111111111";
const OTHER_GUID = "22222222-2222-2222-2222-222222222222";

describe("StateManager.migrateModelSplit()", () => {
  let sm: StateManager;

  beforeEach(() => {
    sm = new StateManager();
  });

  it("state with only default_model (GUID) → both new fields end up equal to it", async () => {
    const state = createDefaultTestState();
    state.human.settings = { default_model: GUID };

    const storage = createMockStorage();
    vi.mocked(storage.load).mockResolvedValue(state);
    await sm.initialize(storage);

    const settings = sm.getHuman().settings;
    expect(settings?.conversation_model).toBe(GUID);
    expect(settings?.extraction_model).toBe(GUID);
    expect(settings?.default_model).toBe(GUID); // retained, untouched (read-only)
  });

  it("re-running the migration on already-migrated state → no change", async () => {
    const state = createDefaultTestState();
    state.human.settings = {
      default_model: GUID,
      conversation_model: GUID,
      extraction_model: GUID,
    };

    const storage = createMockStorage();
    vi.mocked(storage.load).mockResolvedValue(state);
    await sm.initialize(storage);

    // Feed the already-migrated output back through a fresh initialize (runs
    // migrateModelSplit a second time against already-migrated values).
    const persisted = sm.getStorageState();
    const sm2 = new StateManager();
    const storage2 = createMockStorage();
    vi.mocked(storage2.load).mockResolvedValue(persisted);
    await sm2.initialize(storage2);

    const settings = sm2.getHuman().settings;
    expect(settings?.conversation_model).toBe(GUID);
    expect(settings?.extraction_model).toBe(GUID);
    expect(settings?.default_model).toBe(GUID);
  });

  it("conversation_model already explicitly set to a different value → untouched, not overwritten", async () => {
    const state = createDefaultTestState();
    state.human.settings = {
      default_model: GUID,
      conversation_model: OTHER_GUID,
    };

    const storage = createMockStorage();
    vi.mocked(storage.load).mockResolvedValue(state);
    await sm.initialize(storage);

    const settings = sm.getHuman().settings;
    // conversation_model was already set — must not be clobbered by default_model.
    expect(settings?.conversation_model).toBe(OTHER_GUID);
    // extraction_model was unset, so it is still populated independently.
    expect(settings?.extraction_model).toBe(GUID);
  });

  it("state with no default_model at all → no-op, no throw", async () => {
    const state = createDefaultTestState();
    state.human.settings = {};

    const storage = createMockStorage();
    vi.mocked(storage.load).mockResolvedValue(state);

    await expect(sm.initialize(storage)).resolves.not.toThrow();

    const settings = sm.getHuman().settings;
    expect(settings?.conversation_model).toBeUndefined();
    expect(settings?.extraction_model).toBeUndefined();
  });

  it("no settings object at all → no-op, no throw", async () => {
    const state = createDefaultTestState();
    // human.settings left entirely undefined.

    const storage = createMockStorage();
    vi.mocked(storage.load).mockResolvedValue(state);

    await expect(sm.initialize(storage)).resolves.not.toThrow();
    expect(sm.getHuman().settings?.conversation_model).toBeUndefined();
  });

  describe("restoreFromState path (List-B placement proof)", () => {
    it("populates conversation_model/extraction_model via restoreFromState, not just fresh load", async () => {
      // Fresh-load with no saved data first (simulates an already-running app).
      const storage = createMockStorage();
      await sm.initialize(storage);
      expect(sm.getHuman().settings?.conversation_model).toBeUndefined();

      // Now restore a legacy (pre-split) backup/sync-pull state.
      const restoredState: StorageState = createDefaultTestState();
      restoredState.human.settings = { default_model: GUID };

      sm.restoreFromState(restoredState);

      const settings = sm.getHuman().settings;
      expect(settings?.conversation_model).toBe(GUID);
      expect(settings?.extraction_model).toBe(GUID);
    });

    it("restoreFromState does not overwrite an already-set conversation_model", async () => {
      const storage = createMockStorage();
      await sm.initialize(storage);

      const restoredState: StorageState = createDefaultTestState();
      restoredState.human.settings = {
        default_model: GUID,
        conversation_model: OTHER_GUID,
      };

      sm.restoreFromState(restoredState);

      const settings = sm.getHuman().settings;
      expect(settings?.conversation_model).toBe(OTHER_GUID);
      expect(settings?.extraction_model).toBe(GUID);
    });

    it("restoreFromState is idempotent when called twice in a row with already-migrated data", async () => {
      const storage = createMockStorage();
      await sm.initialize(storage);

      const restoredState: StorageState = createDefaultTestState();
      restoredState.human.settings = { default_model: GUID };
      sm.restoreFromState(restoredState);

      // Restoring the now-migrated state again must not change anything.
      const migratedAgain: StorageState = sm.getStorageState();
      sm.restoreFromState(migratedAgain);

      const settings = sm.getHuman().settings;
      expect(settings?.conversation_model).toBe(GUID);
      expect(settings?.extraction_model).toBe(GUID);
    });
  });
});
